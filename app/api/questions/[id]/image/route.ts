import { one } from "@/lib/db";
import { notFound, route } from "@/lib/http";
import { getAdmin, getParticipant, isUuid } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** A question's reference image: for the owning admin, or participants of a group the question is assigned to. */
export const GET = route<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  if (!isUuid(id)) throw notFound();
  const row = await one(
    `SELECT qi.mime, qi.data, q.project_id, p.owner_id FROM question_images qi JOIN questions q ON q.id=qi.question_id
       JOIN projects p ON p.id=q.project_id WHERE qi.question_id=$1`,
    [id],
  );
  if (!row) throw notFound();
  const admin = await getAdmin();
  let ok = admin?.id === row.owner_id;
  if (!ok) {
    const part = await getParticipant();
    if (part && part.group.code_active) ok = !!(await one(`SELECT 1 FROM group_questions WHERE group_id=$1 AND question_id=$2`, [part.group.id, id]));
  }
  if (!ok) throw notFound();
  return new Response(new Uint8Array(row.data), {
    headers: { "Content-Type": row.mime, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
});
