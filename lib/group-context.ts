// Group context: notes and files a group supplies as background for all its answers, used when switched on.
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import { one, query } from "./db";
import { ApiError, badRequest } from "./http";
import { enqueue } from "./jobs";
import { publish } from "./events";
import { storage } from "./storage";
import { CONTEXT_EXTS, extractText, kindOf } from "./extract-text";
import { chatFor } from "./ai/provider";
import { aiForProject } from "./ai/settings";
import type { ParticipantCtx } from "./session";

export const CONTEXT_LIMITS = {
  fileBytes: Number(process.env.CONTEXT_FILE_MB || 25) * 1048576,
  files: Number(process.env.CONTEXT_MAX_FILES || 10),
  textChars: 20_000,
  promptChars: Number(process.env.CONTEXT_MAX_CHARS || 40_000),
  perFileChars: 200_000,
};

export type ContextFileView = { id: string; name: string; mime: string; size: number; status: string; error: string | null; chars: number; createdAt: string; mine?: boolean };
export type ContextView = { enabled: boolean; text: string; updatedAt: string | null; files: ContextFileView[]; active: boolean; promptChars: number; truncated: boolean };

export async function contextView(groupId: string, viewerParticipantId?: string): Promise<ContextView> {
  const gc = await one(`SELECT enabled, text, updated_at, active_hash FROM group_context WHERE group_id=$1`, [groupId]);
  const files = await query(
    `SELECT id, name, mime, size_bytes, status, error, length(extracted) AS chars, created_at, participant_id FROM group_context_files WHERE group_id=$1 ORDER BY created_at`,
    [groupId],
  );
  const composed = await composeContext(groupId, true);
  return {
    enabled: !!gc?.enabled,
    text: gc?.text ?? "",
    updatedAt: gc?.updated_at ? new Date(gc.updated_at).toISOString() : null,
    active: !!gc?.active_hash,
    promptChars: composed.text.length,
    truncated: composed.truncated,
    files: files.map((f) => ({
      id: f.id,
      name: f.name,
      mime: f.mime,
      size: Number(f.size_bytes),
      status: f.status,
      error: f.error,
      chars: f.chars,
      createdAt: new Date(f.created_at).toISOString(),
      ...(viewerParticipantId ? { mine: f.participant_id === viewerParticipantId } : {}),
    })),
  };
}

/** The context text the synthesis sees (enabled or, with ignoreEnabled, as it would be), capped for the prompt. */
export async function composeContext(groupId: string, ignoreEnabled = false) {
  const gc = await one(`SELECT enabled, text FROM group_context WHERE group_id=$1`, [groupId]);
  if (!gc || (!gc.enabled && !ignoreEnabled)) return { text: "", truncated: false };
  const files = await query(`SELECT name, extracted FROM group_context_files WHERE group_id=$1 AND status='ready' ORDER BY created_at`, [groupId]);
  const parts: string[] = [];
  if (gc.text.trim()) parts.push(`Notes from the group:\n${gc.text.trim()}`);
  for (const f of files) if (f.extracted.trim()) parts.push(`File “${f.name}”:\n${f.extracted.trim()}`);
  let text = parts.join("\n\n");
  let truncated = false;
  if (text.length > CONTEXT_LIMITS.promptChars) {
    text = text.slice(0, CONTEXT_LIMITS.promptChars) + "\n(…context shortened for length.)";
    truncated = true;
  }
  return { text, truncated };
}

/** Recompute which context answers should reflect; answers in running rounds are revised on the next tick. */
export async function refreshContext(groupId: string, projectId: string) {
  const { text } = await composeContext(groupId);
  const hash = text ? crypto.createHash("sha256").update(text).digest("hex") : "";
  await query(`UPDATE group_context SET active_hash=$2 WHERE group_id=$1`, [groupId, hash]);
  if (hash) await ensureContextAnswers(projectId, groupId);
  await publish({ t: "context", projectId, groupId });
  return hash;
}

/** With context on, every assigned question gets an answer in running rounds, even before anyone contributes. */
export async function ensureContextAnswers(projectId: string, groupId?: string) {
  await query(
    `INSERT INTO answers(project_id, cycle_id, group_id, question_id)
     SELECT cy.project_id, cy.id, gq.group_id, gq.question_id
       FROM cycles cy JOIN groups g ON g.project_id=cy.project_id JOIN group_questions gq ON gq.group_id=g.id
       JOIN group_context gc ON gc.group_id=g.id AND gc.active_hash <> ''
      WHERE cy.project_id=$1 AND cy.status IN ('running','paused') AND ($2::uuid IS NULL OR g.id=$2)
     ON CONFLICT (cycle_id, group_id, question_id) DO NOTHING`,
    [projectId, groupId ?? null],
  );
}

async function ensureRow(groupId: string) {
  await query(`INSERT INTO group_context(group_id) VALUES ($1) ON CONFLICT DO NOTHING`, [groupId]);
}

export async function updateContext(ctx: ParticipantCtx, patch: { enabled?: boolean; text?: string }) {
  await ensureRow(ctx.group.id);
  if (patch.text !== undefined && patch.text.length > CONTEXT_LIMITS.textChars) throw badRequest(`Keep the notes under ${CONTEXT_LIMITS.textChars.toLocaleString()} characters.`);
  await query(
    `UPDATE group_context SET enabled=COALESCE($2, enabled), text=COALESCE($3, text), updated_by=$4, updated_at=now() WHERE group_id=$1`,
    [ctx.group.id, patch.enabled ?? null, patch.text ?? null, ctx.participant.id],
  );
  await refreshContext(ctx.group.id, ctx.project.id);
}

export async function addContextFile(ctx: ParticipantCtx, tmp: string, name: string) {
  const ext = kindOf(name);
  if (!ext) throw new ApiError(415, `Lofn can read ${Object.keys(CONTEXT_EXTS).map((e) => "." + e).join(", ")} files as context.`);
  const n = await one(`SELECT count(*)::int AS n FROM group_context_files WHERE group_id=$1`, [ctx.group.id]);
  if (n!.n >= CONTEXT_LIMITS.files) throw new ApiError(409, `A group can have up to ${CONTEXT_LIMITS.files} context files. Remove one first.`);
  const stat = await fsp.stat(tmp);
  if (!stat.size) throw badRequest("The file is empty.");
  // Office files are zips; PDFs start with %PDF; images are sniffed. Text files are read as UTF-8.
  const head = Buffer.alloc(8);
  const fh = await fsp.open(tmp, "r");
  await fh.read(head, 0, 8, 0);
  await fh.close();
  const zipSig = head[0] === 0x50 && head[1] === 0x4b;
  if (["pptx", "docx", "xlsx"].includes(ext) && !zipSig) throw new ApiError(415, "That doesn't look like a valid Office file.");
  if (ext === "pdf" && head.toString("latin1", 0, 4) !== "%PDF") throw new ApiError(415, "That doesn't look like a valid PDF.");
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) {
    const { fileTypeFromFile } = await import("file-type");
    const t = await fileTypeFromFile(tmp);
    if (!t || !["image/png", "image/jpeg", "image/webp"].includes(t.mime)) throw new ApiError(415, "That doesn't look like a valid image.");
  }
  const hash = crypto.createHash("sha256");
  for await (const c of fs.createReadStream(tmp)) hash.update(c as Buffer);
  await ensureRow(ctx.group.id);
  const id = crypto.randomUUID();
  const key = `projects/${ctx.project.id}/groups/${ctx.group.id}/context/${id}`;
  await storage().putFile(key, tmp, CONTEXT_EXTS[ext]);
  await query(
    `INSERT INTO group_context_files(id, project_id, group_id, participant_id, name, mime, size_bytes, storage_key, sha256) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, ctx.project.id, ctx.group.id, ctx.participant.id, name.slice(0, 200), CONTEXT_EXTS[ext], stat.size, key, hash.digest("hex")],
  );
  await enqueue("process_context_file", { fileId: id }, { dedupeKey: `ctx:${id}`, maxAttempts: 3 });
  await publish({ t: "context", projectId: ctx.project.id, groupId: ctx.group.id });
  return id;
}

export async function removeContextFile(groupId: string, projectId: string, fileId: string) {
  const f = await one(`DELETE FROM group_context_files WHERE id=$1 AND group_id=$2 RETURNING storage_key`, [fileId, groupId]);
  if (!f) throw new ApiError(404, "File not found.");
  await storage().delete(f.storage_key).catch(() => {});
  await refreshContext(groupId, projectId);
}

/** Worker: read a context file into text (images are described by the owner's vision model). */
export async function processContextFile(fileId: string) {
  const f = await one(`SELECT * FROM group_context_files WHERE id=$1`, [fileId]);
  if (!f) return;
  try {
    const buf = await storage().getBuffer(f.storage_key);
    const ext = kindOf(f.name)!;
    let text = await extractText(buf, ext);
    if (text === null) {
      const ai = chatFor("vision", await aiForProject(f.project_id));
      if (!ai) throw new Error("Images need an AI vision model with a key; the project owner hasn't set one.");
      const sharp = (await import("sharp")).default;
      const jpg = await sharp(buf).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      text = await ai.complete({
        system: "Transcribe all text in the image exactly, then describe any diagrams, charts or photos in a few factual sentences. No speculation.",
        parts: [{ type: "image", mime: "image/jpeg", base64: jpg.toString("base64") }],
        maxTokens: 1500,
      });
    }
    text = text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) throw new Error("No text could be read from this file.");
    if (text.length > CONTEXT_LIMITS.perFileChars) text = text.slice(0, CONTEXT_LIMITS.perFileChars);
    await query(`UPDATE group_context_files SET status='ready', extracted=$2, error=NULL, processed_at=now() WHERE id=$1`, [fileId, text]);
  } catch (e) {
    await query(`UPDATE group_context_files SET status='failed', error=$2, processed_at=now() WHERE id=$1`, [fileId, (e as Error).message.slice(0, 300)]);
  }
  await refreshContext(f.group_id, f.project_id);
}
