// Plain-text extraction from documents groups upload as context: PowerPoint, Word, Excel, PDF, text formats.
import { unzipSync, strFromU8 } from "fflate";

export const CONTEXT_EXTS: Record<string, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");

/** Text of OOXML paragraphs: runs (<x:t>) joined within a paragraph (<x:p>), one paragraph per line. */
function ooxmlParagraphs(xml: string, ns: "a" | "w") {
  const out: string[] = [];
  const paraRe = new RegExp(`<${ns}:p[ >][\\s\\S]*?</${ns}:p>`, "g");
  const runRe = new RegExp(`<${ns}:t(?: [^>]*)?>([\\s\\S]*?)</${ns}:t>`, "g");
  for (const p of xml.match(paraRe) ?? []) {
    let line = "";
    for (const m of p.matchAll(runRe)) line += decode(m[1]);
    if (ns === "w" && /<w:tab\/>/.test(p) && !line) continue;
    if (line.trim()) out.push(line.trim());
  }
  return out;
}

function unzip(buf: Buffer, filter: (name: string) => boolean) {
  try {
    return unzipSync(new Uint8Array(buf), { filter: (f) => filter(f.name) && f.originalSize < 50 * 1048576 });
  } catch {
    throw new Error("The file is damaged or not a valid Office document.");
  }
}

const num = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);

function pptx(buf: Buffer) {
  const files = unzip(buf, (n) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n));
  const slides = Object.keys(files).filter((n) => n.startsWith("ppt/slides/")).sort((a, b) => num(a) - num(b));
  return slides
    .map((n) => {
      const i = num(n);
      const body = ooxmlParagraphs(strFromU8(files[n]), "a");
      const notesFile = files[`ppt/notesSlides/notesSlide${i}.xml`];
      const notes = notesFile ? ooxmlParagraphs(strFromU8(notesFile), "a").filter((l) => !/^\d+$/.test(l)) : [];
      return `Slide ${i}:\n${body.join("\n")}${notes.length ? `\nSpeaker notes: ${notes.join(" ")}` : ""}`;
    })
    .join("\n\n");
}

function docx(buf: Buffer) {
  const files = unzip(buf, (n) => n === "word/document.xml");
  if (!files["word/document.xml"]) throw new Error("No document body found.");
  return ooxmlParagraphs(strFromU8(files["word/document.xml"]), "w").join("\n");
}

function xlsx(buf: Buffer) {
  const files = unzip(buf, (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const shared = files["xl/sharedStrings.xml"]
    ? [...strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1])).join(""))
    : [];
  const sheets = Object.keys(files).filter((n) => n.startsWith("xl/worksheets/")).sort((a, b) => num(a) - num(b));
  return sheets
    .map((n) => {
      const rows = [...strFromU8(files[n]).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) =>
        [...r[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)]
          .map((c) => {
            const t = c[1].match(/t="(\w+)"/)?.[1];
            const v = c[2].match(/<v>([\s\S]*?)<\/v>/)?.[1];
            const inline = c[2].match(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/)?.[1];
            if (t === "s" && v !== undefined) return shared[Number(v)] ?? "";
            if (t === "inlineStr" && inline) return decode(inline);
            return v !== undefined ? decode(v) : "";
          })
          .join("\t")
          .trim(),
      );
      return `Sheet ${num(n)}:\n${rows.filter(Boolean).join("\n")}`;
    })
    .join("\n\n");
}

async function pdf(buf: Buffer) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(doc, { mergePages: false });
  return (text as string[]).map((t, i) => `Page ${i + 1}:\n${t.trim()}`).join("\n\n");
}

export function kindOf(name: string): string | null {
  const ext = name.toLowerCase().split(".").pop() || "";
  return ext in CONTEXT_EXTS ? ext : null;
}

/** Extract text from a context file. Images return null: they are described by the vision model instead. */
export async function extractText(buf: Buffer, ext: string): Promise<string | null> {
  switch (ext) {
    case "pptx":
      return pptx(buf);
    case "docx":
      return docx(buf);
    case "xlsx":
      return xlsx(buf);
    case "pdf":
      return pdf(buf);
    case "txt":
    case "md":
    case "csv":
    case "json":
      return buf.toString("utf8");
    default:
      return null;
  }
}
