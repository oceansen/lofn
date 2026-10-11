/**
 * Lofn worker: durable job processing, server-side cycle clock, and the 60-second synthesis loop.
 * Run one or more instances; all coordination happens through Postgres (SKIP LOCKED + leases),
 * so instances can be added or restarted at any time without double-processing.
 */
import os from "node:os";
import { config } from "../lib/config";
import { aiStatus } from "../lib/ai/settings";
import { pool, query, one } from "../lib/db";
import { claim, complete, enqueue, fail, reapStale, reschedule, type Job } from "../lib/jobs";
import { expireDueCycles, rearmPendingFinals } from "../lib/cycles";
import { publish } from "../lib/events";
import { answersNeedingSynthesis, synthesizeAnswer } from "../lib/synthesis";
import { processContribution, hasFfmpeg } from "../lib/media-processing";
import { runProjectSynthesis } from "../lib/project-synthesis";
import { purgeProjectMedia, retentionSweep } from "../lib/retention";
import { storage } from "../lib/storage";
import { migrate } from "../scripts/migrate";

const workerId = `${os.hostname()}:${process.pid}`;
let stopping = false;

async function handle(job: Job) {
  // Never run two copies of the same logical job at once (e.g. an admin retry while one is in flight).
  if (job.dedupe_key) {
    const twin = await one(`SELECT 1 FROM jobs WHERE dedupe_key=$1 AND status='running' AND id<>$2 AND locked_until > now()`, [job.dedupe_key, job.id]);
    if (twin) return reschedule(job, 5000);
  }
  switch (job.type) {
    case "process_contribution":
      return processContribution(job.payload.contributionId, job.attempts, job.max_attempts);

    case "synthesize": {
      const r = await synthesizeAnswer(job.payload.answerId, job.payload.trigger ?? "tick", job.created_at);
      if (r === "busy") return reschedule(job, 5000);
      if (r === "wait") return reschedule(job, 5000);
      return;
    }

    case "finalize_check": {
      const { cycleId } = job.payload;
      const c = await one(`SELECT * FROM cycles WHERE id=$1`, [cycleId]);
      if (!c || c.status !== "ended" || c.final_status === "done") return;
      const open = await one(`SELECT count(*)::int AS n FROM answers WHERE cycle_id=$1 AND NOT is_final`, [cycleId]);
      const elapsed = (Date.now() - Number(job.payload.startedAt || 0)) / 1000;
      if (open.n > 0 && elapsed < config.synthesis.finalWaitSeconds + 600) return reschedule(job, 3000);
      await query(`UPDATE cycles SET final_status='done', updated_at=now() WHERE id=$1 AND status='ended'`, [cycleId]);
      await publish({ t: "cycle", projectId: c.project_id, cycleId });
      return;
    }

    case "project_synthesis":
      return runProjectSynthesis(job.payload.synthesisId);

    case "retention_sweep": {
      const n = await retentionSweep();
      if (n) console.log(`[worker] retention removed ${n} media files`);
      return;
    }

    case "purge_media": {
      const n = await purgeProjectMedia(job.payload.projectId);
      await publish({ t: "project", projectId: job.payload.projectId });
      console.log(`[worker] purged ${n} media files for project ${job.payload.projectId}`);
      return;
    }

    case "delete_storage":
      for (const k of job.payload.keys as string[]) await storage().delete(k).catch((e) => console.warn("[worker] delete failed", k, e.message));
      return;

    default:
      console.warn(`[worker] unknown job type ${job.type}; dropping`);
  }
}

async function runner(slot: number) {
  while (!stopping) {
    let job: Job | null = null;
    try {
      job = await claim(`${workerId}#${slot}`);
      if (!job) {
        await new Promise((r) => setTimeout(r, config.worker.pollMs));
        continue;
      }
      const t0 = Date.now();
      await handle(job);
      // handle() may already have requeued the job via reschedule(); complete only if still ours.
      await complete(job);
      if (Date.now() - t0 > 2000) console.log(`[worker] ${job.type} #${job.id} done in ${Date.now() - t0}ms`);
    } catch (e) {
      console.error(`[worker] ${job?.type} #${job?.id} failed (attempt ${job?.attempts}/${job?.max_attempts}):`, (e as Error).message);
      if (job) await fail(job, e).catch((err) => console.error("[worker] could not record failure", err));
      else await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/** Every second: end cycles whose time is up. Every few seconds: enqueue the per-minute synthesis. */
async function clock() {
  let lastReap = 0;
  let lastRetention = 0;
  while (!stopping) {
    try {
      await expireDueCycles();
      // Claim due cycles atomically so multiple workers don't double-schedule.
      const due = await query(
        `UPDATE cycles SET next_synthesis_at = now() + ($1 || ' milliseconds')::interval
          WHERE status IN ('running','paused') AND (next_synthesis_at IS NULL OR next_synthesis_at <= now())
          RETURNING id, project_id`,
        [String(config.synthesis.intervalMs)],
      );
      for (const c of due) {
        const ids = await answersNeedingSynthesis(c.id);
        for (const id of ids) {
          await query(`UPDATE answers SET status='queued' WHERE id=$1 AND status IN ('idle','error')`, [id]);
          await enqueue("synthesize", { answerId: id, trigger: "tick" }, { dedupeKey: `synth:${id}`, maxAttempts: 4 });
        }
        await publish({ t: "cycle", projectId: c.project_id, cycleId: c.id });
      }
      if (Date.now() - lastReap > 60_000) {
        lastReap = Date.now();
        const n = await reapStale();
        if (n) console.log(`[worker] recovered ${n} stale jobs`);
        const r = await rearmPendingFinals();
        if (r) console.log(`[worker] re-armed finalisation for ${r} cycles`);
      }
      if (Date.now() - lastRetention > 3600_000) {
        lastRetention = Date.now();
        await enqueue("retention_sweep", {}, { dedupeKey: "retention_sweep", maxAttempts: 2 });
      }
    } catch (e) {
      console.error("[worker] clock error", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main() {
  if (process.env.AUTO_MIGRATE !== "false") await migrate();
  const ai = await aiStatus();
  console.log(`[worker] ${workerId} starting with ${config.worker.concurrency} slots`);
  console.log(
    `[worker] AI synthesis: ${ai.isFallback ? "DEVELOPMENT FALLBACK (no provider configured)" : `${ai.synthesisProvider} / ${ai.synthesisModel}`}; ` +
      `vision: ${ai.visionFallback ? "off" : `${ai.visionProvider} / ${ai.visionModel}`}; ` +
      `transcription: ${ai.transcriptionFallback ? "not configured" : `${ai.transcriptionProvider} / ${ai.transcriptionModel}`}; ffmpeg: ${(await hasFfmpeg()) ? "yes" : "NO (video analysis disabled)"}`,
  );
  const tasks = [clock(), ...Array.from({ length: config.worker.concurrency }, (_, i) => runner(i))];
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log("[worker] shutting down…");
    setTimeout(() => process.exit(0), 15_000).unref();
    await Promise.allSettled(tasks);
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
