import { one, query } from "./db";
import { publish } from "./events";
import { chatFor, parseJsonLoose } from "./ai/provider";
import { aiForProject } from "./ai/settings";
import { contentToMarkdown } from "./answer-content";

export type GroupRefItem = { text: string; groups: number[] };
export type ProjectQuestionSynthesis = {
  question_id: string;
  question: string;
  groups: { n: number; id: string; name: string }[];
  synthesis: string; // markdown citing [G1]
  agreements: GroupRefItem[];
  differences: GroupRefItem[];
  distinctive: { group: number; text: string }[];
  open_questions: GroupRefItem[];
  is_fallback: boolean;
};
export type ProjectSynthesisContent = { overview: string; questions: ProjectQuestionSynthesis[] };

const SYSTEM = `You are Lofn's project-level synthesis engine. Several groups each produced their own consolidated answer to the same question. Combine them into a higher-level synthesis for the facilitator.

Rules
- Preserve the groups' voices. Keep agreements, differences and distinctive perspectives explicit; don't flatten them into a bland average.
- Cite groups inline with their tags, e.g. [G2] or [G1][G3]. Only use the tags provided.
- An agreement must be supported by at least two groups. A difference is a point where groups diverge or contradict. A distinctive perspective is something only one group raised that is worth keeping.
- Ground everything in the group answers. Add no outside knowledge or opinions.
- Group answers may cite their own contributions as [C#]; drop those tags in your output.
- Write in the language the group answers use. Be concise and well structured; open with a direct answer.

Return ONLY JSON:
{"synthesis": "markdown with [G#] citations",
 "agreements": [{"text": "...", "groups": [1,2]}],
 "differences": [{"text": "...", "groups": [1,3]}],
 "distinctive": [{"group": 2, "text": "..."}],
 "open_questions": [{"text": "...", "groups": [1]}]}
Leave arrays empty when nothing supports them.`;

function cleanGroups(v: unknown, max: number): number[] {
  return [...new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= max))];
}
function stripBadTags(s: string, max: number) {
  return s
    .replace(/\[C\d+\]/g, "")
    .replace(/\[G(\d+)\]/g, (m, n) => (Number(n) >= 1 && Number(n) <= max ? m : ""))
    .replace(/[ \t]+([.,;:])/g, "$1");
}

export async function runProjectSynthesis(synthesisId: string) {
  const s = await one(`UPDATE project_syntheses SET status='running' WHERE id=$1 RETURNING *`, [synthesisId]);
  if (!s) return;
  await publish({ t: "project_synthesis", projectId: s.project_id, id: s.id });
  try {
    const project = await one(`SELECT * FROM projects WHERE id=$1`, [s.project_id]);
    const questions = await query(`SELECT * FROM questions WHERE project_id=$1 ORDER BY position, created_at`, [s.project_id]);
    // For each group×question use the latest answer: from the chosen cycle, or the most recent cycle that has one.
    const latest = await query(
      `SELECT DISTINCT ON (a.group_id, a.question_id) a.group_id, a.question_id, g.name AS group_name, v.content
         FROM answers a JOIN answer_versions v ON v.answer_id=a.id AND v.version=a.current_version
         JOIN groups g ON g.id=a.group_id JOIN cycles c ON c.id=a.cycle_id
        WHERE a.project_id=$1 AND a.current_version > 0 AND ($2::uuid IS NULL OR a.cycle_id=$2)
        ORDER BY a.group_id, a.question_id, COALESCE(c.started_at, c.created_at) DESC`,
      [s.project_id, s.cycle_id],
    );
    const ai = chatFor("synthesis", await aiForProject(s.project_id));
    const out: ProjectSynthesisContent = { overview: "", questions: [] };
    for (const q of questions) {
      const answers = latest.filter((r) => r.question_id === q.id).sort((x, y) => x.group_name.localeCompare(y.group_name));
      const groups = answers.map((r, i) => ({ n: i + 1, id: r.group_id, name: r.group_name }));
      const base: ProjectQuestionSynthesis = {
        question_id: q.id, question: q.title, groups, synthesis: "", agreements: [], differences: [], distinctive: [], open_questions: [], is_fallback: !ai,
      };
      if (!answers.length) {
        out.questions.push({ ...base, synthesis: "_No group has an answer to this question yet._" });
        continue;
      }
      if (!ai) {
        base.synthesis =
          `**Development fallback — not an AI synthesis.** The project owner hasn't added an AI key; group answers are listed side by side.\n\n` +
          answers.map((r, i) => `**[G${i + 1}] ${r.group_name}:** ${String(r.content.answer).replace(/\[C\d+\]/g, "").slice(0, 600)}`).join("\n\n");
        out.questions.push(base);
        continue;
      }
      const prompt =
        `Project: ${project.name}${project.description ? ` — ${project.description}` : ""}\nQUESTION: ${q.title}\n\n` +
        answers.map((r, i) => `[G${i + 1}] Group “${r.group_name}” answer:\n${contentToMarkdown(r.content)}`).join("\n\n---\n\n");
      const raw = parseJsonLoose(await ai.complete({ system: SYSTEM, parts: [{ type: "text", text: prompt }], json: true, temperature: 0.2 }));
      const max = groups.length;
      const items = (v: unknown): GroupRefItem[] =>
        (Array.isArray(v) ? v : []).map((x: any) => ({ text: stripBadTags(String(x?.text ?? ""), max).trim(), groups: cleanGroups(x?.groups, max) })).filter((x) => x.text);
      out.questions.push({
        ...base,
        synthesis: stripBadTags(String(raw.synthesis ?? ""), max).trim(),
        agreements: items(raw.agreements).filter((x) => x.groups.length >= 2),
        differences: items(raw.differences),
        distinctive: (Array.isArray(raw.distinctive) ? raw.distinctive : [])
          .map((x: any) => ({ group: Number(x?.group), text: stripBadTags(String(x?.text ?? ""), max).trim() }))
          .filter((x: any) => x.text && x.group >= 1 && x.group <= max),
        open_questions: items(raw.open_questions),
      });
    }
    if (ai && out.questions.filter((q) => q.groups.length).length > 1) {
      const text = await ai.complete({
        system:
          "You write a short cross-question overview (one to three paragraphs of markdown) of a multi-group feedback project for its facilitator, using only the per-question syntheses provided. Highlight the most important shared conclusions, the sharpest differences, and what remains open. Keep any [G#] tags only when they refer to groups within the same question; otherwise name the group. No outside knowledge. Return markdown only.",
        parts: [
          {
            type: "text",
            text: out.questions
              .map((q) => `QUESTION: ${q.question}\nGroups: ${q.groups.map((g) => `G${g.n}=${g.name}`).join(", ")}\n${q.synthesis}`)
              .join("\n\n---\n\n"),
          },
        ],
        maxTokens: 1200,
        temperature: 0.2,
      });
      out.overview = text.trim();
    }
    await query(`UPDATE project_syntheses SET status='done', content=$2, provider=$3, model=$4, is_fallback=$5, completed_at=now(), error=NULL WHERE id=$1`, [
      synthesisId,
      JSON.stringify(out),
      ai?.name ?? "none",
      ai?.model ?? "",
      !ai,
    ]);
  } catch (e) {
    await query(`UPDATE project_syntheses SET status='error', error=$2 WHERE id=$1`, [synthesisId, (e as Error).message.slice(0, 500)]);
    throw e;
  } finally {
    await publish({ t: "project_synthesis", projectId: s.project_id, id: s.id });
  }
}
