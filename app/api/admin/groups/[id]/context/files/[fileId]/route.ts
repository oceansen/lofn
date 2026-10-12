import { json, notFound, route } from "@/lib/http";
import { isUuid, requireAdmin, requireOwned } from "@/lib/session";
import { one } from "@/lib/db";
import { storage } from "@/lib/storage";
import { contextView, removeContextFile } from "@/lib/group-context";

type Ctx = { params: Promise<{ id: string; fileId: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const p = await params;
  const g = await requireOwned(admin.id, "groups", p.id);
  if (!isUuid(p.fileId)) throw notFound();
  const f = await one(`SELECT name, mime, storage_key FROM group_context_files WHERE id=$1 AND group_id=$2`, [p.fileId, g.id]);
  if (!f) throw notFound();
  return new Response(new Uint8Array(await storage().getBuffer(f.storage_key)), {
    headers: { "content-type": f.mime, "content-disposition": `attachment; filename="${f.name.replace(/[^\w.\- ]+/g, "_")}"`, "cache-control": "private, no-store" },
  });
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const p = await params;
  const g = await requireOwned(admin.id, "groups", p.id);
  if (!isUuid(p.fileId)) throw notFound();
  await removeContextFile(g.id, g.project_id, p.fileId);
  return json(await contextView(g.id));
});
