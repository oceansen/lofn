import { json, route, notFound } from "@/lib/http";
import { requireParticipant, isUuid } from "@/lib/session";
import { one } from "@/lib/db";
import { answerVersions } from "@/lib/views";

type Ctx = { params: Promise<{ id: string }> };

/** Version history of one of the participant's own group answers. */
export const GET = route<Ctx>(async (_req, { params }) => {
  const ctx = await requireParticipant();
  const { id } = await params;
  if (!isUuid(id)) throw notFound();
  const a = await one(`SELECT id FROM answers WHERE id=$1 AND group_id=$2`, [id, ctx.group.id]);
  if (!a) throw notFound();
  return json({ versions: await answerVersions(a.id) });
});
