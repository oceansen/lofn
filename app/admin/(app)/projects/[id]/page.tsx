"use client";
import { use, useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/client/api";
import { Countdown, NextUpdate, TideBar } from "@/components/Countdown";
import { CycleControls, type CycleV } from "@/components/admin/CycleControls";
import { Markdown } from "@/components/Markdown";
import { KIND_COLOR, KIND_LABEL, Notice, Pill, Spinner, cx } from "@/components/ui";
import type { AnswerView } from "@/components/AnswerPanel";

type Overview = {
  project: { id: string; name: string; status: string };
  questions: { id: string; title: string }[];
  groups: { id: string; name: string; accessCode: string; codeActive: boolean; questionIds: string[]; participantCount: number; activeCount: number }[];
  cycles: CycleV[];
  selectedCycleId: string | null;
  stats: { group_id: string; question_id: string; kind: string; n: number }[];
  answers: AnswerView[];
  timeline: { minute: string; n: number }[];
  processing: { pending: number; failed: number };
  ai: { isFallback: boolean; transcriptionFallback: boolean; synthesisProvider: string; synthesisModel: string | null };
};

const KINDS = ["text", "audio", "image", "image_text", "video"];

function KindBar({ counts, total, height = "h-2.5" }: { counts: Record<string, number>; total: number; height?: string }) {
  if (!total) return <div className={cx("w-full rounded-full bg-line", height)} />;
  return (
    <div className={cx("flex w-full overflow-hidden rounded-full bg-line", height)} role="img" aria-label={KINDS.filter((k) => counts[k]).map((k) => `${counts[k]} ${KIND_LABEL[k]}`).join(", ")}>
      {KINDS.map((k) => (counts[k] ? <span key={k} style={{ width: `${(counts[k] / total) * 100}%`, background: KIND_COLOR[k] }} /> : null))}
    </div>
  );
}

function answerState(a: AnswerView | undefined) {
  if (!a) return <span className="text-faint">—</span>;
  if (a.status === "synthesizing")
    return (
      <Pill tone="weave">
        <Spinner className="size-3" /> v{a.version}
      </Pill>
    );
  if (a.status === "error") return <Pill tone="alarm">Error</Pill>;
  if (a.isFinal) return <Pill tone="spruce">Final v{a.version}</Pill>;
  if (a.version === 0) return <Pill>{a.pendingCount ? `${a.pendingCount} waiting` : "Empty"}</Pill>;
  return <Pill tone={a.pendingCount ? "weave" : "neutral"}>v{a.version}{a.pendingCount ? ` +${a.pendingCount}` : ""}</Pill>;
}

export default function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [cycleSel, setCycleSel] = useState<string | null>(null);
  const { data, mutate } = useSWR<Overview>(`/api/admin/projects/${id}/live${cycleSel ? `?cycle=${cycleSel}` : ""}`, fetcher, { keepPreviousData: true });
  const [qSel, setQSel] = useState<string | null>(null);

  const agg = useMemo(() => {
    const byCell: Record<string, Record<string, number>> = {};
    const byKind: Record<string, number> = {};
    let total = 0;
    for (const s of data?.stats ?? []) {
      const k = `${s.group_id}:${s.question_id}`;
      byCell[k] ??= {};
      byCell[k][s.kind] = (byCell[k][s.kind] ?? 0) + s.n;
      byKind[s.kind] = (byKind[s.kind] ?? 0) + s.n;
      total += s.n;
    }
    return { byCell, byKind, total };
  }, [data]);

  if (!data) return <Spinner className="size-6 text-spruce" />;
  const cycle = data.cycles.find((c) => c.id === data.selectedCycleId) ?? null;
  const q = data.questions.find((x) => x.id === qSel) ?? data.questions[0];
  const setupSteps = [
    { done: data.questions.length > 0, label: "Add questions", href: "questions" },
    { done: data.groups.length > 0, label: "Create groups and share their codes", href: "groups" },
    { done: data.cycles.length > 0, label: "Set up a timed cycle", href: "cycles" },
  ];
  const joined = data.groups.reduce((s, g) => s + g.participantCount, 0);
  const active = data.groups.reduce((s, g) => s + g.activeCount, 0);
  const peak = Math.max(1, ...data.timeline.map((t) => t.n));

  return (
    <div className="space-y-6">
      {setupSteps.some((s) => !s.done) && (
        <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
          <h2 className="font-display text-lg font-semibold">Set up this project</h2>
          <ol className="mt-3 space-y-2">
            {setupSteps.map((s, i) => (
              <li key={s.href} className="flex items-center gap-3">
                <span className={cx("flex size-7 items-center justify-center rounded-full font-display text-sm font-bold", s.done ? "bg-spruce text-white" : "border-2 border-line-strong text-muted")}>
                  {s.done ? "✓" : i + 1}
                </span>
                <Link href={`/admin/projects/${id}/${s.href}`} className={cx("font-semibold", s.done ? "text-muted line-through" : "text-spruce hover:underline")}>
                  {s.label}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {data.ai.isFallback && (
        <Notice tone="tide">
          No AI provider is configured. Answers will be labelled development fallbacks that list contributions instead of synthesising them.
        </Notice>
      )}

      {cycle && (
        <section className={cx("overflow-hidden rounded-[var(--radius-lg)] border bg-surface", cycle.status === "running" ? "border-spruce" : "border-line")}>
          <TideBar cycle={cycle} />
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4 p-5">
            <div>
              <div className="flex items-center gap-2">
                {data.cycles.length > 1 ? (
                  <select
                    value={cycle.id}
                    onChange={(e) => setCycleSel(e.target.value)}
                    className="rounded-md border border-line bg-surface py-1 pr-7 pl-2 font-display text-[17px] font-semibold"
                    aria-label="Cycle"
                  >
                    {data.cycles.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <h2 className="font-display text-[17px] font-semibold">{cycle.name}</h2>
                )}
                {cycle.status === "ended" && <Pill tone={cycle.finalStatus === "done" ? "spruce" : "weave"}>{cycle.finalStatus === "done" ? "Final answers ready" : "Finalising answers"}</Pill>}
              </div>
              <Countdown cycle={cycle} size="lg" className="mt-1" />
              <p className="mt-1 text-[13.5px] text-muted">
                <NextUpdate cycle={cycle} />
              </p>
            </div>
            <div className="ml-auto">
              <CycleControls cycle={cycle} onChange={() => mutate()} />
            </div>
          </div>
          <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-4">
            {[
              { k: "Contributions", v: agg.total },
              { k: "People joined", v: joined, sub: active ? `${active} active now` : undefined },
              { k: "Being processed", v: data.processing.pending, sub: data.processing.failed ? `${data.processing.failed} failed` : undefined },
              { k: "Answers with versions", v: `${data.answers.filter((a) => a.version > 0).length}/${data.answers.length}` },
            ].map((s, i) => (
              <div key={s.k} className={cx("px-5 py-3", i > 0 && "sm:border-l sm:border-line", i % 2 === 1 && "border-l border-line sm:border-l")}>
                <dt className="text-[13px] text-muted">{s.k}</dt>
                <dd className="font-display text-2xl font-bold tabular">{s.v}</dd>
                {s.sub && <dd className={cx("text-[12.5px]", s.k === "Being processed" ? "text-alarm" : "text-muted")}>{s.sub}</dd>}
              </div>
            ))}
          </dl>
          {agg.total > 0 && (
            <div className="border-t border-line px-5 py-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                {KINDS.filter((k) => agg.byKind[k]).map((k) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm" style={{ background: KIND_COLOR[k] }} />
                    {KIND_LABEL[k]} <span className="font-semibold tabular">{agg.byKind[k]}</span>
                  </span>
                ))}
              </div>
              <div className="mt-2">
                <KindBar counts={agg.byKind} total={agg.total} />
              </div>
              {data.timeline.length > 1 && (
                <div className="mt-4">
                  <p className="text-[13px] text-muted">Contributions per minute</p>
                  <div className="mt-1 flex h-12 items-end gap-[2px]" role="img" aria-label={`Peak ${peak} contributions per minute`}>
                    {data.timeline.map((t) => (
                      <span key={t.minute} title={`${new Date(t.minute).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}: ${t.n}`} className="min-w-[3px] flex-1 rounded-t-[2px] bg-spruce/70" style={{ height: `${(t.n / peak) * 100}%` }} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {cycle && data.groups.length > 0 && data.questions.length > 0 && (
        <section>
          <h2 className="mb-2 font-display text-lg font-semibold">Groups by question</h2>
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-surface">
            <table className="w-full min-w-[640px] text-left text-[14.5px]">
              <thead>
                <tr className="border-b border-line text-[13px] text-muted">
                  <th className="px-4 py-2.5 font-semibold">Group</th>
                  {data.questions.map((qq, i) => (
                    <th key={qq.id} className="px-4 py-2.5 font-semibold" title={qq.title}>
                      <span className="font-display tabular">{i + 1}</span> <span className="line-clamp-1 max-w-[14rem] font-normal">{qq.title}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.groups.map((g) => (
                  <tr key={g.id} className="border-b border-line last:border-0">
                    <th scope="row" className="px-4 py-3 align-top font-semibold">
                      {g.name}
                      <span className="block text-[12.5px] font-normal text-muted">
                        {g.participantCount} joined{g.activeCount ? `, ${g.activeCount} active` : ""}
                      </span>
                    </th>
                    {data.questions.map((qq) => {
                      if (!g.questionIds.includes(qq.id)) return <td key={qq.id} className="px-4 py-3 text-faint">Not assigned</td>;
                      const counts = agg.byCell[`${g.id}:${qq.id}`] ?? {};
                      const n = Object.values(counts).reduce((s, x) => s + x, 0);
                      const a = data.answers.find((x) => x.groupId === g.id && x.questionId === qq.id);
                      return (
                        <td key={qq.id} className="px-4 py-3 align-top">
                          <div className="flex items-center gap-2">
                            <span className="font-display text-lg font-bold tabular">{n}</span>
                            {a ? (
                              <Link href={`/admin/projects/${id}/answers/${a.id}`} className="hover:opacity-80" aria-label={`Open ${g.name}'s answer`}>
                                {answerState(a)}
                              </Link>
                            ) : (
                              answerState(a)
                            )}
                          </div>
                          <div className="mt-1.5 w-28">
                            <KindBar counts={counts} total={n} height="h-1.5" />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {cycle && q && (
        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-display text-lg font-semibold">Current answers</h2>
            <Link href={`/admin/projects/${id}/compare?cycle=${cycle.id}&question=${q.id}`} className="text-sm font-semibold text-spruce hover:underline">
              Compare side by side
            </Link>
          </div>
          {data.questions.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {data.questions.map((qq, i) => (
                <button key={qq.id} onClick={() => setQSel(qq.id)} aria-pressed={qq.id === q.id} className={cx("max-w-xs truncate rounded-full border px-3 py-1 text-[13.5px]", qq.id === q.id ? "border-ink bg-ink text-white" : "border-line-strong bg-surface")}>
                  <span className="font-semibold">{i + 1}</span> {qq.title}
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.groups
              .filter((g) => g.questionIds.includes(q.id))
              .map((g) => {
                const a = data.answers.find((x) => x.groupId === g.id && x.questionId === q.id);
                return (
                  <Link
                    key={g.id}
                    href={a ? `/admin/projects/${id}/answers/${a.id}` : "#"}
                    className={cx("weave-edge block rounded-[var(--radius-lg)] border border-weave-line bg-weave-wash/40 p-4 pt-5 hover:border-weave", a?.status === "synthesizing" && "is-updating")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="mr-auto font-semibold">{g.name}</span>
                      {answerState(a)}
                    </div>
                    <div className="mt-2 line-clamp-[8] text-[14.5px]">
                      {a?.content?.answer ? (
                        <Markdown text={a.content.answer} renderRef={(n) => <span className="font-display text-[11px] font-bold text-weave">C{n}</span>} />
                      ) : (
                        <p className="text-muted">No answer yet.</p>
                      )}
                    </div>
                  </Link>
                );
              })}
          </div>
        </section>
      )}
    </div>
  );
}
