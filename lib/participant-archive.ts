// A participant's own data as a zip ("lofn-participant/v1"): data.json plus their media files.
// The same file can be imported back into a project, adding the contributions to the current round.
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { one, query } from "./db";
import { ApiError } from "./http";
import { storage, type MediaCategory } from "./storage";
import { createContribution, ingestFile } from "./contributions";
import { participantData, requireConsent } from "./consent";
import { extractZip, writeZip, type ZipEntry } from "./zip";
import type { ParticipantCtx } from "./session";

export async function exportParticipantArchive(ctx: ParticipantCtx) {
  const data = await participantData(ctx);
  const ids = data.contributions.flatMap((c) => c.media.filter((m: any) => m.file).map((m: any) => m.id as string));
  const media = ids.length ? await query(`SELECT id, storage_key FROM media WHERE id = ANY($1::uuid[]) AND participant_id=$2`, [ids, ctx.participant.id]) : [];
  const tmp = path.join(os.tmpdir(), `lofn-mine-${crypto.randomUUID()}.zip`);
  async function* entries(): AsyncGenerator<ZipEntry> {
    yield { name: "data.json", data: JSON.stringify(data, null, 2) };
    yield {
      name: "README.txt",
      data: `Your data from “${data.project}” (${data.group}), exported ${data.exportedAt}.\n\ndata.json lists your contributions, what Lofn derived from them, and the consent forms you signed.\nmedia/ holds your photos, recordings and videos.\n\nYou can import this file into a Lofn project under “Consent and your data” → “Import my data”.\n`,
    };
    for (const m of media) yield { name: `media/${m.id}`, compress: false, stream: () => storage().stream(m.storage_key) };
  }
  await writeZip(tmp, entries());
  return tmp;
}

export type ImportReport = { imported: number; skipped: { ref: string; reason: string }[] };

/** Add contributions from a participant archive to the current round, matching questions by id or title. */
export async function importParticipantArchive(ctx: ParticipantCtx, zipPath: string): Promise<ImportReport> {
  const consent = await requireConsent(ctx);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "lofn-mine-in-"));
  try {
    const files = await extractZip(zipPath, dir, (n) => n === "data.json" || /^media\/[0-9a-f-]{36}$/.test(n), { totalBytes: 1024 * 1048576, entries: 2000 });
    const dj = files.get("data.json");
    if (!dj) throw new ApiError(400, "This isn't a Lofn data export (no data.json inside).");
    let data: any;
    try {
      data = JSON.parse(await fsp.readFile(dj.path, "utf8"));
    } catch {
      throw new ApiError(400, "The export's data.json isn't valid JSON.");
    }
    if (data?.format !== "lofn-participant/v1" || !Array.isArray(data.contributions)) throw new ApiError(400, "This isn't a Lofn data export.");
    if (data.contributions.length > 500) throw new ApiError(413, "That export has too many contributions to import at once.");
    const live = await one(`SELECT 1 FROM cycles WHERE project_id=$1 AND status='running'`, [ctx.project.id]);
    if (!live) throw new ApiError(409, "Imported contributions are added to the current round, and none is running right now.");

    const assigned = await query(
      `SELECT q.id, q.title FROM questions q JOIN group_questions gq ON gq.question_id=q.id WHERE gq.group_id=$1`,
      [ctx.group.id],
    );
    const norm = (t: string) => String(t || "").trim().toLowerCase().replace(/\s+/g, " ");
    const report: ImportReport = { imported: 0, skipped: [] };
    for (const c of data.contributions) {
      const ref = String(c.ref || "?");
      if (c.removedByFacilitator) { report.skipped.push({ ref, reason: "removed by the facilitator" }); continue; }
      const q = assigned.find((x) => x.id === c.questionId) ?? assigned.find((x) => norm(x.title) === norm(c.question));
      if (!q) { report.skipped.push({ ref, reason: `no matching question here (“${String(c.question || "").slice(0, 60)}”)` }); continue; }
      const mediaList: any[] = Array.isArray(c.media) ? c.media.filter((m: any) => m?.file && files.has(m.file)) : [];
      if (mediaList.length && !consent.choices.recordings) { report.skipped.push({ ref, reason: "has recordings or photos, and you haven't allowed those" }); continue; }
      const text = typeof c.text === "string" ? c.text : "";
      if (!text.trim() && !mediaList.length) { report.skipped.push({ ref, reason: "empty" }); continue; }
      try {
        const mediaIds: string[] = [];
        for (const m of mediaList) {
          const cat = (["image", "audio", "video"].includes(m.category) ? m.category : null) as MediaCategory | null;
          if (!cat) throw new ApiError(400, "unknown media type");
          const f = files.get(m.file)!;
          const up = await ingestFile(f.path, { projectId: ctx.project.id, groupId: ctx.group.id, participantId: ctx.participant.id }, cat, String(m.name || ""));
          mediaIds.push(up.id);
        }
        await createContribution(ctx, { questionId: q.id, text, mediaIds });
        report.imported++;
      } catch (e) {
        report.skipped.push({ ref, reason: (e as Error).message });
      }
    }
    return report;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
