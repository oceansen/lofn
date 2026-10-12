"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import useSWR from "swr";
import { diffWords } from "diff";
import { fetcher, timeAgo, useNow } from "@/lib/client/api";
import { Markdown, plain } from "./Markdown";
import { Button, Modal, Pill, Spinner, cx } from "./ui";
import { NextUpdate, type CycleLike } from "./Countdown";

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
  content: AnswerContent | null;
  changeNote: string;
  provider: string | null;
  model: string | null;
  isFallback: boolean;
  trigger: string | null;
  includedCount: number;
  pendingCount: number;
};
type Item = { text: string; refs: number[] };
type AnswerContent = {
  answer: string;
  sections: Record<"agreements" | "alternatives" | "disagreements" | "open_questions" | "actions", Item[]>;
  changes: { type: string; text: string }[];
  refs: number[];
};
type Version = {
  version: number;
  content: AnswerContent;
  changeNote: string;
  addedRefs: number[];
  removedRefs: number[];
  trigger: string;
  provider: string;
  model: string;
  isFallback: boolean;
  isFinal: boolean;
  warnings: string[];
  createdAt: string;
};

const SECTIONS: { key: keyof AnswerContent["sections"]; label: string; mark: string }[] = [
  { key: "agreements", label: "Where people agree", mark: "bg-spruce" },
  { key: "alternatives", label: "Alternative perspectives", mark: "bg-[#7a5c99]" },
  { key: "disagreements", label: "Unresolved disagreements", mark: "bg-alarm" },
  { key: "open_questions", label: "Open questions", mark: "bg-tide" },
  { key: "actions", label: "Suggested actions", mark: "bg-weave" },
];

export function RefChip({ n, kind = "C", onClick, label }: { n: number; kind?: "C" | "G"; onClick?: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="mx-[1px] inline-flex translate-y-[-1px] items-center rounded-[5px] border border-weave-line bg-surface px-1 align-middle font-display text-[11.5px] leading-[1.45] font-bold text-weave tabular hover:border-weave hover:bg-weave-wash"
      aria-label={kind === "C" ? `Contribution C${n}` : `Group ${label ?? n}`}
    >
      {kind}
      {n}
    </button>
  );
}

function statusPill(a: AnswerView | null, cycle?: CycleLike | null) {
  if (!a) return <Pill>Waiting for contributions</Pill>;
  if (a.status === "synthesizing")
    return (
      <Pill tone="weave">
        <Spinner className="size-3" /> Weaving in new ideas
      </Pill>
    );
  if (a.status === "queued") return <Pill tone="weave">Queued for the next pass</Pill>;
  if (a.status === "error") return <Pill tone="alarm">Last update failed — retrying</Pill>;
  if (a.isFinal) return <Pill tone="spruce">Final answer</Pill>;
  if (cycle?.status === "ended") return <Pill tone="weave">Finalising</Pill>;
  if (a.pendingCount > 0) return <Pill tone="weave">{a.pendingCount} new to weave in</Pill>;
  return <Pill>Up to date</Pill>;
}

export function AnswerPanel({
  answer,
  cycle,
  onRef,
  refLabel,
  versionsUrl,
  headerExtra,
  footer,
  emptyHint,
  className,
}: {
  answer: AnswerView | null;
  cycle?: CycleLike | null;
  onRef?: (n: number) => void;
  refLabel?: (n: number) => string | undefined;
  versionsUrl?: string;
  headerExtra?: ReactNode;
  footer?: ReactNode;
  emptyHint?: ReactNode;
  className?: string;
}) {
  const now = useNow(5000);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const [freshKey, setFreshKey] = useState(0);
  const prevVersion = useRef<number | null>(null);

  // Subtle signal when a new version lands while the panel is visible.
  useEffect(() => {
    if (!answer) return;
    if (prevVersion.current !== null && answer.version > prevVersion.current) setFreshKey((k) => k + 1);
    prevVersion.current = answer.version;
  }, [answer?.version, answer]);

  const content = answer?.content;
  const renderRef = (n: number, kind: "C" | "G") => <RefChip n={n} kind={kind} onClick={() => onRef?.(n)} label={refLabel?.(n)} />;
  const updating = answer?.status === "synthesizing";

  return (
    <section className={cx("weave-edge rounded-[var(--radius-lg)] border border-weave-line bg-weave-wash/45 pt-1", updating && "is-updating", className)} aria-live="polite" aria-busy={updating}>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 sm:px-5">
        <h3 className="mr-auto flex items-center gap-2 text-[17px] font-semibold text-weave-deep">
          <svg viewBox="0 0 20 20" className="size-4.5" aria-hidden="true">
            <path d="M3 6c5 0 6 8 14 8M3 14c5 0 6-8 14-8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
          Group answer
          <span className="text-[13px] font-medium text-weave/70">AI synthesis</span>
        </h3>
        {statusPill(answer, cycle)}
        {headerExtra}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-1 text-[13px] text-muted sm:px-5">
        {answer && answer.version > 0 ? (
          <>
            <span className="tabular">Version {answer.version}</span>
            <span>Updated {timeAgo(answer.versionCreatedAt, now)}</span>
            <span>
              Built from {answer.includedCount} contribution{answer.includedCount === 1 ? "" : "s"}
              {/\[Context\]/.test(answer.content?.answer ?? "") ? " and the group’s context" : ""}
            </span>
          </>
        ) : (
          <span>No answer yet</span>
        )}
        <NextUpdate cycle={cycle ?? null} />
      </div>

      {answer?.isFallback && (
        <p className="mx-4 mt-3 rounded-[var(--radius-sm)] border border-tide/40 bg-tide-wash px-3 py-2 text-[13.5px] font-medium text-[#5d3e05] sm:mx-5">
          Development fallback — no AI provider is configured, so this lists contributions rather than synthesising them.
        </p>
      )}

      <div className="px-4 pt-3 pb-4 sm:px-5">
        {!content || !content.answer ? (
          <div className="py-6 text-[15px] text-muted">
            {emptyHint ?? "As people contribute, Lofn weaves their ideas into one answer here and refines it every minute."}
          </div>
        ) : showChanges && versionsUrl ? (
          <ChangesInline versionsUrl={versionsUrl} version={answer!.version} />
        ) : (
          <div key={freshKey} className={cx("text-[16.5px] leading-[1.62]", freshKey > 0 && "fresh-in")}>
            <Markdown text={content.answer} renderRef={renderRef} />
            {SECTIONS.map(({ key, label, mark }) => {
              const items = content.sections?.[key] ?? [];
              if (!items.length) return null;
              return (
                <div key={key} className="mt-5">
                  <h4 className="flex items-center gap-2 font-display text-[15px] font-semibold">
                    <span className={cx("h-3 w-1.5 rounded-full", mark)} aria-hidden="true" />
                    {label}
                  </h4>
                  <ul className="mt-1.5 space-y-1.5 border-l border-weave-line pl-4">
                    {items.map((it, i) => (
                      <li key={i} className="text-[15.5px]">
                        <Markdown text={it.text} renderRef={renderRef} className="prose-answer inline [&>p]:my-0 [&>p]:inline" />
                        {!/\[C\d+\]/.test(it.text) && it.refs.map((r) => <RefChip key={r} n={r} onClick={() => onRef?.(r)} label={refLabel?.(r)} />)}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
        {answer?.lastError && answer.status === "error" && <p className="mt-3 text-sm text-alarm">Last attempt: {answer.lastError}</p>}
      </div>

      {answer && answer.version > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-weave-line/70 px-4 py-2.5 sm:px-5">
          {answer.changeNote && !showChanges && (
            <p className="mr-auto line-clamp-2 text-[13.5px] text-weave-deep">
              <span className="font-semibold">Latest change:</span> {answer.changeNote}
            </p>
          )}
          <div className="ml-auto flex gap-1.5">
            {versionsUrl && answer.version > 1 && (
              <Button size="sm" variant="ghost" onClick={() => setShowChanges(!showChanges)} aria-pressed={showChanges}>
                {showChanges ? "Hide changes" : "Show changes"}
              </Button>
            )}
            {versionsUrl && (
              <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}>
                History
              </Button>
            )}
          </div>
        </div>
      )}
      {footer}
      {versionsUrl && <VersionHistory open={historyOpen} onClose={() => setHistoryOpen(false)} url={versionsUrl} onRef={onRef} />}
    </section>
  );
}

function flatten(c: AnswerContent | null | undefined) {
  if (!c) return "";
  let s = plain(c.answer);
  for (const { key, label } of SECTIONS) {
    const items = c.sections?.[key] ?? [];
    if (items.length) s += `\n\n${label}\n` + items.map((i) => `• ${plain(i.text)}`).join("\n");
  }
  return s;
}

function DiffText({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  return (
    <p className="whitespace-pre-wrap text-[15.5px] leading-[1.65]">
      {parts.map((p, i) => (
        <span key={i} className={p.added ? "diff-add" : p.removed ? "diff-del" : undefined}>
          {p.value}
        </span>
      ))}
    </p>
  );
}

function ChangesInline({ versionsUrl, version }: { versionsUrl: string; version: number }) {
  const { data } = useSWR<{ versions: Version[] }>(`${versionsUrl}#v${version}`, () => fetcher(versionsUrl));
  if (!data) return <Spinner className="size-5 text-weave" />;
  const cur = data.versions.find((v) => v.version === version);
  const prev = data.versions.find((v) => v.version === version - 1);
  return (
    <div>
      <p className="mb-2 text-[13px] text-muted">
        Changes from version {version - 1} to {version}: <span className="diff-add px-1">added</span> and <span className="diff-del">removed</span> text.
      </p>
      <DiffText before={flatten(prev?.content)} after={flatten(cur?.content)} />
    </div>
  );
}

export function VersionHistory({ open, onClose, url, onRef }: { open: boolean; onClose: () => void; url: string; onRef?: (n: number) => void }) {
  const { data, isLoading } = useSWR<{ versions: Version[] }>(open ? url : null, fetcher);
  const [sel, setSel] = useState<number | null>(null);
  const [mode, setMode] = useState<"diff" | "full">("diff");
  const versions = data?.versions ?? [];
  const current = versions.find((v) => v.version === sel) ?? versions[0];
  const prev = current ? versions.find((v) => v.version === current.version - 1) : undefined;
  return (
    <Modal open={open} onClose={onClose} title="How this answer evolved" wide>
      {isLoading && <Spinner className="size-6 text-weave" />}
      {data && versions.length === 0 && <p className="text-muted">No versions yet.</p>}
      {current && (
        <div className="grid gap-5 md:grid-cols-[220px_1fr]">
          <ol className="max-h-[60vh] space-y-1 overflow-y-auto md:border-r md:border-line md:pr-3" aria-label="Versions">
            {versions.map((v) => (
              <li key={v.version}>
                <button
                  onClick={() => setSel(v.version)}
                  className={cx("w-full rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-sm", v.version === current.version ? "bg-weave-wash text-weave-deep" : "hover:bg-ink/5")}
                  aria-current={v.version === current.version}
                >
                  <span className="flex items-center gap-2 font-semibold">
                    Version {v.version}
                    {v.isFinal && <Pill tone="spruce">Final</Pill>}
                    {v.trigger === "carry" && <Pill>Carried</Pill>}
                  </span>
                  <span className="block text-[12.5px] text-muted tabular">{new Date(v.createdAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", day: "numeric", month: "short" })}</span>
                  {v.addedRefs.length > 0 && <span className="block text-[12.5px] text-muted">+{v.addedRefs.length} contribution{v.addedRefs.length === 1 ? "" : "s"}</span>}
                  {v.removedRefs.length > 0 && <span className="block text-[12.5px] text-alarm">−{v.removedRefs.length} withdrawn</span>}
                </button>
              </li>
            ))}
          </ol>
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-[var(--radius-sm)] border border-line p-0.5" role="group" aria-label="View">
                {(["diff", "full"] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={cx("rounded-[5px] px-3 py-1 text-sm font-semibold", mode === m ? "bg-ink text-white" : "text-muted")}>
                    {m === "diff" ? "What changed" : "Full version"}
                  </button>
                ))}
              </div>
              <span className="text-[12.5px] text-muted">
                {current.isFallback ? "Development fallback (not AI)" : current.provider === "carried-forward" ? "Carried forward" : `${current.provider}${current.model ? `, ${current.model}` : ""}`}
              </span>
            </div>
            {current.content.changes?.length > 0 && (
              <ul className="mb-3 space-y-1 rounded-[var(--radius-sm)] bg-weave-wash/70 px-3 py-2 text-[14px]">
                {current.content.changes.map((c, i) => (
                  <li key={i}>
                    <span className={cx("mr-1.5 font-semibold", c.type === "removed" ? "text-alarm" : c.type === "added" ? "text-spruce" : "text-weave-deep")}>
                      {c.type === "added" ? "Added" : c.type === "removed" ? "Removed" : "Revised"}
                    </span>
                    {c.text}
                  </li>
                ))}
              </ul>
            )}
            {current.warnings?.length > 0 && <p className="mb-3 text-[13px] text-tide">{current.warnings.join(" ")}</p>}
            {mode === "diff" ? (
              prev ? (
                <DiffText before={flatten(prev.content)} after={flatten(current.content)} />
              ) : (
                <p className="mb-2 text-sm text-muted">This is the first version.</p>
              )
            ) : null}
            {(mode === "full" || !prev) && (
              <div className="text-[15.5px]">
                <Markdown text={current.content.answer} renderRef={(n) => <RefChip n={n} onClick={() => onRef?.(n)} />} />
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
