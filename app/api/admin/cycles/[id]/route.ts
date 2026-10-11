import { z } from "zod";
import { one, query } from "@/lib/db";
import { body, conflict, json, route } from "@/lib/http";
import { requireAdmin, requireOwned } from "@/lib/session";
import { cycleView } from "@/lib/cycles";
import { publish } from "@/lib/events";

type Ctx = { params: Promise<{ id: string }> };
const Patch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  note: z.string().trim().max(2000).optional(),
  minutes: z.number().min(1).max(1440).optional(),
  carryForward: z.boolean().optional(),
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const c = await requireOwned(admin.id, "cycles", (await params).id);
  const b = await body(req, Patch);
  if ((b.minutes !== undefined || b.carryForward !== undefined) && c.status !== "draft")
    throw conflict("Duration and carry-forward can only be changed before the cycle starts. Use extend instead.");
  const row = await one(
    `UPDATE cycles SET name=COALESCE($2,name), note=COALESCE($3,note), duration_ms=COALESCE($4,duration_ms), carry_forward=COALESCE($5,carry_forward), updated_at=now()
      WHERE id=$1 RETURNING *`,
    [c.id, b.name ?? null, b.note ?? null, b.minutes !== undefined ? Math.round(b.minutes * 60_000) : null, b.carryForward ?? null],
  );
  await publish({ t: "cycle", projectId: c.project_id, cycleId: c.id });
  return json({ cycle: cycleView(row) });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const c = await requireOwned(admin.id, "cycles", (await params).id);
  if (c.status === "running" || c.status === "paused") throw conflict("End the cycle before deleting it.");
  const force = new URL(req.url).searchParams.get("force") === "true";
  const n = await one(`SELECT count(*)::int AS n FROM contributions WHERE cycle_id=$1`, [c.id]);
  if (n.n > 0 && !force) throw conflict(`This cycle has ${n.n} contributions. Deleting it removes them and their answers permanently.`);
  await query(`DELETE FROM cycles WHERE id=$1`, [c.id]);
  await publish({ t: "cycle", projectId: c.project_id, cycleId: c.id });
  return json({ ok: true });
});
