import { json, notFound, route } from "@/lib/http";
import { isUuid, requireParticipant } from "@/lib/session";
import { requireConsent } from "@/lib/consent";
import { one } from "@/lib/db";
import { storage } from "@/lib/storage";
import { contextView, removeContextFile } from "@/lib/group-context";

type Ctx = { params: Promise<{ id: string }> };

/** Download a context file of your own group. */
export const GET = route<Ctx>(async (_req, { params }) => {
  const ctx = await requireParticipant();
  await requireConsent(ctx);
  const id = (await params).id;
  if (!isUuid(id)) throw notFound();
  const f = await one(`SELECT name, mime, storage_key FROM group_context_files WHERE id=$1 AND group_id=$2`, [id, ctx.group.id]);
  if (!f) throw notFound();
  return new Response(new Uint8Array(await storage().getBuffer(f.storage_key)), {
    headers: { "content-type": f.mime, "content-disposition": `attachment; filename="${f.name.replace(/[^\w.\- ]+/g, "_")}"`, "cache-control": "private, no-store" },
  });
});

/** Any group member can remove a context file: the context is the group's shared material. */
export const DELETE = route<Ctx>(async (_req, { params }) => {
  const ctx = await requireParticipant();
  await requireConsent(ctx);
  const id = (await params).id;
  if (!isUuid(id)) throw notFound();
  await removeContextFile(ctx.group.id, ctx.project.id, id);
  return json(await contextView(ctx.group.id, ctx.participant.id));
});
