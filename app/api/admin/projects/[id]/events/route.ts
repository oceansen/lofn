import { sseResponse } from "@/lib/event-bus";
import { requireAdmin, requireProject } from "@/lib/session";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  return sseResponse(req, (ev) => ev.projectId === p.id);
});
