import { config } from "./config";
import { one, query, tx, type Queryable } from "./db";
import { conflict, badRequest } from "./http";
import { enqueue } from "./jobs";
import { publish } from "./events";

export type CycleRow = {
  id: string;
  project_id: string;
  name: string;
  position: number;
  note: string;
  status: "draft" | "running" | "paused" | "ended";
  duration_ms: number;
  carry_forward: boolean;
  started_at: Date | null;
  ends_at: Date | null;
  remaining_ms: number | null;
  ended_at: Date | null;
  next_synthesis_at: Date | null;
  final_status: "none" | "pending" | "done";
  created_at: Date;
};

export function remainingMs(c: CycleRow, now = Date.now()): number {
  if (c.status === "running" && c.ends_at) return Math.max(0, new Date(c.ends_at).getTime() - now);
  if (c.status === "paused") return Math.max(0, c.remaining_ms ?? 0);
  if (c.status === "draft") return c.duration_ms;
  return 0;
}

/** Public, serialisable view. Clients derive the countdown from endsAt + server clock offset. */
export function cycleView(c: CycleRow) {
  return {
    id: c.id,
    name: c.name,
    note: c.note,
    position: c.position,
    status: c.status,
    durationMs: c.duration_ms,
    carryForward: c.carry_forward,
    startedAt: c.started_at,
    endsAt: c.status === "running" ? c.ends_at : null,
    remainingMs: remainingMs(c),
    endedAt: c.ended_at,
    nextSynthesisAt: c.status === "running" || c.status === "paused" ? c.next_synthesis_at : null,
    finalStatus: c.final_status,
    serverNow: Date.now(),
  };
}
export type CycleView = ReturnType<typeof cycleView>;

/** End every running cycle whose time is up. Safe to call from any process, any number of times. */
export async function expireDueCycles(): Promise<number> {
  // Status change and final-synthesis jobs commit together, so a crash can't strand a cycle in 'pending'.
  return tx(async (db) => {
    const ended = await query<CycleRow>(
      `UPDATE cycles SET status='ended', ended_at = ends_at, remaining_ms = 0, final_status='pending', updated_at=now()
        WHERE status='running' AND ends_at <= now() RETURNING *`,
      [],
      db,
    );
    for (const c of ended) await afterEnd(c, db);
    return ended.length;
  });
}

/** Safety net: re-arm finalisation for ended cycles whose finalize job is missing (e.g. failed or lost). */
export async function rearmPendingFinals() {
  const stuck = await query<{ id: string }>(
    `SELECT c.id FROM cycles c WHERE c.status='ended' AND c.final_status='pending' AND c.updated_at < now() - interval '30 seconds'
        AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.dedupe_key = 'finalize:' || c.id AND j.status IN ('queued','running'))`,
  );
  for (const c of stuck) await tx((db) => enqueueFinalSynthesis(c.id, db));
  return stuck.length;
}

async function afterEnd(c: CycleRow, db?: Queryable) {
  await enqueueFinalSynthesis(c.id, db);
  await publish({ t: "cycle", projectId: c.project_id, cycleId: c.id }, db);
}

export async function enqueueFinalSynthesis(cycleId: string, db?: Queryable) {
  const answers = await query<{ id: string }>(`SELECT id FROM answers WHERE cycle_id=$1`, [cycleId], db);
  for (const a of answers) await enqueue("synthesize", { answerId: a.id, trigger: "final" }, { dedupeKey: `synth:${a.id}`, maxAttempts: 8 }, db);
  await enqueue("finalize_check", { cycleId, startedAt: Date.now() }, { dedupeKey: `finalize:${cycleId}`, delayMs: 3000, maxAttempts: 200 }, db);
}

/** Make sure an answer row exists for every assigned group×question in this cycle. */
export async function ensureAnswers(cycleId: string, db: Queryable) {
  await db.query(
    `INSERT INTO answers(project_id, cycle_id, group_id, question_id)
     SELECT c.project_id, c.id, gq.group_id, gq.question_id
       FROM cycles c JOIN groups g ON g.project_id = c.project_id
       JOIN group_questions gq ON gq.group_id = g.id
      WHERE c.id = $1
     ON CONFLICT (cycle_id, group_id, question_id) DO NOTHING`,
    [cycleId],
  );
}

/** Seed each answer with the previous cycle's latest answer so groups refine rather than restart. */
async function carryForward(c: CycleRow, db: Queryable) {
  const prev = await one<{ id: string; name: string }>(
    `SELECT id, name FROM cycles WHERE project_id=$1 AND id <> $2 AND status='ended'
      ORDER BY COALESCE(ended_at, created_at) DESC LIMIT 1`,
    [c.project_id, c.id],
    db,
  );
  if (!prev) return;
  const pairs = await query(
    `SELECT a.id AS new_id, pa.id AS old_id, pv.content, pv.provider, pv.model, pv.is_fallback
       FROM answers a
       JOIN answers pa ON pa.cycle_id=$2 AND pa.group_id=a.group_id AND pa.question_id=a.question_id AND pa.current_version > 0
       JOIN answer_versions pv ON pv.answer_id = pa.id AND pv.version = pa.current_version
      WHERE a.cycle_id=$1 AND a.current_version = 0`,
    [c.id, prev.id],
    db,
  );
  for (const p of pairs) {
    await db.query(
      `INSERT INTO answer_versions(answer_id, version, content, change_note, trigger, provider, model, is_fallback)
       VALUES ($1, 1, $2, $3, 'carry', $4, $5, $6)`,
      [p.new_id, p.content, `Carried forward from “${prev.name}” as the starting point for this round.`, p.provider, p.model, p.is_fallback],
    );
    await db.query(`UPDATE answers SET current_version = 1, updated_at=now() WHERE id=$1`, [p.new_id]);
    await db.query(
      `INSERT INTO answer_contributions(answer_id, contribution_id, state, version)
       SELECT $1, contribution_id, state, 1 FROM answer_contributions WHERE answer_id=$2 AND state='included'
       ON CONFLICT DO NOTHING`,
      [p.new_id, p.old_id],
    );
  }
}

export type CycleAction = { action: "start" | "pause" | "resume" | "extend" | "end" | "reopen"; minutes?: number };

export async function controlCycle(cycleId: string, act: CycleAction): Promise<CycleRow> {
  try {
    return await controlCycleTx(cycleId, act);
  } catch (e: any) {
    if (e?.code === "23505") throw conflict("Another cycle in this project is live. End it first.");
    throw e;
  }
}

async function controlCycleTx(cycleId: string, act: CycleAction): Promise<CycleRow> {
  const intervalMs = config.synthesis.intervalMs;
  const res = await tx(async (db) => {
    const c = await one<CycleRow>(`SELECT * FROM cycles WHERE id=$1 FOR UPDATE`, [cycleId], db);
    if (!c) throw badRequest("Cycle not found.");
    const addMs = Math.round((act.minutes ?? 0) * 60_000);
    let updated: CycleRow | null = null;
    switch (act.action) {
      case "start": {
        if (c.status !== "draft") throw conflict("Only a cycle that hasn't started can be started.");
        const live = await one(`SELECT name FROM cycles WHERE project_id=$1 AND status IN ('running','paused')`, [c.project_id], db);
        if (live) throw conflict(`“${live.name}” is still live. End it before starting another cycle.`);
        updated = await one<CycleRow>(
          `UPDATE cycles SET status='running', started_at=now(), ends_at = now() + (duration_ms || ' milliseconds')::interval,
                  remaining_ms=NULL, next_synthesis_at = now() + ($2 || ' milliseconds')::interval, updated_at=now()
            WHERE id=$1 RETURNING *`,
          [cycleId, String(intervalMs)],
          db,
        );
        await ensureAnswers(cycleId, db);
        if (c.carry_forward) await carryForward(updated!, db);
        break;
      }
      case "pause": {
        if (c.status !== "running") throw conflict("Only a running cycle can be paused.");
        updated = await one<CycleRow>(
          `UPDATE cycles SET status='paused', remaining_ms = GREATEST(0, (EXTRACT(EPOCH FROM (ends_at - now())) * 1000)::bigint),
                  ends_at=NULL, updated_at=now() WHERE id=$1 RETURNING *`,
          [cycleId],
          db,
        );
        break;
      }
      case "resume": {
        if (c.status !== "paused") throw conflict("Only a paused cycle can be resumed.");
        updated = await one<CycleRow>(
          `UPDATE cycles SET status='running', ends_at = now() + (remaining_ms || ' milliseconds')::interval, remaining_ms=NULL,
                  next_synthesis_at = LEAST(COALESCE(next_synthesis_at, now()), now() + ($2 || ' milliseconds')::interval), updated_at=now()
            WHERE id=$1 RETURNING *`,
          [cycleId, String(intervalMs)],
          db,
        );
        break;
      }
      case "extend": {
        if (addMs <= 0 || addMs > 24 * 3600_000) throw badRequest("Extend by between 1 minute and 24 hours.");
        if (c.status === "running") {
          updated = await one<CycleRow>(
            `UPDATE cycles SET ends_at = ends_at + ($2 || ' milliseconds')::interval, duration_ms = duration_ms + $2::bigint, updated_at=now()
              WHERE id=$1 RETURNING *`,
            [cycleId, String(addMs)],
            db,
          );
        } else if (c.status === "paused") {
          updated = await one<CycleRow>(
            `UPDATE cycles SET remaining_ms = remaining_ms + $2::bigint, duration_ms = duration_ms + $2::bigint, updated_at=now()
              WHERE id=$1 RETURNING *`,
            [cycleId, String(addMs)],
            db,
          );
        } else if (c.status === "draft") {
          updated = await one<CycleRow>(`UPDATE cycles SET duration_ms = duration_ms + $2::bigint, updated_at=now() WHERE id=$1 RETURNING *`, [
            cycleId,
            String(addMs),
          ], db);
        } else throw conflict("This cycle has ended. Use reopen to add more time.");
        break;
      }
      case "reopen": {
        if (c.status !== "ended") throw conflict("Only an ended cycle can be reopened.");
        if (addMs <= 0) throw badRequest("Choose how many minutes to reopen for.");
        const live = await one(`SELECT name FROM cycles WHERE project_id=$1 AND status IN ('running','paused') AND id<>$2`, [c.project_id, c.id], db);
        if (live) throw conflict(`“${live.name}” is live. End it before reopening another cycle.`);
        updated = await one<CycleRow>(
          `UPDATE cycles SET status='running', ends_at = now() + ($2 || ' milliseconds')::interval, duration_ms = duration_ms + $2::bigint,
                  ended_at=NULL, final_status='none', next_synthesis_at = now() + ($3 || ' milliseconds')::interval, updated_at=now()
            WHERE id=$1 RETURNING *`,
          [cycleId, String(addMs), String(intervalMs)],
          db,
        );
        await db.query(`UPDATE answers SET is_final=false WHERE cycle_id=$1`, [cycleId]);
        // Final syntheses still waiting from the previous end must not re-finalise a running cycle.
        await db.query(
          `UPDATE jobs SET payload = payload || '{"trigger":"tick"}'::jsonb
            WHERE status='queued' AND type='synthesize' AND payload->>'answerId' IN (SELECT id::text FROM answers WHERE cycle_id=$1)`,
          [cycleId],
        );
        await db.query(`UPDATE jobs SET status='done' WHERE status='queued' AND dedupe_key=$1`, [`finalize:${cycleId}`]);
        await ensureAnswers(cycleId, db);
        break;
      }
      case "end": {
        if (c.status !== "running" && c.status !== "paused") throw conflict("Only a live cycle can be ended.");
        updated = await one<CycleRow>(
          `UPDATE cycles SET status='ended', ended_at=now(), ends_at=NULL, remaining_ms=0, final_status='pending', updated_at=now()
            WHERE id=$1 RETURNING *`,
          [cycleId],
          db,
        );
        await enqueueFinalSynthesis(cycleId, db);
        break;
      }
    }
    await publish({ t: "cycle", projectId: c.project_id, cycleId }, db);
    return updated!;
  });
  return res;
}

/** The cycle participants should see: live one, else most recently ended, else next draft. */
export async function currentCycleForProject(projectId: string, db?: Queryable): Promise<CycleRow | null> {
  await expireDueCycles();
  return one<CycleRow>(
    `SELECT * FROM cycles WHERE project_id=$1
      ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'paused' THEN 0 WHEN 'ended' THEN 1 ELSE 2 END,
               CASE WHEN status='ended' THEN extract(epoch from ended_at) ELSE -position END DESC NULLS LAST
      LIMIT 1`,
    [projectId],
    db,
  );
}
