import { z } from "zod";
import { one, tx } from "./db";
import { generateAccessCode } from "./security";
import { saveQuestionImage } from "./question-images";

/** Lofn project file: structure only (no contributions), so a workshop can be set up in one step. */
export const ProjectFile = z.object({
  format: z.literal("lofn-project/v1"),
  project: z.object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(5000).default(""),
    defaultCycleMinutes: z.number().int().min(1).max(1440).default(15),
    mediaRetentionDays: z.number().int().min(0).max(3650).nullable().default(null),
    synthesisGuidance: z.string().max(3000).default(""),
  }),
  questions: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(1000),
        instructions: z.string().max(5000).default(""),
        image: z.object({ base64: z.string().max(12_000_000), alt: z.string().max(500).default("") }).optional(),
      }),
    )
    .min(1)
    .max(50),
  groups: z.union([
    z.object({ count: z.number().int().min(1).max(100), prefix: z.string().trim().max(60).default("Group") }),
    z.array(z.object({ name: z.string().trim().min(1).max(120), questions: z.array(z.number().int().min(0)).optional() })).max(100),
  ]),
  cycles: z
    .array(z.object({ name: z.string().trim().min(1).max(200), minutes: z.number().min(1).max(1440), note: z.string().max(2000).default(""), carryForward: z.boolean().default(false) }))
    .max(20)
    .default([]),
});
export type ProjectFileT = z.infer<typeof ProjectFile>;

export async function importProject(adminId: string, file: ProjectFileT) {
  return tx(async (db) => {
    const p = await one(
      `INSERT INTO projects(owner_id, name, description, default_cycle_minutes, media_retention_days, synthesis_guidance)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [adminId, file.project.name, file.project.description, file.project.defaultCycleMinutes, file.project.mediaRetentionDays, file.project.synthesisGuidance],
      db,
    );
    const qids: string[] = [];
    for (const [i, q] of file.questions.entries()) {
      const row = await one(`INSERT INTO questions(project_id, position, title, instructions) VALUES ($1,$2,$3,$4) RETURNING id`, [p.id, i, q.title, q.instructions], db);
      qids.push(row.id);
      if (q.image) await saveQuestionImage(row.id, Buffer.from(q.image.base64, "base64"), q.image.alt, db);
    }
    const groups = Array.isArray(file.groups)
      ? file.groups
      : Array.from({ length: file.groups.count }, (_, i) => ({ name: `${(file.groups as any).prefix} ${i + 1}`, questions: undefined }));
    for (const g of groups) {
      let row = null;
      for (let attempt = 0; attempt < 5 && !row; attempt++) {
        try {
          await db.query("SAVEPOINT code");
          row = await one(`INSERT INTO groups(project_id, name, access_code) VALUES ($1,$2,$3) RETURNING id`, [p.id, g.name, generateAccessCode()], db);
        } catch (e: any) {
          await db.query("ROLLBACK TO SAVEPOINT code");
          if (e.code !== "23505") throw e;
        }
      }
      const assigned = (g.questions ?? qids.map((_, i) => i)).filter((i) => i < qids.length).map((i) => qids[i]);
      for (const qid of assigned) await db.query(`INSERT INTO group_questions(group_id, question_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [row.id, qid]);
    }
    for (const [i, c] of file.cycles.entries())
      await db.query(`INSERT INTO cycles(project_id, name, position, note, duration_ms, carry_forward) VALUES ($1,$2,$3,$4,$5,$6)`, [
        p.id, c.name, i, c.note, Math.round(c.minutes * 60_000), c.carryForward,
      ]);
    return p.id as string;
  });
}
