import { z } from "zod";
import { one, query, tx } from "@/lib/db";
import { body, conflict, json, route } from "@/lib/http";
import { requireAdmin, requireOwned } from "@/lib/session";
import { generateAccessCode } from "@/lib/security";
import { publish } from "@/lib/events";
import { ensureAnswers } from "@/lib/cycles";

type Ctx = { params: Promise<{ id: string }> };
const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  codeActive: z.boolean().optional(),
  regenerateCode: z.boolean().optional(),
  questionIds: z.array(z.string().uuid()).optional(),
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const g = await requireOwned(admin.id, "groups", (await params).id);
  const b = await body(req, Patch);
  const row = await tx(async (db) => {
    let row = await one(`UPDATE groups SET name=COALESCE($2,name), code_active=COALESCE($3,code_active) WHERE id=$1 RETURNING *`, [g.id, b.name ?? null, b.codeActive ?? null], db);
    if (b.regenerateCode) {
      row = await one(`UPDATE groups SET access_code=$2 WHERE id=$1 RETURNING *`, [g.id, generateAccessCode()], db);
      // Existing sessions keep working; new joins need the new code. Revoke sessions too:
      await db.query(`DELETE FROM participants WHERE group_id=$1 AND NOT EXISTS (SELECT 1 FROM contributions c WHERE c.participant_id = participants.id)`, [g.id]);
      await db.query(`UPDATE participants SET token_hash = 'revoked:' || id WHERE group_id=$1`, [g.id]);
    }
    if (b.questionIds) {
      await db.query(`DELETE FROM group_questions WHERE group_id=$1 AND NOT (question_id = ANY($2::uuid[]))`, [g.id, b.questionIds]);
      await db.query(
        `INSERT INTO group_questions(group_id, question_id) SELECT $1, id FROM questions WHERE project_id=$2 AND id = ANY($3::uuid[]) ON CONFLICT DO NOTHING`,
        [g.id, g.project_id, b.questionIds],
      );
      const live = await one(`SELECT id FROM cycles WHERE project_id=$1 AND status IN ('running','paused')`, [g.project_id], db);
      if (live) await ensureAnswers(live.id, db);
    }
    return row;
  });
  await publish({ t: "project", projectId: g.project_id, groupId: g.id });
  return json({ group: { id: row.id, name: row.name, accessCode: row.access_code, codeActive: row.code_active } });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const g = await requireOwned(admin.id, "groups", (await params).id);
  const force = new URL(req.url).searchParams.get("force") === "true";
  const n = await one(`SELECT count(*)::int AS n FROM contributions WHERE group_id=$1`, [g.id]);
  if (n.n > 0 && !force) throw conflict(`This group has ${n.n} contributions. Deleting it removes them and its answers permanently.`);
  await query(`DELETE FROM groups WHERE id=$1`, [g.id]);
  await publish({ t: "project", projectId: g.project_id });
  return json({ ok: true });
});
