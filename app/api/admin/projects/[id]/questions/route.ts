import { z } from "zod";
import { one, query, tx } from "@/lib/db";
import { body, json, route, badRequest } from "@/lib/http";
import { requireAdmin, requireProject } from "@/lib/session";
import { questionsFor } from "@/lib/views";
import { publish } from "@/lib/events";
import { ensureAnswers } from "@/lib/cycles";

type Ctx = { params: Promise<{ id: string }> };

const Create = z.object({
  title: z.string().trim().min(1, "Write the question.").max(1000),
  instructions: z.string().trim().max(5000).default(""),
  assignToAllGroups: z.boolean().default(true),
});
const Reorder = z.object({ order: z.array(z.string().uuid()) });

export const GET = route<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  return json({ questions: await questionsFor(p.id) });
});

export const POST = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  const b = await body(req, Create);
  const q = await tx(async (db) => {
    const q = await one(
      `INSERT INTO questions(project_id, position, title, instructions)
       VALUES ($1, COALESCE((SELECT max(position)+1 FROM questions WHERE project_id=$1), 0), $2, $3) RETURNING *`,
      [p.id, b.title, b.instructions],
      db,
    );
    if (b.assignToAllGroups) {
      await db.query(`INSERT INTO group_questions(group_id, question_id) SELECT id, $2 FROM groups WHERE project_id=$1 ON CONFLICT DO NOTHING`, [p.id, q.id]);
      const live = await one(`SELECT id FROM cycles WHERE project_id=$1 AND status IN ('running','paused')`, [p.id], db);
      if (live) await ensureAnswers(live.id, db);
    }
    return q;
  });
  await publish({ t: "project", projectId: p.id });
  return json({ question: q }, { status: 201 });
});

// PUT = reorder
export const PUT = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  const { order } = await body(req, Reorder);
  const existing = await query(`SELECT id FROM questions WHERE project_id=$1`, [p.id]);
  if (existing.length !== order.length || !existing.every((e) => order.includes(e.id))) throw badRequest("Order must list every question once.");
  await tx(async (db) => {
    for (const [i, id] of order.entries()) await db.query(`UPDATE questions SET position=$1 WHERE id=$2`, [i, id]);
  });
  await publish({ t: "project", projectId: p.id });
  return json({ questions: await questionsFor(p.id) });
});
