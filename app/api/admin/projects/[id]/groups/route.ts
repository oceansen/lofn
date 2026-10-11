import { z } from "zod";
import { one, tx } from "@/lib/db";
import { body, json, route } from "@/lib/http";
import { requireAdmin, requireProject } from "@/lib/session";
import { generateAccessCode } from "@/lib/security";
import { publish } from "@/lib/events";
import { ensureAnswers } from "@/lib/cycles";
import { projectOverview } from "@/lib/views";

type Ctx = { params: Promise<{ id: string }> };
const Create = z.object({
  names: z.array(z.string().trim().min(1).max(120)).min(1).max(100),
  questionIds: z.array(z.string().uuid()).optional(), // default: all questions
});

export const GET = route<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  const o = await projectOverview(p.id);
  return json({ groups: o.groups, questions: o.questions });
});

export const POST = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  const b = await body(req, Create);
  const created = await tx(async (db) => {
    const out = [];
    for (const name of b.names) {
      let g = null;
      for (let i = 0; i < 5 && !g; i++) {
        try {
          await db.query("SAVEPOINT code");
          g = await one(`INSERT INTO groups(project_id, name, access_code) VALUES ($1,$2,$3) RETURNING *`, [p.id, name, generateAccessCode()], db);
        } catch (e: any) {
          await db.query("ROLLBACK TO SAVEPOINT code");
          if (e.code !== "23505") throw e; // code collision: retry
        }
      }
      if (b.questionIds)
        await db.query(
          `INSERT INTO group_questions(group_id, question_id) SELECT $1, id FROM questions WHERE project_id=$2 AND id = ANY($3::uuid[])`,
          [g.id, p.id, b.questionIds],
        );
      else await db.query(`INSERT INTO group_questions(group_id, question_id) SELECT $1, id FROM questions WHERE project_id=$2`, [g.id, p.id]);
      out.push(g);
    }
    const live = await one(`SELECT id FROM cycles WHERE project_id=$1 AND status IN ('running','paused')`, [p.id], db);
    if (live) await ensureAnswers(live.id, db);
    return out;
  });
  await publish({ t: "project", projectId: p.id });
  return json({ groups: created.map((g) => ({ id: g.id, name: g.name, accessCode: g.access_code })) }, { status: 201 });
});
