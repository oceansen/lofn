import { json, route } from "@/lib/http";
import { requireAdmin, requireOwned } from "@/lib/session";
import { enqueue } from "@/lib/jobs";
import { one } from "@/lib/db";
import { publish } from "@/lib/events";

type Ctx = { params: Promise<{ id: string }> };

/** Run synthesis now instead of waiting for the next minute. */
export const POST = route<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const a = await requireOwned(admin.id, "answers", (await params).id);
  const cycle = await one(`SELECT status FROM cycles WHERE id=$1`, [a.cycle_id]);
  await one(`UPDATE answers SET status='queued' WHERE id=$1 AND status IN ('idle','error')`, [a.id]);
  await enqueue("synthesize", { answerId: a.id, trigger: cycle?.status === "ended" ? "final" : "manual" }, { dedupeKey: `synth:${a.id}` });
  await publish({ t: "answer", projectId: a.project_id, groupId: a.group_id, cycleId: a.cycle_id, id: a.id });
  return json({ ok: true });
});
