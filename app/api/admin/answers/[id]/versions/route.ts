import { json, route } from "@/lib/http";
import { requireAdmin, requireOwned } from "@/lib/session";
import { answerVersions } from "@/lib/views";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const a = await requireOwned(admin.id, "answers", (await params).id);
  return json({ versions: await answerVersions(a.id) });
});
