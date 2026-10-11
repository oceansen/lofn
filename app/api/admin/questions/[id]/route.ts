import { z } from "zod";
import { one, query } from "@/lib/db";
import { body, conflict, json, route } from "@/lib/http";
import { requireAdmin, requireOwned } from "@/lib/session";
import { publish } from "@/lib/events";

type Ctx = { params: Promise<{ id: string }> };
const Patch = z.object({ title: z.string().trim().min(1).max(1000).optional(), instructions: z.string().trim().max(5000).optional() });

export const PATCH = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const q = await requireOwned(admin.id, "questions", (await params).id);
  const b = await body(req, Patch);
  const row = await one(`UPDATE questions SET title=COALESCE($2,title), instructions=COALESCE($3,instructions), updated_at=now() WHERE id=$1 RETURNING *`, [
    q.id, b.title ?? null, b.instructions ?? null,
  ]);
  await publish({ t: "project", projectId: q.project_id });
  return json({ question: row });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const q = await requireOwned(admin.id, "questions", (await params).id);
  const force = new URL(req.url).searchParams.get("force") === "true";
  const n = await one(`SELECT count(*)::int AS n FROM contributions WHERE question_id=$1`, [q.id]);
  if (n.n > 0 && !force) throw conflict(`This question has ${n.n} contributions. Deleting it removes them and their answers permanently.`);
  await query(`DELETE FROM questions WHERE id=$1`, [q.id]);
  await publish({ t: "project", projectId: q.project_id });
  return json({ ok: true });
});
