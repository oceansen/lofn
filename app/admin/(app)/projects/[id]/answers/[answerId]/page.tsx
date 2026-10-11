"use client";
import { use, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { api, fetcher } from "@/lib/client/api";
import { AnswerPanel, type AnswerView } from "@/components/AnswerPanel";
import { ContributionCard, type ContributionView } from "@/components/ContributionCard";
import { Button, KIND_LABEL, Spinner, cx } from "@/components/ui";

type Data = {
  answer: AnswerView;
  meta: { question: string; instructions: string; group_name: string; cycle_name: string };
  contributions: ContributionView[];
};

export default function AnswerDetail({ params }: { params: Promise<{ id: string; answerId: string }> }) {
  const { id, answerId } = use(params);
  const key = `/api/admin/answers/${answerId}`;
  const { data, mutate } = useSWR<Data>(key, fetcher);
  const [flash, setFlash] = useState<number | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return <Spinner className="size-6 text-spruce" />;

  const cited = new Set<number>(data.answer.content?.refs ?? []);
  const list = data.contributions
    .filter((c) => filter === "all" || (filter === "cited" ? cited.has(c.ref) : filter === "uncited" ? !cited.has(c.ref) && !c.hidden : c.kind === filter))
    .slice()
    .reverse();
  const goTo = (n: number) => {
    setFilter("all");
    requestAnimationFrame(() => {
      document.getElementById(`contrib-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlash(n);
      setTimeout(() => setFlash(null), 1900);
    });
  };
  async function act(c: ContributionView, kind: "hide" | "show" | "retry") {
    setBusy(c.id + kind);
    try {
      if (kind === "retry") await api(`/api/admin/contributions/${c.id}/retry`, { body: {} });
      else await api(`/api/admin/contributions/${c.id}`, { method: "PATCH", body: { hidden: kind === "hide" } });
      mutate();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <Link href={`/admin/projects/${id}`} className="text-sm font-semibold text-muted hover:text-ink">
        Back to live view
      </Link>
      <p className="mt-3 text-sm font-semibold text-muted">
        {data.meta.group_name}, {data.meta.cycle_name}
      </p>
      <h2 className="max-w-[50ch] font-display text-[26px] leading-tight font-bold">{data.meta.question}</h2>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <AnswerPanel
            answer={data.answer}
            onRef={goTo}
            refLabel={(n) => data.contributions.find((c) => c.ref === n)?.text.slice(0, 120)}
            versionsUrl={`/api/admin/answers/${answerId}/versions`}
            headerExtra={
              <Button
                size="sm"
                variant="weave"
                busy={busy === "synth"}
                onClick={async () => {
                  setBusy("synth");
                  await api(`/api/admin/answers/${answerId}/synthesize`, { body: {} }).finally(() => setBusy(null));
                  mutate();
                }}
              >
                Update now
              </Button>
            }
          />
        </div>
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <h3 className="mr-2 font-display text-lg font-semibold">Contributions</h3>
            {["all", "cited", "uncited", "text", "audio", "image", "image_text", "video"].map((f) => (
              <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={cx("rounded-full border px-2.5 py-0.5 text-[13px] font-semibold", filter === f ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-muted")}>
                {f === "all" ? `All ${data.contributions.length}` : f === "cited" ? "Cited" : f === "uncited" ? "Not cited" : KIND_LABEL[f]}
              </button>
            ))}
          </div>
          <div className="space-y-2.5">
            {list.length === 0 && <p className="text-muted">Nothing matches this filter.</p>}
            {list.map((c) => (
              <ContributionCard
                key={c.id}
                c={c}
                flash={flash === c.ref}
                actions={
                  <>
                    {!cited.has(c.ref) && !c.hidden && c.status === "ready" && data.answer.version > 0 && <span className="text-[12px] text-faint">not cited</span>}
                    {c.status === "failed" && (
                      <Button size="sm" variant="ghost" busy={busy === c.id + "retry"} onClick={() => act(c, "retry")}>
                        Retry
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" busy={busy === c.id + (c.hidden ? "show" : "hide")} onClick={() => act(c, c.hidden ? "show" : "hide")} title={c.hidden ? "Include in synthesis again" : "Exclude from synthesis and hide from participants"}>
                      {c.hidden ? "Restore" : "Hide"}
                    </Button>
                  </>
                }
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
