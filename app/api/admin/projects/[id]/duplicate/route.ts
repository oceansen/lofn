import { one, tx } from "@/lib/db";
import { json, route } from "@/lib/http";
import { requireAdmin, requireProject } from "@/lib/session";
import { generateAccessCode } from "@/lib/security";
import { projectView } from "@/lib/views";

type Ctx = { params: Promise<{ id: string }> };

/** Copy structure (questions, groups with fresh codes, assignments, draft cycles) without any contributions. */
export const POST = route<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const src = await requireProject(admin.id, (await params).id);
  const project = await tx(async (db) => {
    const p = await one(
      `INSERT INTO projects(owner_id, name, description, default_cycle_minutes, media_retention_days, synthesis_guidance)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [admin.id, `${src.name} (copy)`, src.description, src.default_cycle_minutes, src.media_retention_days, src.synthesis_guidance],
      db,
    );
    const qmap = new Map<string, string>();
    const qs = await db.query(`SELECT * FROM questions WHERE project_id=$1 ORDER BY position`, [src.id]);
    for (const q of qs.rows) {
      const n = await one(`INSERT INTO questions(project_id, position, title, instructions) VALUES ($1,$2,$3,$4) RETURNING id`, [p.id, q.position, q.title, q.instructions], db);
      qmap.set(q.id, n.id);
    }
    const gs = await db.query(`SELECT * FROM groups WHERE project_id=$1 ORDER BY created_at`, [src.id]);
    for (const g of gs.rows) {
      const n = await one(`INSERT INTO groups(project_id, name, access_code) VALUES ($1,$2,$3) RETURNING id`, [p.id, g.name, generateAccessCode()], db);
      const assigned = await db.query(`SELECT question_id FROM group_questions WHERE group_id=$1`, [g.id]);
      for (const a of assigned.rows) await db.query(`INSERT INTO group_questions(group_id, question_id) VALUES ($1,$2)`, [n.id, qmap.get(a.question_id)]);
    }
    const cs = await db.query(`SELECT * FROM cycles WHERE project_id=$1 ORDER BY position`, [src.id]);
    for (const c of cs.rows) {
      // Restore each cycle's originally configured length (extensions are folded into duration_ms).
      await db.query(`INSERT INTO cycles(project_id, name, position, note, duration_ms, carry_forward) VALUES ($1,$2,$3,$4,$5,$6)`, [
        p.id, c.name, c.position, c.note, c.duration_ms, c.carry_forward,
      ]);
    }
    return p;
  });
  return json({ project: projectView(project) }, { status: 201 });
});
