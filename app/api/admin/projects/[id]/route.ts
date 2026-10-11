import { z } from "zod";
import { one, query } from "@/lib/db";
import { body, conflict, json, route } from "@/lib/http";
import { requireAdmin, requireProject } from "@/lib/session";
import { projectView } from "@/lib/views";
import { scheduleStorageDeletion } from "@/lib/retention";
import { publish } from "@/lib/events";

type Ctx = { params: Promise<{ id: string }> };

const Patch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  defaultCycleMinutes: z.number().int().min(1).max(1440).optional(),
  mediaRetentionDays: z.number().int().min(0).max(3650).nullable().optional(),
  synthesisGuidance: z.string().trim().max(3000).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

export const GET = route<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  return json({ project: projectView(p) });
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  const b = await body(req, Patch);
  if (b.status === "archived") {
    const live = await one(`SELECT 1 FROM cycles WHERE project_id=$1 AND status IN ('running','paused')`, [p.id]);
    if (live) throw conflict("End the live cycle before archiving the project.");
  }
  const row = await one(
    `UPDATE projects SET name=COALESCE($2,name), description=COALESCE($3,description), default_cycle_minutes=COALESCE($4,default_cycle_minutes),
            media_retention_days = CASE WHEN $5::boolean THEN $6::int ELSE media_retention_days END,
            synthesis_guidance=COALESCE($7,synthesis_guidance), status=COALESCE($8,status), updated_at=now()
      WHERE id=$1 RETURNING *`,
    [p.id, b.name ?? null, b.description ?? null, b.defaultCycleMinutes ?? null, b.mediaRetentionDays !== undefined, b.mediaRetentionDays ?? null, b.synthesisGuidance ?? null, b.status ?? null],
  );
  await publish({ t: "project", projectId: p.id });
  return json({ project: projectView(row) });
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  await scheduleStorageDeletion(p.id);
  await query(`DELETE FROM projects WHERE id=$1`, [p.id]);
  return json({ ok: true });
});
