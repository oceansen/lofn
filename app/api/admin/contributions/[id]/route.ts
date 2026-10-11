import { z } from "zod";
import { one } from "@/lib/db";
import { body, json, route } from "@/lib/http";
import { requireAdmin, requireOwned } from "@/lib/session";
import { publish } from "@/lib/events";
import { enqueue } from "@/lib/jobs";

type Ctx = { params: Promise<{ id: string }> };
const Patch = z.object({ hidden: z.boolean() });

/** Hide (moderate) or restore a contribution. Originals are never edited; the answer is revised on the next tick. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const c = await requireOwned(admin.id, "contributions", (await params).id);
  const { hidden } = await body(req, Patch);
  await one(`UPDATE contributions SET hidden=$2, hidden_at = CASE WHEN $2 THEN now() END WHERE id=$1`, [c.id, hidden]);
  // Restored contributions need to be re-considered by the answer.
  if (!hidden) await one(`DELETE FROM answer_contributions ac USING answers a WHERE ac.answer_id=a.id AND ac.contribution_id=$1 AND ac.state='removed'`, [c.id]);
  const cycle = await one(`SELECT status FROM cycles WHERE id=$1`, [c.cycle_id]);
  if (cycle?.status === "ended") {
    const a = await one(`SELECT id FROM answers WHERE cycle_id=$1 AND group_id=$2 AND question_id=$3`, [c.cycle_id, c.group_id, c.question_id]);
    if (a) await enqueue("synthesize", { answerId: a.id, trigger: "final" }, { dedupeKey: `synth:${a.id}` });
  }
  await publish({ t: "contribution", projectId: c.project_id, groupId: c.group_id, cycleId: c.cycle_id, questionId: c.question_id, id: c.id });
  return json({ ok: true });
});
