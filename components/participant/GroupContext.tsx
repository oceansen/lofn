"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { api, fetcher } from "@/lib/client/api";
import { Button, Pill, Spinner, Textarea, cx } from "@/components/ui";
import type { ContextView } from "@/lib/group-context";

const ACCEPT = ".pptx,.docx,.xlsx,.pdf,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp";
const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The group's shared background material. When switched on, every answer is written with it in mind. */
export function GroupContextPanel({ canEdit = true }: { canEdit?: boolean }) {
  const { data, mutate } = useSWR<ContextView>("/api/p/context", fetcher);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (data && text === null) setText(data.text);
  }, [data, text]);
  if (!data) return null;
  const dirty = text !== null && text !== data.text;
  const hasContent = !!data.text.trim() || data.files.some((f) => f.status === "ready");
  const processing = data.files.some((f) => f.status === "pending");

  async function run(key: string, fn: () => Promise<ContextView | void>) {
    setBusy(key);
    setErr(null);
    try {
      const r = await fn();
      if (r) await mutate(r, false);
      else await mutate();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }
  async function upload(f: File) {
    await run("upload", async () => {
      const res = await fetch(`/api/p/context/files?name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `Upload failed (${res.status}).`);
      return j;
    });
  }

  return (
    <section className={cx("mt-5 rounded-[var(--radius-lg)] border bg-surface", data.enabled && hasContent ? "border-weave/50" : "border-line")} aria-label="Group context">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className={cx("inline-block transition-transform", open && "rotate-90")} aria-hidden>
            ▸
          </span>
          <span className="font-semibold">Group context</span>
          <span className="truncate text-[14px] text-muted">
            {hasContent
              ? `${data.files.length} file${data.files.length === 1 ? "" : "s"}${data.text.trim() ? " and notes" : ""}`
              : "Add slides, a document or notes your answers should build on"}
          </span>
        </button>
        {data.enabled && hasContent && <Pill tone="weave">Answers use it</Pill>}
        <label className={cx("flex items-center gap-2 text-[14.5px] font-semibold", !canEdit && "opacity-60")}>
          <input
            type="checkbox"
            role="switch"
            checked={data.enabled}
            disabled={!canEdit || busy === "toggle"}
            onChange={(e) => run("toggle", () => api("/api/p/context", { method: "PUT", body: { enabled: e.target.checked } }))}
            className="size-4 accent-[var(--color-weave)]"
          />
          Use for our answers
        </label>
      </div>
      {open && (
        <div className="border-t border-line px-4 py-4">
          <p className="text-[14.5px] text-muted">
            Shared with everyone in your group and the facilitator. When it’s on, the AI reads it alongside your contributions for every question, and
            marks points taken from it with <em>Context</em>. Your contributions still take precedence.
            {data.enabled && hasContent && " If a question has no contributions yet, a first draft is written from the context."}
          </p>

          <ul className="mt-3 space-y-1.5">
            {data.files.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-line px-3 py-2 text-[14.5px]">
                <a href={`/api/p/context/files/${f.id}`} className="min-w-0 truncate font-semibold hover:underline">
                  {f.name}
                </a>
                <span className="text-[13px] text-muted">{fmtSize(f.size)}</span>
                {f.status === "pending" && (
                  <span className="flex items-center gap-1 text-[13px] text-muted">
                    <Spinner className="size-3.5" /> Reading…
                  </span>
                )}
                {f.status === "ready" && <span className="text-[13px] text-spruce">{f.chars.toLocaleString()} characters read</span>}
                {f.status === "failed" && <span className="text-[13px] text-alarm">{f.error || "Couldn’t read this file."}</span>}
                {canEdit && (
                  <button
                    className="ml-auto text-[13px] font-semibold text-muted hover:text-alarm"
                    disabled={busy === f.id}
                    onClick={() => run(f.id, () => api(`/api/p/context/files/${f.id}`, { method: "DELETE" }))}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="mt-2">
              <Button size="sm" busy={busy === "upload"} onClick={() => file.current?.click()}>
                Add a file
              </Button>
              <span className="ml-2 text-[13px] text-muted">PowerPoint, Word, Excel, PDF, text or an image</span>
              <input ref={file} type="file" accept={ACCEPT} className="hidden" onChange={(e) => (e.target.files?.[0] && upload(e.target.files[0]), (e.target.value = ""))} />
            </div>
          )}

          <label htmlFor="ctx-notes" className="mt-4 block text-[15px] font-semibold">
            Notes
          </label>
          <Textarea
            id="ctx-notes"
            rows={4}
            value={text ?? ""}
            onChange={(e) => setText(e.target.value)}
            disabled={!canEdit}
            maxLength={20000}
            placeholder="Describe your case: the result you’re working on, who it’s for, key facts and figures…"
            className="mt-1.5"
          />
          {canEdit && (
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" variant="primary" disabled={!dirty} busy={busy === "text"} onClick={() => run("text", () => api("/api/p/context", { method: "PUT", body: { text } }))}>
                Save notes
              </Button>
              {dirty && (
                <Button size="sm" variant="ghost" onClick={() => setText(data.text)}>
                  Discard
                </Button>
              )}
            </div>
          )}
          {data.truncated && <p className="mt-2 text-[13px] text-tide">The context is long, so the AI reads the first {(40000).toLocaleString()} characters.</p>}
          {processing && <p className="mt-2 text-[13px] text-muted">Answers are revised once files have been read.</p>}
          {err && <p className="mt-2 text-sm font-medium text-alarm">{err}</p>}
        </div>
      )}
    </section>
  );
}
