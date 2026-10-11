import { z } from "zod";
import { one, query } from "@/lib/db";
import { body, json, route } from "@/lib/http";
import { requireAdmin, requireProject } from "@/lib/session";
import { enqueue } from "@/lib/jobs";
import { publish } from "@/lib/events";

type Ctx = { params: Promise<{ id: string }> };
const Create = z.object({ cycleId: z.string().uuid().nullable().default(null) });

export const GET = route<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  const rows = await query(
    `SELECT s.*, c.name AS cycle_name FROM project_syntheses s LEFT JOIN cycles c ON c.id=s.cycle_id WHERE s.project_id=$1 ORDER BY s.created_at DESC LIMIT 20`,
    [p.id],
  );
  return json({
    syntheses: rows.map((r) => ({
      id: r.id, cycleId: r.cycle_id, cycleName: r.cycle_name, status: r.status, content: r.content, provider: r.provider, model: r.model,
      isFallback: r.is_fallback, error: r.error, createdAt: r.created_at, completedAt: r.completed_at,
    })),
  });
});

export const POST = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  const { cycleId } = await body(req, Create);
  if (cycleId) {
    const c = await one(`SELECT 1 FROM cycles WHERE id=$1 AND project_id=$2`, [cycleId, p.id]);
    if (!c) return json({ error: "Cycle not found." }, { status: 404 });
  }
  const s = await one(`INSERT INTO project_syntheses(project_id, cycle_id) VALUES ($1,$2) RETURNING id`, [p.id, cycleId]);
  await enqueue("project_synthesis", { synthesisId: s.id }, { maxAttempts: 3 });
  await publish({ t: "project_synthesis", projectId: p.id, id: s.id });
  return json({ id: s.id }, { status: 202 });
});
