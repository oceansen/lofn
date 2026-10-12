import { route } from "@/lib/http";
import { requireAdmin, requireProject } from "@/lib/session";
import { exportProjectArchive } from "@/lib/project-archive";
import { tempFileResponse } from "@/lib/zip";

export const runtime = "nodejs";

/** Everything in the project, with media, as a zip that can be imported again (backup / move). */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  const a = await exportProjectArchive(p.id);
  const date = new Date().toISOString().slice(0, 10);
  return tempFileResponse(a.path, `${a.name} - lofn archive ${date}.zip`);
});
