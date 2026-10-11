import { json, route } from "@/lib/http";
import { requireAdmin, requireProject } from "@/lib/session";
import { enqueue } from "@/lib/jobs";
import { one } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  const s = await one(
    `SELECT count(*) FILTER (WHERE deleted_at IS NULL)::int AS stored, COALESCE(sum(size_bytes) FILTER (WHERE deleted_at IS NULL),0)::bigint AS bytes,
            count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted FROM media WHERE project_id=$1`,
    [p.id],
  );
  return json(s);
});

/** Delete all stored media files for this project now. Transcripts and descriptions are kept. */
export const DELETE = route<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  await enqueue("purge_media", { projectId: p.id }, { dedupeKey: `purge:${p.id}` });
  return json({ ok: true }, { status: 202 });
});
