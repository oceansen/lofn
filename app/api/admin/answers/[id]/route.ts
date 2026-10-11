import { json, route } from "@/lib/http";
import { requireAdmin, requireOwned } from "@/lib/session";
import { answers, answerVersions, contributions } from "@/lib/views";
import { one } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const a = await requireOwned(admin.id, "answers", (await params).id);
  const [view] = await answers(`a.id=$1`, [a.id]);
  const meta = await one(
    `SELECT q.title AS question, q.instructions, g.name AS group_name, c.name AS cycle_name FROM questions q, groups g, cycles c WHERE q.id=$1 AND g.id=$2 AND c.id=$3`,
    [a.question_id, a.group_id, a.cycle_id],
  );
  // Include contributions from earlier cycles when they were carried forward into this answer.
  const contribs = await contributions(
    `(c.cycle_id=$1 AND c.group_id=$2 AND c.question_id=$3) OR c.id IN (SELECT contribution_id FROM answer_contributions WHERE answer_id=$4)`,
    [a.cycle_id, a.group_id, a.question_id, a.id],
  );
  return json({ answer: view, meta, versions: await answerVersions(a.id), contributions: contribs });
});
