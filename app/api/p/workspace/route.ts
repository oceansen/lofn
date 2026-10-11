import { json, route } from "@/lib/http";
import { requireParticipant, isUuid } from "@/lib/session";
import { one, query } from "@/lib/db";
import { cycleView, currentCycleForProject, type CycleRow } from "@/lib/cycles";
import { answers, contributions } from "@/lib/views";
import { aiStatus, config } from "@/lib/config";

/** Everything a participant may see: their project, their group, their assigned questions — nothing else. */
export const GET = route(async (req) => {
  const ctx = await requireParticipant();
  const requested = new URL(req.url).searchParams.get("cycle");
  let cycle: CycleRow | null = null;
  if (requested && isUuid(requested)) cycle = await one(`SELECT * FROM cycles WHERE id=$1 AND project_id=$2 AND status <> 'draft'`, [requested, ctx.project.id]);
  if (!cycle) cycle = await currentCycleForProject(ctx.project.id);
  const questions = await query(
    `SELECT q.id, q.title, q.instructions FROM questions q JOIN group_questions gq ON gq.question_id=q.id AND gq.group_id=$1 ORDER BY q.position, q.created_at`,
    [ctx.group.id],
  );
  const past = await query(`SELECT id, name, status FROM cycles WHERE project_id=$1 AND status <> 'draft' ORDER BY COALESCE(started_at, created_at)`, [ctx.project.id]);
  let ans: Awaited<ReturnType<typeof answers>> = [];
  let contribs: Awaited<ReturnType<typeof contributions>> = [];
  let cited: Awaited<ReturnType<typeof contributions>> = [];
  if (cycle && cycle.status !== "draft") {
    ans = await answers(`a.cycle_id=$1 AND a.group_id=$2`, [cycle.id, ctx.group.id]);
    contribs = await contributions(`c.cycle_id=$1 AND c.group_id=$2 AND NOT c.hidden`, [cycle.id, ctx.group.id], ctx.participant.id);
    // Contributions from earlier rounds that carried-forward answers still cite.
    cited = await contributions(
      `c.group_id=$1 AND c.cycle_id <> $2 AND NOT c.hidden AND c.id IN (SELECT ac.contribution_id FROM answer_contributions ac JOIN answers a ON a.id=ac.answer_id WHERE a.cycle_id=$2 AND a.group_id=$1 AND ac.state='included')`,
      [ctx.group.id, cycle.id],
      ctx.participant.id,
    );
  }
  const ai = aiStatus();
  return json({
    project: { id: ctx.project.id, name: ctx.project.name, description: ctx.project.description },
    group: { id: ctx.group.id, name: ctx.group.name },
    me: ctx.participant,
    cycle: cycle ? cycleView(cycle) : null,
    cycles: past,
    questions,
    answers: ans,
    contributions: contribs,
    citedEarlier: cited,
    limits: {
      imageMb: config.limits.imageBytes / 1048576,
      audioMb: config.limits.audioBytes / 1048576,
      videoMb: config.limits.videoBytes / 1048576,
      textChars: config.limits.textChars,
      imagesPerContribution: config.limits.imagesPerContribution,
    },
    ai: { isFallback: ai.isFallback, transcriptionFallback: ai.transcriptionFallback },
    serverNow: Date.now(),
  });
});
