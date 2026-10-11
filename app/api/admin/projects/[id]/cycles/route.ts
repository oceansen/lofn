import { z } from "zod";
import { one } from "@/lib/db";
import { body, json, route } from "@/lib/http";
import { requireAdmin, requireProject } from "@/lib/session";
import { cyclesFor } from "@/lib/views";
import { cycleView } from "@/lib/cycles";
import { publish } from "@/lib/events";

type Ctx = { params: Promise<{ id: string }> };
const Create = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  minutes: z.number().min(1).max(1440),
  note: z.string().trim().max(2000).default(""),
  carryForward: z.boolean().default(false),
});

export const GET = route<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  return json({ cycles: await cyclesFor(p.id), serverNow: Date.now() });
});

export const POST = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  const b = await body(req, Create);
  const count = await one(`SELECT count(*)::int AS n, COALESCE(max(position)+1, 0) AS pos FROM cycles WHERE project_id=$1`, [p.id]);
  const row = await one(
    `INSERT INTO cycles(project_id, name, position, note, duration_ms, carry_forward) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [p.id, b.name || `Round ${count.n + 1}`, count.pos, b.note, Math.round(b.minutes * 60_000), b.carryForward],
  );
  await publish({ t: "cycle", projectId: p.id, cycleId: row.id });
  return json({ cycle: cycleView(row) }, { status: 201 });
});
