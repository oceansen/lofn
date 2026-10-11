// Shared (client + server) types and validation for AI-generated answer content.

export type Item = { text: string; refs: number[] };
export type Change = { type: "added" | "revised" | "removed"; text: string };

export type AnswerContent = {
  answer: string; // markdown with inline [C12] citations
  sections: {
    agreements: Item[];
    alternatives: Item[];
    disagreements: Item[];
    open_questions: Item[];
    actions: Item[];
  };
  changes: Change[];
  refs: number[]; // every contribution ref cited anywhere in this version
};

export const SECTION_LABELS: Record<keyof AnswerContent["sections"], string> = {
  agreements: "Where people agree",
  alternatives: "Alternative perspectives",
  disagreements: "Unresolved disagreements",
  open_questions: "Open questions",
  actions: "Suggested actions",
};

export const REF_RE = /\[C(\d+)\]/g;

export function emptyContent(): AnswerContent {
  return { answer: "", sections: { agreements: [], alternatives: [], disagreements: [], open_questions: [], actions: [] }, changes: [], refs: [] };
}

function asRefs(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "number" ? x : Number(String(x).replace(/^\[?C/i, "").replace(/\]$/, ""))))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * Coerce a model response into AnswerContent and strip citations to contributions that
 * aren't in the allowed set (a guard against fabricated references).
 */
export function normalizeContent(raw: any, allowed: Set<number>): { content: AnswerContent; warnings: string[] } {
  const warnings: string[] = [];
  const bad = new Set<number>();
  const clean = (text: string) =>
    text.replace(REF_RE, (m, n) => {
      const r = Number(n);
      if (allowed.has(r)) return m;
      bad.add(r);
      return "";
    }).replace(/[ \t]+([.,;:])/g, "$1");

  const items = (v: unknown): Item[] =>
    (Array.isArray(v) ? v : [])
      .map((it: any) => {
        const text = clean(String(it?.text ?? it ?? "").trim());
        const refs = asRefs(it?.refs).filter((r) => {
          if (allowed.has(r)) return true;
          bad.add(r);
          return false;
        });
        // Also count refs written inline in the item text.
        for (const m of text.matchAll(REF_RE)) refs.push(Number(m[1]));
        return { text, refs: [...new Set(refs)].sort((a, b) => a - b) };
      })
      .filter((it) => it.text.length > 0);

  const s = raw?.sections ?? raw ?? {};
  const content: AnswerContent = {
    answer: clean(String(raw?.answer ?? "").trim()),
    sections: {
      agreements: items(s.agreements),
      alternatives: items(s.alternatives),
      disagreements: items(s.disagreements),
      open_questions: items(s.open_questions),
      actions: items(s.actions),
    },
    changes: (Array.isArray(raw?.changes) ? raw.changes : [])
      .map((c: any) => ({
        type: (["added", "revised", "removed"].includes(c?.type) ? c.type : "revised") as Change["type"],
        text: String(c?.text ?? "").trim(),
      }))
      .filter((c: Change) => c.text)
      .slice(0, 8),
    refs: [],
  };
  // Agreements backed by a single contribution aren't agreements; move them to alternatives.
  const solo = content.sections.agreements.filter((a) => a.refs.length < 2);
  if (solo.length) {
    content.sections.agreements = content.sections.agreements.filter((a) => a.refs.length >= 2);
    content.sections.alternatives.push(...solo);
  }
  const all = new Set<number>();
  for (const m of content.answer.matchAll(REF_RE)) all.add(Number(m[1]));
  for (const list of Object.values(content.sections)) for (const it of list) it.refs.forEach((r) => all.add(r));
  content.refs = [...all].sort((a, b) => a - b);
  if (bad.size) warnings.push(`Removed citations to unknown contributions: ${[...bad].map((r) => `C${r}`).join(", ")}`);
  if (!content.answer) warnings.push("The model returned an empty answer body.");
  return { content, warnings };
}

/** Plain-markdown rendering of an answer (used in exports). */
export function contentToMarkdown(c: AnswerContent, level = 3): string {
  const h = "#".repeat(level);
  let out = c.answer.trim() + "\n";
  for (const [k, label] of Object.entries(SECTION_LABELS) as [keyof AnswerContent["sections"], string][]) {
    const list = c.sections[k];
    if (!list?.length) continue;
    out += `\n${h} ${label}\n\n`;
    for (const it of list) out += `- ${it.text}${it.refs.length && !/\[C\d+\]/.test(it.text) ? " " + it.refs.map((r) => `[C${r}]`).join("") : ""}\n`;
  }
  return out;
}
