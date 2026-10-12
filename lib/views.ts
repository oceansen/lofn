import { query, one } from "./db";
import { cycleView, expireDueCycles, type CycleRow } from "./cycles";
import { aiStatus } from "./ai/settings";

export type ContributionView = {
  id: string;
  ref: number;
  kind: string;
  text: string;
  status: string;
  error: string | null;
  hidden: boolean;
  createdAt: string;
  questionId: string;
  groupId: string;
  cycleId: string;
  author: { alias: string | null; name: string | null; mine?: boolean };
  media: { id: string; category: string; mime: string; size: number; deleted: boolean }[];
  derivations: { type: string; content: string; isFallback: boolean; provider: string; model: string }[];
};

const CONTRIB_VIEW_SQL = `
  SELECT c.id, c.ref_no, c.kind, c.text_content, c.status, c.processing_error, c.hidden, c.created_at,
         c.question_id, c.group_id, c.cycle_id, c.participant_id, p.alias, p.display_name,
         (SELECT json_agg(json_build_object('id', m.id, 'category', m.category, 'mime', m.mime, 'size', m.size_bytes,
                 'deleted', m.deleted_at IS NOT NULL) ORDER BY m.position) FROM media m WHERE m.contribution_id = c.id) AS media,
         (SELECT json_agg(json_build_object('type', d.type, 'content', d.content, 'isFallback', d.is_fallback,
                 'provider', d.provider, 'model', d.model) ORDER BY d.created_at) FROM derivations d WHERE d.contribution_id = c.id) AS derivations
    FROM contributions c LEFT JOIN participants p ON p.id = c.participant_id`;

function toContribution(r: any, viewerParticipantId?: string): ContributionView {
  return {
    id: r.id,
    ref: r.ref_no,
    kind: r.kind,
    text: r.text_content,
    status: r.status,
    error: r.processing_error,
    hidden: r.hidden,
    createdAt: new Date(r.created_at).toISOString(),
    questionId: r.question_id,
    groupId: r.group_id,
    cycleId: r.cycle_id,
    author: { alias: r.alias, name: r.display_name || null, ...(viewerParticipantId ? { mine: r.participant_id === viewerParticipantId } : {}) },
    media: r.media ?? [],
    derivations: r.derivations ?? [],
  };
}

export async function contributions(where: string, params: unknown[], viewerParticipantId?: string): Promise<ContributionView[]> {
  const rows = await query(`${CONTRIB_VIEW_SQL} WHERE ${where} ORDER BY c.created_at, c.ref_no`, params);
  return rows.map((r) => toContribution(r, viewerParticipantId));
}

export type AnswerView = {
  id: string;
  groupId: string;
  questionId: string;
  cycleId: string;
  version: number;
  status: string;
  isFinal: boolean;
  lastError: string | null;
  updatedAt: string;
  versionCreatedAt: string | null;
  content: any | null;
  changeNote: string;
  provider: string | null;
  model: string | null;
  isFallback: boolean;
  trigger: string | null;
  includedCount: number;
  pendingCount: number;
};

export async function answers(where: string, params: unknown[]): Promise<AnswerView[]> {
  const rows = await query(
    `SELECT a.*, v.content, v.change_note, v.provider, v.model, v.is_fallback, v.created_at AS v_created, v.trigger,
            (SELECT count(*)::int FROM answer_contributions ac WHERE ac.answer_id=a.id AND ac.state='included') AS included_count,
            (SELECT count(*)::int FROM contributions c LEFT JOIN answer_contributions ac ON ac.answer_id=a.id AND ac.contribution_id=c.id
              WHERE c.cycle_id=a.cycle_id AND c.group_id=a.group_id AND c.question_id=a.question_id AND NOT c.hidden AND ac.contribution_id IS NULL) AS pending_count
       FROM answers a LEFT JOIN answer_versions v ON v.answer_id=a.id AND v.version=a.current_version
      WHERE ${where}`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    groupId: r.group_id,
    questionId: r.question_id,
    cycleId: r.cycle_id,
    version: r.current_version,
    status: r.status,
    isFinal: r.is_final,
    lastError: r.last_error,
    updatedAt: new Date(r.updated_at).toISOString(),
    versionCreatedAt: r.v_created ? new Date(r.v_created).toISOString() : null,
    content: r.content ?? null,
    changeNote: r.change_note ?? "",
    provider: r.provider ?? null,
    model: r.model ?? null,
    isFallback: !!r.is_fallback,
    trigger: r.trigger ?? null,
    includedCount: r.included_count,
    pendingCount: r.pending_count,
  }));
}

export async function answerVersions(answerId: string) {
  const rows = await query(
    `SELECT version, content, change_note, added_refs, removed_refs, trigger, provider, model, is_fallback, is_final, warnings, created_at
       FROM answer_versions WHERE answer_id=$1 ORDER BY version DESC`,
    [answerId],
  );
  return rows.map((r) => ({
    version: r.version,
    content: r.content,
    changeNote: r.change_note,
    addedRefs: r.added_refs,
    removedRefs: r.removed_refs,
    trigger: r.trigger,
    provider: r.provider,
    model: r.model,
    isFallback: r.is_fallback,
    isFinal: r.is_final,
    warnings: r.warnings,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function questionsFor(projectId: string) {
  return query(
    `SELECT q.id, q.title, q.instructions, q.position,
            CASE WHEN qi.question_id IS NULL THEN NULL ELSE extract(epoch from qi.updated_at)::bigint END AS image_version, qi.alt AS image_alt
       FROM questions q LEFT JOIN question_images qi ON qi.question_id = q.id
      WHERE q.project_id=$1 ORDER BY q.position, q.created_at`,
    [projectId],
  );
}

export async function cyclesFor(projectId: string) {
  await expireDueCycles();
  const rows = await query<CycleRow>(`SELECT * FROM cycles WHERE project_id=$1 ORDER BY position, created_at`, [projectId]);
  return rows.map(cycleView);
}

/** Everything the admin live view needs, in one round trip. */
export async function projectOverview(projectId: string, cycleId?: string | null) {
  const project = await one(`SELECT * FROM projects WHERE id=$1`, [projectId]);
  const questions = await questionsFor(projectId);
  const groups = await query(
    `SELECT g.id, g.name, g.access_code, g.code_active, g.created_at,
            COALESCE((SELECT array_agg(question_id) FROM group_questions WHERE group_id=g.id), '{}') AS question_ids,
            (SELECT count(*)::int FROM participants pa WHERE pa.group_id=g.id) AS participant_count,
            (SELECT count(*)::int FROM participants pa WHERE pa.group_id=g.id AND pa.last_seen_at > now() - interval '2 minutes') AS active_count
       FROM groups g WHERE g.project_id=$1 ORDER BY g.created_at`,
    [projectId],
  );
  const cycles = await cyclesFor(projectId);
  const selected =
    (cycleId && cycles.find((c) => c.id === cycleId)) ||
    cycles.find((c) => c.status === "running" || c.status === "paused") ||
    [...cycles].filter((c) => c.status === "ended").sort((a, b) => +new Date(b.endedAt!) - +new Date(a.endedAt!))[0] ||
    cycles.find((c) => c.status === "draft") ||
    null;
  let stats: any[] = [];
  let answerList: AnswerView[] = [];
  let timeline: { minute: string; n: number }[] = [];
  if (selected) {
    stats = await query(
      `SELECT group_id, question_id, kind, count(*)::int AS n FROM contributions WHERE cycle_id=$1 AND NOT hidden GROUP BY 1,2,3`,
      [selected.id],
    );
    answerList = await answers(`a.cycle_id=$1`, [selected.id]);
    timeline = await query(
      `SELECT to_char(date_trunc('minute', created_at), 'YYYY-MM-DD"T"HH24:MI:00"Z"') AS minute, count(*)::int AS n
         FROM contributions WHERE cycle_id=$1 GROUP BY 1 ORDER BY 1`,
      [selected.id],
    );
  }
  const processing = selected
    ? await one(`SELECT count(*) FILTER (WHERE status IN ('pending','processing'))::int AS pending, count(*) FILTER (WHERE status='failed')::int AS failed FROM contributions WHERE cycle_id=$1`, [selected.id])
    : { pending: 0, failed: 0 };
  return {
    project: projectView(project),
    questions,
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      accessCode: g.access_code,
      codeActive: g.code_active,
      questionIds: g.question_ids,
      participantCount: g.participant_count,
      activeCount: g.active_count,
    })),
    cycles,
    selectedCycleId: selected?.id ?? null,
    stats,
    answers: answerList,
    timeline,
    processing,
    ai: await aiStatus(project.owner_id),
    serverNow: Date.now(),
  };
}

export function projectView(p: any) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    defaultCycleMinutes: p.default_cycle_minutes,
    mediaRetentionDays: p.media_retention_days,
    synthesisGuidance: p.synthesis_guidance,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}
