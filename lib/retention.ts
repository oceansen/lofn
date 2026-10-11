import { query } from "./db";
import { storage } from "./storage";
import { enqueue } from "./jobs";

/** Delete stored media bytes; DB rows remain (marked deleted) so transcripts and descriptions survive. */
export async function deleteMediaRows(rows: { id: string; storage_key: string }[]) {
  let n = 0;
  for (const r of rows) {
    try {
      await storage().delete(r.storage_key);
      await query(`UPDATE media SET deleted_at=now() WHERE id=$1`, [r.id]);
      n++;
    } catch (e) {
      console.warn("[retention] could not delete", r.storage_key, (e as Error).message);
    }
  }
  return n;
}

/** Apply each project's media_retention_days: media older than N days after its cycle ended is removed. */
export async function retentionSweep() {
  const rows = await query(
    `SELECT m.id, m.storage_key FROM media m
       JOIN projects p ON p.id = m.project_id
       LEFT JOIN contributions c ON c.id = m.contribution_id
       LEFT JOIN cycles cy ON cy.id = c.cycle_id
      WHERE m.deleted_at IS NULL AND p.media_retention_days IS NOT NULL
        AND ( (cy.status='ended' AND cy.ended_at < now() - (p.media_retention_days || ' days')::interval)
           OR (m.contribution_id IS NULL AND m.created_at < now() - interval '1 day') )
      LIMIT 500`,
  );
  // Orphaned uploads (never attached to a contribution) are cleaned up after a day regardless.
  const orphans = await query(
    `SELECT id, storage_key FROM media WHERE deleted_at IS NULL AND contribution_id IS NULL AND created_at < now() - interval '1 day' LIMIT 500`,
  );
  const seen = new Set<string>();
  const all = [...rows, ...orphans].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  return deleteMediaRows(all);
}

export async function purgeProjectMedia(projectId: string) {
  const rows = await query(`SELECT id, storage_key FROM media WHERE project_id=$1 AND deleted_at IS NULL`, [projectId]);
  return deleteMediaRows(rows);
}

/** Called before a project is hard-deleted: rows cascade, so storage keys are handed to a job first. */
export async function scheduleStorageDeletion(projectId: string) {
  const rows = await query<{ storage_key: string }>(`SELECT storage_key FROM media WHERE project_id=$1 AND deleted_at IS NULL`, [projectId]);
  for (let i = 0; i < rows.length; i += 200)
    await enqueue("delete_storage", { keys: rows.slice(i, i + 200).map((r) => r.storage_key) }, { maxAttempts: 10 });
}
