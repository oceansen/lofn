import { json, route } from "@/lib/http";
import { requireAdmin, requireProject, isUuid } from "@/lib/session";
import { projectOverview } from "@/lib/views";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  const cycle = new URL(req.url).searchParams.get("cycle");
  return json(await projectOverview(p.id, cycle && isUuid(cycle) ? cycle : null));
});
