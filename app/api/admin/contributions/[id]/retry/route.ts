import { one } from "@/lib/db";
import { conflict, json, route } from "@/lib/http";
import { requireAdmin, requireOwned } from "@/lib/session";
import { enqueue } from "@/lib/jobs";
import { publish } from "@/lib/events";

type Ctx = { params: Promise<{ id: string }> };

/** Re-run transcription / interpretation for a contribution whose media processing failed. */
export const POST = route<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const c = await requireOwned(admin.id, "contributions", (await params).id);
  const media = await one(`SELECT count(*)::int AS n FROM media WHERE contribution_id=$1 AND deleted_at IS NULL`, [c.id]);
  if (media.n === 0) throw conflict("This contribution has no media to process.");
  await one(`UPDATE contributions SET status='pending', processing_error=NULL WHERE id=$1`, [c.id]);
  // Let the answer pick up the improved evidence.
  await one(`DELETE FROM answer_contributions WHERE contribution_id=$1 AND state='skipped'`, [c.id]);
  await enqueue("process_contribution", { contributionId: c.id }, { dedupeKey: `proc:${c.id}`, maxAttempts: 4 });
  await publish({ t: "contribution", projectId: c.project_id, groupId: c.group_id, cycleId: c.cycle_id, questionId: c.question_id, id: c.id });
  return json({ ok: true });
});
