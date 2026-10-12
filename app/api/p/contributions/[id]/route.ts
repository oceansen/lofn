import { forbidden, json, notFound, route } from "@/lib/http";
import { isUuid, requireParticipant } from "@/lib/session";
import { one } from "@/lib/db";
import { eraseContributions } from "@/lib/consent";

/** A participant deletes one of their own contributions (erased, and removed from the answer). */
export const DELETE = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireParticipant();
  const id = (await params).id;
  if (!isUuid(id)) throw notFound();
  const c = await one(`SELECT participant_id FROM contributions WHERE id=$1 AND group_id=$2`, [id, ctx.group.id]);
  if (!c) throw notFound("Contribution not found.");
  if (c.participant_id !== ctx.participant.id) throw forbidden("You can only delete your own contributions.");
  const r = await eraseContributions(ctx.participant.id, [id]);
  return json({ ok: true, erased: r.erased });
});
