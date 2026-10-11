import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { config } from "./config";
import { one, query, tx } from "./db";
import { badRequest, conflict, forbidden, ApiError } from "./http";
import { enqueue } from "./jobs";
import { publish } from "./events";
import { ALLOWED_MIME, maxBytes, storage, type MediaCategory } from "./storage";
import type { ParticipantCtx } from "./session";

/** Stream an upload to a temp file (bounded), sniff its real type, then hand it to storage. */
export async function saveUpload(req: Request, ctx: ParticipantCtx, category: MediaCategory, originalName: string) {
  if (!req.body) throw badRequest("No file was sent.");
  const limit = maxBytes(category);
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > limit) throw new ApiError(413, `File is too large. The limit for ${category} is ${Math.round(limit / 1024 / 1024)} MB.`);

  const tmp = path.join(os.tmpdir(), `lofn-up-${crypto.randomUUID()}`);
  const hash = crypto.createHash("sha256");
  let size = 0;
  let head = Buffer.alloc(0);
  const out = fs.createWriteStream(tmp);
  let writeError: Error | null = null;
  out.on("error", (e) => {
    writeError = e;
    out.emit("drain"); // unblock a pending drain wait
  });
  try {
    const reader = Readable.fromWeb(req.body as any);
    for await (const chunk of reader) {
      const buf = Buffer.from(chunk);
      size += buf.length;
      if (size > limit) throw new ApiError(413, `File is too large. The limit for ${category} is ${Math.round(limit / 1024 / 1024)} MB.`);
      if (head.length < 4100) head = Buffer.concat([head, buf]).subarray(0, 4100);
      hash.update(buf);
      if (writeError) throw new ApiError(500, "Couldn't store the upload. Try again.");
      if (!out.write(buf)) await new Promise<void>((r) => out.once("drain", () => r()));
    }
    if (writeError) throw new ApiError(500, "Couldn't store the upload. Try again.");
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err || writeError ? reject(err || writeError) : resolve())));
    if (size === 0) throw badRequest("The file is empty.");

    const { fileTypeFromBuffer } = await import("file-type");
    const sniffed = await fileTypeFromBuffer(head);
    let mime = sniffed?.mime as string | undefined;
    // WAV/Ogg variants sniff with alternative names.
    if (mime === "audio/x-wav" || mime === "audio/wave") mime = "audio/wav";
    if (mime === "audio/x-m4a") mime = "audio/mp4";
    if (!mime || !ALLOWED_MIME[category].includes(mime)) {
      throw new ApiError(415, `That file type isn't supported for ${category}${sniffed ? ` (${sniffed.mime})` : ""}.`);
    }
    const id = crypto.randomUUID();
    const key = `projects/${ctx.project.id}/groups/${ctx.group.id}/${id}`;
    await storage().putFile(key, tmp, mime);
    await query(
      `INSERT INTO media(id, project_id, group_id, participant_id, category, storage_key, mime, size_bytes, original_name, sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, ctx.project.id, ctx.group.id, ctx.participant.id, category, key, mime, size, originalName.slice(0, 200), hash.digest("hex")],
    );
    return { id, mime, size, category };
  } finally {
    out.destroy();
    await fsp.unlink(tmp).catch(() => {});
  }
}

export async function createContribution(ctx: ParticipantCtx, input: { questionId: string; text: string; mediaIds: string[] }) {
  const text = input.text.trim();
  if (text.length > config.limits.textChars) throw badRequest(`Keep text under ${config.limits.textChars} characters.`);
  const assigned = await one(`SELECT 1 FROM group_questions WHERE group_id=$1 AND question_id=$2`, [ctx.group.id, input.questionId]);
  if (!assigned) throw forbidden("This question isn't assigned to your group.");

  const result = await tx(async (db) => {
    const cycle = await one(
      `SELECT * FROM cycles WHERE project_id=$1 AND (
          (status='running' AND ends_at + ($2 || ' seconds')::interval > now())
          OR (status='ended' AND ended_at + ($2 || ' seconds')::interval > now() AND ends_at IS NOT NULL AND ended_at = ends_at))
       ORDER BY status='running' DESC LIMIT 1 FOR SHARE`,
      [ctx.project.id, String(config.limits.contributionGraceSeconds)],
      db,
    );
    if (!cycle) {
      const paused = await one(`SELECT 1 FROM cycles WHERE project_id=$1 AND status='paused'`, [ctx.project.id], db);
      throw conflict(paused ? "The session is paused. You can contribute again when the facilitator resumes it." : "The session isn't open for contributions right now.");
    }
    const media = input.mediaIds.length
      ? await db.query(
          `SELECT id, category FROM media WHERE id = ANY($1::uuid[]) AND participant_id=$2 AND group_id=$3 AND contribution_id IS NULL AND deleted_at IS NULL FOR UPDATE`,
          [input.mediaIds, ctx.participant.id, ctx.group.id],
        )
      : { rows: [] as { id: string; category: MediaCategory }[] };
    if (media.rows.length !== input.mediaIds.length) throw badRequest("One of the attachments is missing or already used. Upload it again.");
    const cats = new Set(media.rows.map((m: any) => m.category));
    if (cats.size > 1) throw badRequest("Send images, audio and video as separate contributions.");
    const cat = [...cats][0] as MediaCategory | undefined;
    if (cat === "image" && media.rows.length > config.limits.imagesPerContribution)
      throw badRequest(`Attach at most ${config.limits.imagesPerContribution} images per contribution.`);
    if ((cat === "audio" || cat === "video") && media.rows.length > 1) throw badRequest(`Attach one ${cat} file per contribution.`);
    if (!cat && !text) throw badRequest("Write something or attach a file first.");
    const kind = !cat ? "text" : cat === "image" ? (text ? "image_text" : "image") : cat;

    const counter = await one<{ n: number }>(`UPDATE groups SET contribution_counter = contribution_counter + 1 WHERE id=$1 RETURNING contribution_counter AS n`, [ctx.group.id], db);
    const c = await one(
      `INSERT INTO contributions(ref_no, project_id, group_id, question_id, cycle_id, participant_id, kind, text_content, status, processed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $9='ready' THEN now() END) RETURNING *`,
      [counter!.n, ctx.project.id, ctx.group.id, input.questionId, cycle.id, ctx.participant.id, kind, text, cat ? "pending" : "ready"],
      db,
    );
    for (const [i, id] of input.mediaIds.entries()) await db.query(`UPDATE media SET contribution_id=$1, position=$2 WHERE id=$3`, [c.id, i, id]);
    await db.query(
      `INSERT INTO answers(project_id, cycle_id, group_id, question_id) VALUES ($1,$2,$3,$4) ON CONFLICT (cycle_id, group_id, question_id) DO NOTHING`,
      [ctx.project.id, cycle.id, ctx.group.id, input.questionId],
    );
    // Sent within the grace window after time ran out: make sure the final answer includes it.
    if (cycle.status === "ended" && !cat) {
      const a = await one(`SELECT id FROM answers WHERE cycle_id=$1 AND group_id=$2 AND question_id=$3`, [cycle.id, ctx.group.id, input.questionId], db);
      if (a) await enqueue("synthesize", { answerId: a.id, trigger: "final" }, { dedupeKey: `synth:${a.id}`, maxAttempts: 8 }, db);
    }
    if (cat) await enqueue("process_contribution", { contributionId: c.id }, { dedupeKey: `proc:${c.id}`, maxAttempts: 4 }, db);
    await publish({ t: "contribution", projectId: ctx.project.id, groupId: ctx.group.id, cycleId: cycle.id, questionId: input.questionId, id: c.id }, db);
    return c;
  });
  return result;
}
