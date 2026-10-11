import { one, query } from "./db";
import { config } from "./config";
import { answers, answerVersions, contributions, cyclesFor, projectView, questionsFor } from "./views";
import { contentToMarkdown, SECTION_LABELS, type AnswerContent } from "./answer-content";
import type { ProjectSynthesisContent } from "./project-synthesis";

export async function buildExport(projectId: string, cycleId: string | null) {
  const project = projectView(await one(`SELECT * FROM projects WHERE id=$1`, [projectId]));
  const questions = await questionsFor(projectId);
  const groups = await query(
    `SELECT g.id, g.name, COALESCE((SELECT array_agg(question_id) FROM group_questions WHERE group_id=g.id),'{}') AS question_ids
       FROM groups g WHERE g.project_id=$1 ORDER BY g.created_at`,
    [projectId],
  );
  const allCycles = await cyclesFor(projectId);
  const cycles = allCycles.filter((c) => c.status !== "draft" && (!cycleId || c.id === cycleId));
  const out = {
    exportedAt: new Date().toISOString(),
    generator: "Lofn",
    project,
    questions: questions.map((q) => ({ id: q.id, title: q.title, instructions: q.instructions })),
    groups: groups.map((g) => ({ id: g.id, name: g.name, questionIds: g.question_ids })),
    cycles: [] as any[],
    projectSynthesis: null as any,
  };
  for (const c of cycles) {
    const ans = await answers(`a.cycle_id=$1`, [c.id]);
    const contribs = await contributions(`c.cycle_id=$1`, [c.id]);
    const groupAnswers = [];
    for (const a of ans) {
      groupAnswers.push({
        id: a.id,
        groupId: a.groupId,
        questionId: a.questionId,
        version: a.version,
        isFinal: a.isFinal,
        isFallback: a.isFallback,
        provider: a.provider,
        model: a.model,
        updatedAt: a.versionCreatedAt,
        content: a.content,
        versions: (await answerVersions(a.id)).reverse(),
      });
    }
    out.cycles.push({
      id: c.id,
      name: c.name,
      note: c.note,
      status: c.status,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      durationMinutes: Math.round(c.durationMs / 60000),
      answers: groupAnswers,
      contributions: contribs.map((x) => ({
        id: x.id,
        ref: `C${x.ref}`,
        groupId: x.groupId,
        questionId: x.questionId,
        kind: x.kind,
        submittedAt: x.createdAt,
        contributor: x.author.alias,
        text: x.text,
        hidden: x.hidden,
        status: x.status,
        processingError: x.error,
        media: x.media.map((m) => ({
          id: m.id,
          category: m.category,
          mime: m.mime,
          sizeBytes: m.size,
          url: m.deleted ? null : `${config.appUrl}/api/media/${m.id}`,
          deleted: m.deleted,
        })),
        transcripts: x.derivations.filter((d) => d.type === "transcript").map((d) => ({ text: d.content, provider: d.provider, model: d.model, isFallback: d.isFallback })),
        descriptions: x.derivations.filter((d) => d.type === "description").map((d) => ({ text: d.content, provider: d.provider, model: d.model, isFallback: d.isFallback })),
      })),
    });
  }
  const ps = await one(
    `SELECT * FROM project_syntheses WHERE project_id=$1 AND status='done' AND ($2::uuid IS NULL OR cycle_id=$2 OR cycle_id IS NULL)
      ORDER BY created_at DESC LIMIT 1`,
    [projectId, cycleId],
  );
  if (ps) out.projectSynthesis = { id: ps.id, cycleId: ps.cycle_id, createdAt: ps.completed_at, provider: ps.provider, model: ps.model, isFallback: ps.is_fallback, content: ps.content };
  return out;
}

export type ExportData = Awaited<ReturnType<typeof buildExport>>;

/** Replace [G2] tags with group names for human-readable exports. */
function nameGroups(text: string, groups: { n: number; name: string }[]) {
  return text.replace(/(?:\[G(\d+)\])+/g, (m) => {
    const names = [...m.matchAll(/G(\d+)/g)].map((x) => groups.find((g) => g.n === Number(x[1]))?.name ?? `G${x[1]}`);
    return `(${names.join(", ")})`;
  });
}

const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");

export function exportMarkdown(d: ExportData): string {
  const groupName = (id: string) => d.groups.find((g) => g.id === id)?.name ?? "Unknown group";
  let md = `# ${d.project.name}\n\n`;
  if (d.project.description) md += `${d.project.description}\n\n`;
  md += `_Exported from Lofn on ${fmtDate(d.exportedAt)}._\n\n## Questions\n\n`;
  d.questions.forEach((q, i) => (md += `${i + 1}. **${q.title}**${q.instructions ? ` — ${q.instructions}` : ""}\n`));
  md += `\n## Groups\n\n${d.groups.map((g) => `- ${g.name}`).join("\n")}\n`;

  const ps = d.projectSynthesis?.content as ProjectSynthesisContent | undefined;
  if (ps) {
    md += `\n## Project-level synthesis\n\n`;
    if (d.projectSynthesis.isFallback) md += `> Development fallback — no AI provider was configured; this is not an AI synthesis.\n\n`;
    if (ps.overview) md += `${ps.overview}\n\n`;
    for (const q of ps.questions) {
      const legend = q.groups.map((g) => `G${g.n} = ${g.name}`).join(", ");
      md += `### ${q.question}\n\n${legend ? `_${legend}_\n\n` : ""}${nameGroups(q.synthesis, q.groups)}\n\n`;
      const sec = (label: string, items: { text: string; groups: number[] }[]) =>
        items.length ? `**${label}**\n\n${items.map((i) => `- ${i.text}${i.groups.length ? ` (${i.groups.map((n) => `G${n}`).join(", ")})` : ""}`).join("\n")}\n\n` : "";
      md += sec("Agreements", q.agreements) + sec("Differences", q.differences) + sec("Open questions", q.open_questions);
      if (q.distinctive.length) md += `**Distinctive perspectives**\n\n${q.distinctive.map((x) => `- G${x.group}: ${x.text}`).join("\n")}\n\n`;
    }
  }

  for (const c of d.cycles) {
    md += `\n## ${c.name}\n\n${c.note ? `${c.note}\n\n` : ""}Started ${fmtDate(c.startedAt)}, ended ${fmtDate(c.endedAt)} (${c.durationMinutes} min).\n`;
    for (const q of d.questions) {
      const qa = c.answers.filter((a: any) => a.questionId === q.id);
      if (!qa.length) continue;
      md += `\n### ${q.title}\n`;
      for (const a of qa) {
        md += `\n#### ${groupName(a.groupId)}\n\n`;
        if (!a.content) {
          md += `_No answer yet._\n`;
          continue;
        }
        if (a.isFallback) md += `> Development fallback — not an AI synthesis.\n\n`;
        md += contentToMarkdown(a.content as AnswerContent, 5);
        md += `\n_Version ${a.version}${a.isFinal ? " (final)" : ""}, updated ${fmtDate(a.updatedAt)}${a.model ? `, ${a.provider}/${a.model}` : ""}._\n`;
        const contribs = c.contributions.filter((x: any) => x.groupId === a.groupId && x.questionId === q.id);
        if (contribs.length) {
          md += `\n<details><summary>Contributions (${contribs.length})</summary>\n\n`;
          for (const x of contribs) {
            md += `- **${x.ref}** · ${x.kind.replace("_", " + ")} · ${x.contributor ?? ""} · ${fmtDate(x.submittedAt)}${x.hidden ? " · _hidden by facilitator_" : ""}\n`;
            if (x.text) md += `  > ${x.text.replace(/\n/g, "\n  > ")}\n`;
            for (const t of x.transcripts) md += `  - Transcript: ${t.text}\n`;
            for (const t of x.descriptions) md += `  - AI description: ${t.text}\n`;
            for (const m of x.media) md += `  - Media: ${m.url ?? "(deleted under retention policy)"} (${m.mime})\n`;
          }
          md += `\n</details>\n`;
        }
        if (a.versions.length > 1) {
          md += `\n<details><summary>Version history (${a.versions.length})</summary>\n\n`;
          for (const v of a.versions) md += `- v${v.version} · ${fmtDate(v.createdAt)} · ${v.trigger}${v.changeNote ? ` — ${v.changeNote}` : ""}\n`;
          md += `\n</details>\n`;
        }
      }
    }
  }
  return md;
}

// ---------- PDF ----------

type Doc = PDFKit.PDFDocument;

const INK = "#17211F";
const MUTED = "#5B6662";
const ACCENT = "#2E4BA8";

function writeRich(doc: Doc, text: string, opts: PDFKit.Mixins.TextOptions = {}) {
  // Minimal inline markdown: **bold**; citations kept as-is.
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  parts.forEach((p, i) => {
    const bold = p.startsWith("**") && p.endsWith("**");
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").text(bold ? p.slice(2, -2) : p.replace(/(^|\s)[*_]([^*_]+)[*_]/g, "$1$2"), {
      ...opts,
      continued: i < parts.length - 1,
    });
  });
  if (!parts.length) doc.text("", opts);
}

function writeMarkdown(doc: Doc, md: string) {
  const lines = md.split("\n");
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      doc.moveDown(0.4);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      doc.moveDown(0.3).font("Helvetica-Bold").fontSize(h[1].length <= 2 ? 12 : 11).fillColor(INK).text(h[2]);
      doc.fontSize(10);
      continue;
    }
    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    doc.fontSize(10).fillColor(INK);
    if (li) {
      const depth = Math.min(3, Math.floor(li[1].length / 2));
      const bullet = /\d/.test(li[2]) ? li[2] : "•";
      doc.x = doc.page.margins.left + 10 + depth * 12;
      writeRich(doc, `${bullet}  ${li[3]}`, { lineGap: 2, width: doc.page.width - doc.page.margins.right - doc.x });
      doc.x = doc.page.margins.left;
      continue;
    }
    writeRich(doc, line.replace(/^>\s?/, ""), { lineGap: 2 });
  }
}

export async function exportPdf(d: ExportData): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 56, right: 56 }, bufferPages: true, info: { Title: `${d.project.name} — Lofn export`, Creator: "Lofn" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
  const groupName = (id: string) => d.groups.find((g) => g.id === id)?.name ?? "Unknown group";

  doc.font("Helvetica-Bold").fontSize(22).fillColor(INK).text(d.project.name);
  doc.moveDown(0.3).font("Helvetica").fontSize(10).fillColor(MUTED).text(`Exported from Lofn on ${fmtDate(d.exportedAt)}`);
  if (d.project.description) doc.moveDown(0.6).fillColor(INK).fontSize(11).text(d.project.description);
  doc.moveDown(1).font("Helvetica-Bold").fontSize(13).fillColor(INK).text("Questions");
  d.questions.forEach((q, i) => doc.moveDown(0.2).font("Helvetica").fontSize(10.5).text(`${i + 1}. ${q.title}`));
  doc.moveDown(0.6).font("Helvetica-Bold").fontSize(13).text("Groups");
  doc.font("Helvetica").fontSize(10.5).text(d.groups.map((g) => g.name).join(", ") || "—");

  const ps = d.projectSynthesis?.content as ProjectSynthesisContent | undefined;
  if (ps) {
    doc.addPage().font("Helvetica-Bold").fontSize(16).fillColor(ACCENT).text("Project-level synthesis");
    if (d.projectSynthesis.isFallback) doc.moveDown(0.3).font("Helvetica-Oblique").fontSize(9).fillColor(MUTED).text("Development fallback — no AI provider was configured; this is not an AI synthesis.");
    if (ps.overview) {
      doc.moveDown(0.5).fillColor(INK);
      writeMarkdown(doc, ps.overview.replace(/\[G\d+\]/g, ""));
    }
    for (const q of ps.questions) {
      doc.moveDown(0.8).font("Helvetica-Bold").fontSize(12.5).fillColor(INK).text(q.question);
      if (q.groups.length) doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(q.groups.map((g) => `G${g.n} = ${g.name}`).join("   "));
      doc.moveDown(0.3).fillColor(INK);
      writeMarkdown(doc, nameGroups(q.synthesis, q.groups));
      const sec = (label: string, items: { text: string; groups: number[] }[]) => {
        if (!items.length) return;
        doc.moveDown(0.3).font("Helvetica-Bold").fontSize(10).text(label);
        writeMarkdown(doc, items.map((i) => `- ${i.text}${i.groups.length ? ` (${i.groups.map((n) => `G${n}`).join(", ")})` : ""}`).join("\n"));
      };
      sec("Agreements", q.agreements);
      sec("Differences", q.differences);
      sec("Distinctive perspectives", q.distinctive.map((x) => ({ text: x.text, groups: [x.group] })));
      sec("Open questions", q.open_questions);
    }
  }

  for (const c of d.cycles) {
    doc.addPage().font("Helvetica-Bold").fontSize(16).fillColor(ACCENT).text(c.name);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`Started ${fmtDate(c.startedAt)} · ended ${fmtDate(c.endedAt)} · ${c.durationMinutes} min`);
    if (c.note) doc.moveDown(0.3).fontSize(10).fillColor(INK).text(c.note);
    for (const q of d.questions) {
      const qa = c.answers.filter((a: any) => a.questionId === q.id && a.content);
      if (!qa.length) continue;
      doc.moveDown(0.9).font("Helvetica-Bold").fontSize(13).fillColor(INK).text(q.title);
      for (const a of qa) {
        doc.moveDown(0.5).font("Helvetica-Bold").fontSize(11).fillColor(ACCENT).text(groupName(a.groupId));
        doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(
          `Version ${a.version}${a.isFinal ? " (final)" : ""} · ${fmtDate(a.updatedAt)}${a.isFallback ? " · development fallback, not AI" : a.model ? ` · ${a.provider}/${a.model}` : ""}`,
        );
        doc.moveDown(0.3).fillColor(INK);
        const content = a.content as AnswerContent;
        writeMarkdown(doc, content.answer);
        for (const [k, label] of Object.entries(SECTION_LABELS) as [keyof AnswerContent["sections"], string][]) {
          const items = content.sections?.[k] ?? [];
          if (!items.length) continue;
          doc.moveDown(0.3).font("Helvetica-Bold").fontSize(10).fillColor(INK).text(label);
          writeMarkdown(doc, items.map((i) => `- ${i.text}${i.refs.length && !/\[C\d+\]/.test(i.text) ? " " + i.refs.map((r) => `[C${r}]`).join("") : ""}`).join("\n"));
        }
      }
    }
    // Appendix: contributions
    const contribs = c.contributions.filter((x: any) => !x.hidden);
    if (contribs.length) {
      doc.addPage().font("Helvetica-Bold").fontSize(13).fillColor(INK).text(`${c.name}: contributions`);
      for (const q of d.questions) {
        const qc = contribs.filter((x: any) => x.questionId === q.id);
        if (!qc.length) continue;
        doc.moveDown(0.6).font("Helvetica-Bold").fontSize(11).text(q.title);
        for (const x of qc) {
          doc.moveDown(0.35).font("Helvetica-Bold").fontSize(9).fillColor(ACCENT).text(`${x.ref}  `, { continued: true });
          doc.font("Helvetica").fillColor(MUTED).text(`${groupName(x.groupId)} · ${x.kind.replace("_", " + ")} · ${x.contributor ?? ""} · ${fmtDate(x.submittedAt)}`);
          doc.fillColor(INK).fontSize(9.5);
          if (x.text) doc.font("Helvetica").text(x.text);
          for (const t of x.transcripts) doc.font("Helvetica-Oblique").text(`Transcript: ${t.text}`);
          for (const t of x.descriptions) doc.font("Helvetica-Oblique").text(`AI description: ${t.text}`);
          for (const m of x.media) doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(`Media: ${m.url ?? "deleted under retention policy"} (${m.mime})`);
        }
      }
    }
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(`Lofn · ${d.project.name} · page ${i + 1} of ${range.count}`, 56, doc.page.height - 36, { width: doc.page.width - 112, align: "center", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}

/** Strip characters the standard PDF fonts can't render (they only cover WinAnsi). */
export function pdfSafe<T>(v: T): T {
  return JSON.parse(
    JSON.stringify(v, (_k, val) =>
      typeof val === "string"
        ? val.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "")
        : val,
    ),
  );
}
