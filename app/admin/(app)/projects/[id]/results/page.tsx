"use client";
import { Suspense, use, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, fetcher, timeAgo, useNow } from "@/lib/client/api";
import { Markdown } from "@/components/Markdown";
import { RefChip } from "@/components/AnswerPanel";
import { Button, Empty, Notice, Pill, Spinner, cx } from "@/components/ui";
import type { CycleV } from "@/components/admin/CycleControls";

type GroupItem = { text: string; groups: number[] };
type QS = {
  question_id: string;
  question: string;
  groups: { n: number; id: string; name: string }[];
  synthesis: string;
  agreements: GroupItem[];
  differences: GroupItem[];
  distinctive: { group: number; text: string }[];
  open_questions: GroupItem[];
  is_fallback: boolean;
};
type Synthesis = {
  id: string;
  cycleId: string | null;
  cycleName: string | null;
  status: "queued" | "running" | "done" | "error";
  content: { overview: string; questions: QS[] } | null;
  provider: string | null;
  model: string | null;
  isFallback: boolean;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

export default function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Spinner className="size-6 text-spruce" />}>
      <Results id={id} />
    </Suspense>
  );
}

function Results({ id }: { id: string }) {
  const sp = useSearchParams();
  const [cycle, setCycle] = useState<string>(sp.get("cycle") || "");
  const now = useNow(10_000);
  const { data: cyc } = useSWR<{ cycles: CycleV[] }>(`/api/admin/projects/${id}/cycles`, fetcher);
  const { data: syn, mutate } = useSWR<{ syntheses: Synthesis[] }>(`/api/admin/projects/${id}/synthesis`, fetcher);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const started = (cyc?.cycles ?? []).filter((c) => c.status !== "draft");
  const forScope = (syn?.syntheses ?? []).filter((s) => (s.cycleId ?? "") === cycle);
  const current = forScope.find((s) => s.id === selected) ?? forScope[0];
  const live = started.find((c) => c.id === cycle && (c.status === "running" || c.status === "paused"));
  const q = cycle ? `&cycle=${cycle}` : "";

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const r = await api(`/api/admin/projects/${id}/synthesis`, { body: { cycleId: cycle || null } });
      setSelected(r.id);
      mutate();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h2 className="font-display text-xl font-semibold">Results</h2>
          <p className="text-[15px] text-muted">Combine group answers into a project-level synthesis, and export everything.</p>
        </div>
        <label className="text-sm">
          <span className="mr-2 text-muted">Scope</span>
          <select value={cycle} onChange={(e) => (setCycle(e.target.value), setSelected(null))} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 font-semibold">
            <option value="">All cycles (latest answer per group)</option>
            {started.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
        <h3 className="font-display text-lg font-semibold">Export</h3>
        <p className="text-[15px] text-muted">Project, questions, group answers with version history, the latest project synthesis, and every contribution with timestamps and media links.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={`/api/admin/projects/${id}/export?format=pdf${q}`} className="inline-flex h-10 items-center rounded-[var(--radius-md)] bg-spruce px-4 font-semibold text-white hover:bg-spruce-deep">
            Download PDF report
          </a>
          <a href={`/api/admin/projects/${id}/export?format=md${q}`} className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-line-strong bg-surface px-4 font-semibold hover:border-ink">
            Markdown
          </a>
          <a href={`/api/admin/projects/${id}/export?format=json${q}`} className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-line-strong bg-surface px-4 font-semibold hover:border-ink">
            JSON
          </a>
        </div>
        {live && <p className="mt-2 text-sm text-tide">{live.name} is still live; an export now captures the answers as they stand.</p>}
      </section>

      <section className="weave-edge rounded-[var(--radius-lg)] border border-weave-line bg-weave-wash/40 p-5 pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h3 className="font-display text-lg font-semibold text-weave-deep">Project-level synthesis</h3>
            <p className="text-[15px] text-muted">Brings group answers together while keeping agreements, differences and distinctive perspectives visible.</p>
          </div>
          <Button variant="weave" onClick={generate} busy={busy || current?.status === "queued" || current?.status === "running"}>
            {current ? "Generate again" : "Generate synthesis"}
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-alarm">{error}</p>}
        {forScope.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-1.5 text-[13px]">
            {forScope.map((s, i) => (
              <button key={s.id} onClick={() => setSelected(s.id)} aria-pressed={s.id === current?.id} className={cx("rounded-full border px-2.5 py-0.5 font-semibold", s.id === current?.id ? "border-weave bg-weave text-white" : "border-weave-line bg-surface text-weave-deep")}>
                {i === 0 ? "Latest" : timeAgo(s.createdAt, now)}
              </button>
            ))}
          </div>
        )}
        <div className="mt-4">
          {!syn ? (
            <Spinner className="size-6 text-weave" />
          ) : !current ? (
            <Empty title="No project synthesis yet">Generate one when groups have answers. You can regenerate it any time; earlier versions are kept.</Empty>
          ) : current.status === "queued" || current.status === "running" ? (
            <p className="flex items-center gap-2 text-weave-deep">
              <Spinner className="size-5" /> Reading every group’s answer…
            </p>
          ) : current.status === "error" ? (
            <Notice tone="alarm">The synthesis failed: {current.error}. Try generating again.</Notice>
          ) : (
            current.content && <SynthesisView s={current} />
          )}
        </div>
      </section>
    </div>
  );
}

function SynthesisView({ s }: { s: Synthesis }) {
  const c = s.content!;
  return (
    <div className="space-y-8">
      <p className="text-[13px] text-muted">
        {s.isFallback ? "Development fallback — not an AI synthesis" : `${s.provider}, ${s.model}`}, generated {new Date(s.completedAt ?? s.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
      </p>
      {c.overview && (
        <div className="max-w-[72ch] text-[16.5px]">
          <h4 className="mb-1 font-display text-[16px] font-semibold">Overview</h4>
          <Markdown text={c.overview} renderRef={(n) => <span className="font-semibold">G{n}</span>} />
        </div>
      )}
      {c.questions.map((q, i) => {
        const name = (n: number) => q.groups.find((g) => g.n === n)?.name ?? `G${n}`;
        const chips = (groups: number[]) => (
          <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
            {groups.map((n) => (
              <span key={n} className="rounded-[5px] bg-surface px-1.5 text-[12px] font-semibold text-weave-deep ring-1 ring-weave-line">
                {name(n)}
              </span>
            ))}
          </span>
        );
        const sec = (label: string, items: GroupItem[], mark: string) =>
          items.length > 0 && (
            <div>
              <h5 className="flex items-center gap-2 font-display text-[15px] font-semibold">
                <span className={cx("h-3 w-1.5 rounded-full", mark)} aria-hidden="true" />
                {label}
              </h5>
              <ul className="mt-1 space-y-1.5 border-l border-weave-line pl-4 text-[15.5px]">
                {items.map((it, j) => (
                  <li key={j}>
                    <Markdown text={it.text} className="prose-answer inline [&>p]:my-0 [&>p]:inline" renderRef={(n) => <RefChip n={n} kind="G" label={name(n)} />} />
                    {chips(it.groups)}
                  </li>
                ))}
              </ul>
            </div>
          );
        return (
          <article key={q.question_id} className="border-t border-weave-line pt-5">
            <p className="text-sm font-semibold text-muted">Question {i + 1}</p>
            <h4 className="max-w-[60ch] font-display text-[20px] leading-snug font-bold">{q.question}</h4>
            {q.groups.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-x-3 text-[13px] text-muted">
                {q.groups.map((g) => (
                  <span key={g.n}>
                    <span className="font-semibold text-weave">G{g.n}</span> {g.name}
                  </span>
                ))}
              </p>
            )}
            <div className="mt-3 max-w-[72ch] text-[16.5px]">
              <Markdown text={q.synthesis} renderRef={(n) => <RefChip n={n} kind="G" label={name(n)} />} />
            </div>
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              {sec("Where groups agree", q.agreements, "bg-spruce")}
              {sec("Where groups differ", q.differences, "bg-alarm")}
              {q.distinctive.length > 0 && (
                <div>
                  <h5 className="flex items-center gap-2 font-display text-[15px] font-semibold">
                    <span className="h-3 w-1.5 rounded-full bg-[#7a5c99]" aria-hidden="true" />
                    Distinctive perspectives
                  </h5>
                  <ul className="mt-1 space-y-1.5 border-l border-weave-line pl-4 text-[15.5px]">
                    {q.distinctive.map((d, j) => (
                      <li key={j}>
                        <Pill tone="weave" className="mr-1.5">
                          {name(d.group)}
                        </Pill>
                        {d.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {sec("Open questions", q.open_questions, "bg-tide")}
            </div>
          </article>
        );
      })}
      <p className="text-[13px] text-muted">
        Want the detail behind a point? <Link className="font-semibold text-spruce" href="compare">Compare the group answers</Link>.
      </p>
    </div>
  );
}
