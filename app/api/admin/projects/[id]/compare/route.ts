import { json, route } from "@/lib/http";
import { requireAdmin, requireProject, isUuid } from "@/lib/session";
import { answers, cyclesFor, questionsFor } from "@/lib/views";
import { query } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  const sp = new URL(req.url).searchParams;
  const cycles = await cyclesFor(p.id);
  const questions = await questionsFor(p.id);
  const requested = sp.get("cycle");
  // Only cycles of this project are accepted.
  const cycleId = (requested && isUuid(requested) && cycles.find((c) => c.id === requested)?.id) || cycles.find((c) => c.status !== "draft")?.id || null;
  const groups = await query(`SELECT id, name FROM groups WHERE project_id=$1 ORDER BY created_at`, [p.id]);
  const list = cycleId ? await answers(`a.cycle_id=$1 AND a.project_id=$2`, [cycleId, p.id]) : [];
  return json({ cycles, questions, groups, cycleId, answers: list });
});
