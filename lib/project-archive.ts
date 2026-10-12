// Full project archive ("lofn-project-archive/v1"): every row that belongs to a project plus its media files,
// so a facilitator can back up a project or move it to another Lofn and restore it exactly.
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { one, query, tx } from "./db";
import { ApiError } from "./http";
import { generateAccessCode } from "./security";
import { storage, ALLOWED_MIME, type MediaCategory } from "./storage";
import { config } from "./config";
import { extractZip, writeZip, type ZipEntry } from "./zip";

export const ARCHIVE_FORMAT = "lofn-project-archive/v1";

type Ref = { col: string; required: boolean };
type Spec = { table: string; select: string; refs: Ref[]; key?: string[] };
const R = (col: string, required = true): Ref => ({ col, required });

// Insertion order respects foreign keys. Every uuid reference is remapped to the new ids.
const SPECS: Spec[] = [
  { table: "questions", select: `SELECT * FROM questions WHERE project_id=$1`, refs: [R("id"), R("project_id")] },
  { table: "question_images", select: `SELECT qi.* FROM question_images qi JOIN questions q ON q.id=qi.question_id WHERE q.project_id=$1`, refs: [R("question_id")] },
  { table: "groups", select: `SELECT * FROM groups WHERE project_id=$1`, refs: [R("id"), R("project_id")] },
  { table: "group_questions", select: `SELECT gq.* FROM group_questions gq JOIN groups g ON g.id=gq.group_id WHERE g.project_id=$1`, refs: [R("group_id"), R("question_id")] },
  { table: "cycles", select: `SELECT * FROM cycles WHERE project_id=$1`, refs: [R("id"), R("project_id")] },
  { table: "participants", select: `SELECT pa.* FROM participants pa JOIN groups g ON g.id=pa.group_id WHERE g.project_id=$1`, refs: [R("id"), R("group_id")] },
  { table: "contributions", select: `SELECT * FROM contributions WHERE project_id=$1`, refs: [R("id"), R("project_id"), R("group_id"), R("question_id"), R("cycle_id"), R("participant_id", false)] },
  { table: "media", select: `SELECT * FROM media WHERE project_id=$1`, refs: [R("id"), R("project_id"), R("group_id"), R("participant_id", false), R("contribution_id", false)] },
  { table: "derivations", select: `SELECT d.* FROM derivations d JOIN contributions c ON c.id=d.contribution_id WHERE c.project_id=$1`, refs: [R("id"), R("contribution_id"), R("media_id", false)] },
  { table: "answers", select: `SELECT * FROM answers WHERE project_id=$1`, refs: [R("id"), R("project_id"), R("cycle_id"), R("group_id"), R("question_id")] },
  { table: "answer_versions", select: `SELECT v.* FROM answer_versions v JOIN answers a ON a.id=v.answer_id WHERE a.project_id=$1`, refs: [R("id"), R("answer_id")] },
  { table: "answer_contributions", select: `SELECT ac.* FROM answer_contributions ac JOIN answers a ON a.id=ac.answer_id WHERE a.project_id=$1`, refs: [R("answer_id"), R("contribution_id")] },
  { table: "project_syntheses", select: `SELECT * FROM project_syntheses WHERE project_id=$1`, refs: [R("id"), R("project_id"), R("cycle_id", false)] },
  { table: "group_context", select: `SELECT gc.* FROM group_context gc JOIN groups g ON g.id=gc.group_id WHERE g.project_id=$1`, refs: [R("group_id"), R("updated_by", false)] },
  { table: "group_context_files", select: `SELECT * FROM group_context_files WHERE project_id=$1`, refs: [R("id"), R("project_id"), R("group_id"), R("participant_id", false)] },
  { table: "project_consent", select: `SELECT * FROM project_consent WHERE project_id=$1`, refs: [R("project_id")] },
  { table: "consent_versions", select: `SELECT * FROM consent_versions WHERE project_id=$1`, refs: [R("id"), R("project_id")] },
  { table: "participant_consents", select: `SELECT * FROM participant_consents WHERE project_id=$1`, refs: [R("id"), R("project_id"), R("group_id", false), R("participant_id", false), R("consent_version_id")] },
];

const PROJECT_COLS = ["name", "description", "status", "default_cycle_minutes", "media_retention_days", "synthesis_guidance", "created_at", "updated_at"];

/** Build the archive as a temp zip file. Returns its path; the caller streams and deletes it. */
export async function exportProjectArchive(projectId: string) {
  const project = await one(`SELECT * FROM projects WHERE id=$1`, [projectId]);
  if (!project) throw new ApiError(404, "Project not found.");
  const tables: Record<string, any[]> = {};
  for (const s of SPECS) {
    const rows = await query(s.select, [projectId]);
    tables[s.table] = rows.map((r) => {
      const o: Record<string, unknown> = { ...r };
      for (const [k, v] of Object.entries(o)) if (Buffer.isBuffer(v)) o[k] = { $base64: v.toString("base64") };
      if (s.table === "participants") o.token_hash = null; // session tokens never leave the server
      if (s.table === "answers") Object.assign(o, { lease_token: null, lease_until: null });
      return o;
    });
  }
  const media = tables.media.filter((m) => !m.deleted_at);
  const data = {
    format: ARCHIVE_FORMAT,
    exportedAt: new Date().toISOString(),
    source: config.appUrl,
    project: { id: project.id, ...Object.fromEntries(PROJECT_COLS.map((c) => [c, project[c]])) },
    counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
    media_files: Object.fromEntries(media.map((m) => [m.id, `media/${m.id}`])),
    tables,
  };
  const tmp = path.join(os.tmpdir(), `lofn-archive-${crypto.randomUUID()}.zip`);
  async function* entries(): AsyncGenerator<ZipEntry> {
    yield { name: "data.json", data: JSON.stringify(data) };
    yield {
      name: "README.txt",
      data:
        `Lofn project archive: ${project.name}\nExported ${data.exportedAt} from ${config.appUrl}\n\n` +
        `This archive contains personal data (participants' contributions, recordings and signed consent forms).\n` +
        `Store and share it only as your consent form and data protection rules allow.\n\n` +
        `Restore it in Lofn: Projects → New project → Import a project file.\n`,
    };
    for (const m of media) yield { name: `media/${m.id}`, compress: false, stream: () => storage().stream(m.storage_key) };
    for (const f of tables.group_context_files) yield { name: `context/${f.id}`, compress: true, stream: () => storage().stream(f.storage_key) };
  }
  await writeZip(tmp, entries());
  return { path: tmp, name: project.name as string };
}

const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Restore an archive (already on disk) as a new project owned by ownerId. Returns the new project id. */
export async function importProjectArchive(ownerId: string, zipPath: string) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "lofn-restore-"));
  const stored: { key: string }[] = [];
  try {
    const files = await extractZip(zipPath, dir, (n) => n === "data.json" || /^(media|context)\/[0-9a-f-]{36}$/.test(n), {
      totalBytes: Number(process.env.IMPORT_MAX_MB || 2048) * 1048576 * 2,
      entries: 50_000,
    });
    const dj = files.get("data.json");
    if (!dj) throw new ApiError(400, "This archive has no data.json. Choose a Lofn project archive (.zip).");
    let data: any;
    try {
      data = JSON.parse(await fsp.readFile(dj.path, "utf8"));
    } catch {
      throw new ApiError(400, "The archive's data.json is not valid JSON.");
    }
    if (data?.format !== ARCHIVE_FORMAT) throw new ApiError(400, `Unsupported archive format${data?.format ? ` (${data.format})` : ""}.`);
    if (!data.project?.name || typeof data.tables !== "object") throw new ApiError(400, "The archive is missing project data.");

    const colInfo = await query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public'`);
    const cols = new Map<string, Map<string, string>>();
    for (const c of colInfo) {
      if (!cols.has(c.table_name)) cols.set(c.table_name, new Map());
      cols.get(c.table_name)!.set(c.column_name, c.data_type);
    }
    const ids = new Map<string, string>();
    const newId = (old: string) => {
      if (!ids.has(old)) ids.set(old, crypto.randomUUID());
      return ids.get(old)!;
    };
    // Pre-assign ids for every row that has its own id, so references resolve regardless of order.
    for (const s of SPECS) for (const r of data.tables[s.table] ?? []) if (isUuid(r.id) && s.refs.some((x) => x.col === "id")) newId(r.id);

    let projectId = "";
    const counts: Record<string, number> = {};
    const mediaToStore: { id: string; old: string; key: string; mime: string; category: MediaCategory }[] = [];
    await tx(async (db) => {
      const p = data.project;
      const pr = await one(
        `INSERT INTO projects(owner_id, name, description, status, default_cycle_minutes, media_retention_days, synthesis_guidance, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8::timestamptz, now())) RETURNING id`,
        [ownerId, String(p.name).slice(0, 200), String(p.description ?? ""), p.status === "archived" ? "archived" : "active", Math.min(1440, Math.max(1, Number(p.default_cycle_minutes) || 15)),
          p.media_retention_days ?? null, String(p.synthesis_guidance ?? ""), p.created_at ?? null],
        db,
      );
      projectId = pr!.id;

      for (const s of SPECS) {
        const tcols = cols.get(s.table)!;
        let n = 0;
        for (const raw of data.tables[s.table] ?? []) {
          const row: Record<string, any> = {};
          for (const [k, v] of Object.entries(raw)) if (tcols.has(k)) row[k] = v;
          let skip = false;
          for (const ref of s.refs) {
            const v = row[ref.col];
            if (ref.col === "project_id") { row.project_id = projectId; continue; }
            if (v === null || v === undefined) { if (ref.required) skip = true; continue; }
            if (!isUuid(v) || !ids.has(v)) { if (ref.required) skip = true; else row[ref.col] = null; continue; }
            row[ref.col] = ids.get(v);
          }
          if (skip) continue;
          // Table-specific fixes so the restored project is consistent and safe.
          if (s.table === "groups") row.access_code = generateAccessCode();
          if (s.table === "participants") row.token_hash = `imported:${crypto.randomUUID()}`; // nobody can resume an imported session
          if (s.table === "cycles" && (row.status === "running" || row.status === "paused")) {
            Object.assign(row, { status: "ended", ended_at: row.ended_at ?? new Date().toISOString(), remaining_ms: null, next_synthesis_at: null, final_status: "done" });
          }
          if (s.table === "answers") Object.assign(row, { status: "idle", lease_token: null, lease_until: null });
          if (s.table === "project_syntheses" && (row.status === "running" || row.status === "queued")) Object.assign(row, { status: "error", error: "Interrupted by export." });
          if (s.table === "contributions" && (row.status === "pending" || row.status === "processing")) row.status = "failed", row.processing_error = "Not processed before export.";
          if (s.table === "group_context_files") {
            const file = files.get(`context/${raw.id}`);
            row.storage_key = `projects/${projectId}/groups/${row.group_id}/context/${row.id}`;
            if (file) mediaToStore.push({ id: row.id, old: raw.id, key: row.storage_key, mime: row.mime, category: "context" as any, path: `context/${raw.id}` } as any);
            else Object.assign(row, { status: "failed", error: "File missing from the archive." });
          }
          if (s.table === "media") {
            const file = files.get(`media/${raw.id}`);
            const cat = row.category as MediaCategory;
            if (file && !row.deleted_at && ALLOWED_MIME[cat]?.includes(row.mime)) {
              row.storage_key = `projects/${projectId}/groups/${row.group_id}/${row.id}`;
              mediaToStore.push({ id: row.id, old: raw.id, key: row.storage_key, mime: row.mime, category: cat });
            } else {
              row.storage_key = `missing/${row.id}`;
              row.deleted_at = row.deleted_at ?? new Date().toISOString();
            }
          }
          const names = Object.keys(row);
          const vals = names.map((k) => {
            const t = tcols.get(k);
            const v = row[k];
            if (v && typeof v === "object" && "$base64" in v) return Buffer.from(v.$base64, "base64");
            if (t === "jsonb" || t === "json") return v === null ? null : JSON.stringify(v);
            return v;
          });
          await db.query(`INSERT INTO ${s.table}(${names.join(",")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(",")})`, vals);
          n++;
        }
        counts[s.table] = n;
      }
      // Media files go into storage inside the transaction window, so a failure rolls everything back.
      for (const m of mediaToStore) {
        const f = files.get((m as any).path ?? `media/${m.old}`)!;
        await storage().putFile(m.key, f.path, m.mime);
        stored.push({ key: m.key });
      }
    });
    return { id: projectId, counts, media: mediaToStore.length };
  } catch (e) {
    for (const s of stored) await storage().delete(s.key).catch(() => {});
    throw e;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
