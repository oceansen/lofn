import { z } from "zod";
import { one, query } from "@/lib/db";
import { body, json, route } from "@/lib/http";
import { requireAdmin } from "@/lib/session";
import { projectView } from "@/lib/views";
import { expireDueCycles } from "@/lib/cycles";

const ProjectSchema = z.object({
  name: z.string().trim().min(1, "Give the project a name.").max(200),
  description: z.string().trim().max(5000).default(""),
  defaultCycleMinutes: z.number().int().min(1).max(1440).default(15),
  mediaRetentionDays: z.number().int().min(0).max(3650).nullable().default(null),
  synthesisGuidance: z.string().trim().max(3000).default(""),
});

export const GET = route(async () => {
  const admin = await requireAdmin();
  await expireDueCycles();
  const rows = await query(
    `SELECT p.*,
       (SELECT count(*)::int FROM questions q WHERE q.project_id=p.id) AS question_count,
       (SELECT count(*)::int FROM groups g WHERE g.project_id=p.id) AS group_count,
       (SELECT count(*)::int FROM contributions c WHERE c.project_id=p.id) AS contribution_count,
       (SELECT row_to_json(c) FROM (SELECT id, name, status, ends_at, remaining_ms, duration_ms, final_status FROM cycles
          WHERE project_id=p.id ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'paused' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1) c) AS cycle,
       (SELECT count(*)::int FROM answers a WHERE a.project_id=p.id AND a.status IN ('queued','synthesizing')) AS synthesizing
     FROM projects p WHERE p.owner_id=$1 ORDER BY p.status, p.updated_at DESC`,
    [admin.id],
  );
  return json({
    projects: rows.map((r) => ({
      ...projectView(r),
      questionCount: r.question_count,
      groupCount: r.group_count,
      contributionCount: r.contribution_count,
      synthesizing: r.synthesizing,
      cycle: r.cycle,
    })),
    serverNow: Date.now(),
  });
});

export const POST = route(async (req) => {
  const admin = await requireAdmin();
  const p = await body(req, ProjectSchema);
  const row = await one(
    `INSERT INTO projects(owner_id, name, description, default_cycle_minutes, media_retention_days, synthesis_guidance)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [admin.id, p.name, p.description, p.defaultCycleMinutes, p.mediaRetentionDays, p.synthesisGuidance],
  );
  return json({ project: projectView(row) }, { status: 201 });
});
