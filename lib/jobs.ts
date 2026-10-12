import { pool, query, one, type Queryable } from "./db";

export type JobType =
  | "process_context_file"
  | "process_contribution"
  | "synthesize"
  | "finalize_check"
  | "project_synthesis"
  | "retention_sweep"
  | "purge_media"
  | "delete_storage";

export type Job = {
  id: number;
  type: JobType;
  payload: any;
  dedupe_key: string | null;
  attempts: number;
  max_attempts: number;
  created_at: Date;
};

export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  opts: { dedupeKey?: string; delayMs?: number; maxAttempts?: number } = {},
  db: Queryable = pool,
) {
  // A queued job with the same dedupe key absorbs the new request (earliest run time wins).
  await db.query(
    `INSERT INTO jobs(type, payload, dedupe_key, run_at, max_attempts)
     VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval, $5)
     ON CONFLICT (dedupe_key) WHERE status = 'queued' AND dedupe_key IS NOT NULL
     DO UPDATE SET run_at = LEAST(jobs.run_at, EXCLUDED.run_at), payload = jobs.payload || EXCLUDED.payload, updated_at = now()`,
    [type, JSON.stringify(payload), opts.dedupeKey ?? null, String(opts.delayMs ?? 0), opts.maxAttempts ?? 5],
  );
}

export async function claim(workerId: string, lockSeconds = 900): Promise<Job | null> {
  return one<Job>(
    `UPDATE jobs SET status='running', locked_by=$1, locked_until=now() + ($2 || ' seconds')::interval,
            attempts = attempts + 1, updated_at = now()
      WHERE id = (SELECT id FROM jobs WHERE status='queued' AND run_at <= now()
                  ORDER BY run_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, type, payload, dedupe_key, attempts, max_attempts, created_at, locked_by`,
    [workerId, String(lockSeconds)],
  );
}

export type ClaimedJob = Job & { locked_by: string };

/** Mark done, but only if this worker still holds the job (it may have been reaped and re-run elsewhere). */
export async function complete(job: Job) {
  await query(`UPDATE jobs SET status='done', locked_by=NULL, locked_until=NULL, updated_at=now() WHERE id=$1 AND status='running' AND locked_by=$2`, [
    job.id,
    (job as ClaimedJob).locked_by,
  ]);
}

/** Put a running job back in the queue. If an identical job is already queued, this one is folded into it. */
async function requeue(job: Job, delayMs: number, countAttempt: boolean, error?: string) {
  try {
    await query(
      `UPDATE jobs SET status='queued', locked_by=NULL, locked_until=NULL,
              run_at = now() + ($2 || ' milliseconds')::interval,
              attempts = attempts - $3, last_error = COALESCE($4, last_error), updated_at = now()
        WHERE id=$1 AND status='running' AND locked_by IS NOT DISTINCT FROM $5`,
      [job.id, String(delayMs), countAttempt ? 0 : 1, error ?? null, (job as ClaimedJob).locked_by ?? null],
    );
  } catch (e: any) {
    if (e?.code === "23505") return complete(job); // an identical job is already queued
    throw e;
  }
}

export const reschedule = (job: Job, delayMs: number) => requeue(job, delayMs, false);

export async function fail(job: Job, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (job.attempts >= job.max_attempts) {
    await query(
      `UPDATE jobs SET status='failed', last_error=$2, locked_by=NULL, locked_until=NULL, updated_at=now() WHERE id=$1 AND status='running' AND locked_by=$3`,
      [job.id, message.slice(0, 2000), (job as ClaimedJob).locked_by],
    );
    return;
  }
  const backoff = Math.min(60_000, 2000 * 2 ** (job.attempts - 1));
  await requeue(job, backoff, true, message.slice(0, 2000));
}

/** Recover jobs whose worker died mid-run. */
export async function reapStale() {
  // Jobs that keep killing their worker (e.g. OOM in ffmpeg) stop after max_attempts.
  await query(
    `UPDATE jobs SET status='failed', last_error='worker lease expired too many times', locked_by=NULL, locked_until=NULL, updated_at=now()
      WHERE status='running' AND locked_until < now() AND attempts >= max_attempts`,
  );
  const stale = await query<ClaimedJob>(
    `SELECT id, type, payload, dedupe_key, attempts, max_attempts, created_at, locked_by FROM jobs WHERE status='running' AND locked_until < now()`,
  );
  for (const j of stale) await requeue(j, 0, true, "worker lease expired");
  // Keep the table small.
  await query(`DELETE FROM jobs WHERE status='done' AND updated_at < now() - interval '2 days'`);
  return stale.length;
}
