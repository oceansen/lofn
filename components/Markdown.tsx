"use client";
import { Fragment, type ReactNode } from "react";

// A deliberately small, safe markdown renderer: AI output is rendered as React elements, never as HTML.

type RefRender = (n: number, kind: "C" | "G") => ReactNode;

function inline(text: string, renderRef: RefRender, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[(C|G)(\d+)\]|(?<![\w*])[*_][^*_\n]+[*_](?![\w*]))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (m[2]) out.push(<Fragment key={key}>{renderRef(Number(m[3]), m[2] as "C" | "G")}</Fragment>);
    else if (tok.startsWith("**")) out.push(<strong key={key}>{inline(tok.slice(2, -2), renderRef, key)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={key} className="rounded bg-ink/6 px-1 text-[0.92em]">{tok.slice(1, -1)}</code>);
    else out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, renderRef, className }: { text: string; renderRef: RefRender; className?: string }) {
  const lines = (text || "").replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let k = 0;
  const flushPara = () => {
    if (para.length) blocks.push(<p key={k++}>{inline(para.join(" "), renderRef, `p${k}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, renderRef, `l${k}-${i}`)}</li>);
    blocks.push(list.ordered ? <ol key={k++}>{items}</ol> : <ul key={k++}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      const level = Math.min(4, Math.max(2, h[1].length + 1));
      const Tag = `h${level}` as "h2" | "h3" | "h4";
      blocks.push(<Tag key={k++}>{inline(h[2], renderRef, `h${k}`)}</Tag>);
    } else if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((ul || ol)![1]);
    } else if (line.startsWith(">")) {
      flushList();
      para.push(line.replace(/^>\s?/, ""));
    } else {
      if (list && /^\s{2,}/.test(raw)) {
        list.items[list.items.length - 1] += " " + line.trim();
        continue;
      }
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className={className ?? "prose-answer"}>{blocks}</div>;
}

/** Strip markdown to plain text (for diffs). */
export function plain(md: string) {
  return (md || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)[*_]([^*_]+)[*_]/g, "$1$2")
    .replace(/^\s*[-*•]\s+/gm, "• ");
}
