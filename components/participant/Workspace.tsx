"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { api, fetcher, useLive, HttpError } from "@/lib/client/api";
import { Countdown, TideBar, type CycleLike } from "@/components/Countdown";
import { AnswerPanel, type AnswerView } from "@/components/AnswerPanel";
import { ContributionCard, type ContributionView } from "@/components/ContributionCard";
import { Composer, type Limits } from "@/components/Composer";
import { Button, LofnMark, Modal, Notice, Spinner, cx } from "@/components/ui";
import { ConsentGate, YourDataModal } from "@/components/participant/Consent";

type Workspace = {
  project: { id: string; name: string; description: string };
  group: { id: string; name: string };
  me: { id: string; alias: string; display_name: string };
  cycle: (CycleLike & { note: string; finalStatus: string }) | null;
  cycles: { id: string; name: string; status: string }[];
  questions: { id: string; title: string; instructions: string; image_version: number | null; image_alt: string | null }[];
  answers: AnswerView[];
  contributions: ContributionView[];
  citedEarlier: ContributionView[];
  limits: Limits;
  ai: { isFallback: boolean; transcriptionFallback: boolean };
  consent: { recordings: boolean; health: boolean; signedAt: string; version: number };
};

export function ParticipantWorkspace() {
  const router = useRouter();
  const [cycleSel, setCycleSel] = useState<string | null>(null);
  const key = `/api/p/workspace${cycleSel ? `?cycle=${cycleSel}` : ""}`;
  const { data, error, mutate } = useSWR<Workspace>(key, fetcher, { revalidateOnFocus: true, keepPreviousData: true });
  const live = useLive("/api/p/events", (k) => k.startsWith("/api/p/"));
  const [qIndex, setQIndex] = useState(0);
  const [pane, setPane] = useState<"contribute" | "answer">("contribute");
  const [flashRef, setFlashRef] = useState<number | null>(null);
  const [earlier, setEarlier] = useState<ContributionView | null>(null);
  const [zoom, setZoom] = useState(false);
  const [seen, setSeen] = useState<Record<string, number>>({});
  const [dataOpen, setDataOpen] = useState(false);

  useEffect(() => {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) router.replace("/");
  }, [error, router]);

  const questions = data?.questions ?? [];
  const q = questions[Math.min(qIndex, Math.max(0, questions.length - 1))];
  const answer = useMemo(() => data?.answers.find((a) => a.questionId === q?.id) ?? null, [data, q]);
  const feed = useMemo(() => (data?.contributions ?? []).filter((c) => c.questionId === q?.id).slice().reverse(), [data, q]);
  const cycle = data?.cycle ?? null;
  const open = cycle?.status === "running";

  // Mark the answer as seen whenever it's on screen.
  const answerVisible = pane === "answer" || (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    if (answer && answerVisible) setSeen((s) => (s[answer.id] === answer.version ? s : { ...s, [answer.id]: answer.version }));
  }, [answer, answerVisible]);
  const unseen = (qid: string) => {
    const a = data?.answers.find((x) => x.questionId === qid);
    return !!a && a.version > 0 && (seen[a.id] ?? 0) < a.version;
  };

  const lookup = useCallback(
    (n: number) => data?.contributions.find((c) => c.ref === n) ?? data?.citedEarlier.find((c) => c.ref === n),
    [data],
  );
  const goToRef = (n: number) => {
    const inFeed = feed.find((c) => c.ref === n);
    if (!inFeed) {
      const e = lookup(n);
      if (e) setEarlier(e);
      return;
    }
    setPane("contribute");
    requestAnimationFrame(() => {
      document.getElementById(`contrib-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashRef(n);
      setTimeout(() => setFlashRef(null), 1900);
    });
  };

  if (error instanceof HttpError && error.status === 428) return <ConsentGate onSigned={() => mutate()} />;
  if (!data) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        {error && !(error instanceof HttpError && error.status === 401) ? (
          <Notice tone="alarm" className="m-4 max-w-md">
            {error.message}{" "}
            <button className="font-semibold underline" onClick={() => mutate()}>
              Try again
            </button>
          </Notice>
        ) : (
          <Spinner className="size-7 text-spruce" />
        )}
      </div>
    );
  }

  const disabledReason = !cycle
    ? "The facilitator hasn’t set up a session yet."
    : cycle.status === "draft"
      ? "The session hasn’t started yet. Read the questions — you can contribute as soon as it begins."
      : cycle.status === "paused"
        ? "Paused by the facilitator. You can contribute again when the session resumes."
        : "This round has ended. Contributions are closed.";

  return (
    <div className="min-h-dvh pb-20">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/92 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <LofnMark className="size-7 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] leading-tight font-semibold">{data.project.name}</p>
            <p className="truncate text-[13px] leading-tight text-muted">
              {data.group.name}
              {cycle && <>, {cycle.name}</>}
              <span className={cx("ml-2 inline-block size-1.5 translate-y-[-1px] rounded-full", live === "live" ? "bg-spruce" : "bg-tide")} title={live === "live" ? "Live" : "Reconnecting"} />
            </p>
          </div>
          <Countdown cycle={cycle} size="md" className="shrink-0 sm:hidden" />
          <Countdown cycle={cycle} size="lg" className="hidden shrink-0 sm:flex" />
        </div>
        <TideBar cycle={cycle} />
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        {cycle?.note && cycle.status !== "ended" && <p className="mt-4 text-[15px] text-muted">{cycle.note}</p>}
        {cycle?.status === "paused" && (
          <Notice tone="tide" className="mt-4">
            The facilitator has paused the session. The clock is stopped.
          </Notice>
        )}
        {cycle?.status === "ended" && (
          <Notice tone="weave" className="mt-4">
            {cycle.finalStatus === "done" ? "This round is complete. Your group’s final answers are below." : "Time’s up. Lofn is writing the final version of your group’s answers…"}
          </Notice>
        )}
        {data.ai.isFallback && (
          <Notice tone="tide" className="mt-4 text-[14px]">
            AI synthesis isn’t configured on this server, so answers will list contributions instead of combining them.
          </Notice>
        )}

        {data.cycles.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Round</span>
            {data.cycles.map((c) => (
              <button
                key={c.id}
                onClick={() => setCycleSel(c.id)}
                aria-pressed={cycle?.id === c.id}
                className={cx("rounded-full border px-3 py-1 font-semibold", cycle?.id === c.id ? "border-ink bg-ink text-white" : "border-line-strong bg-surface")}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {questions.length === 0 ? (
          <p className="mt-10 text-center text-muted">No questions have been assigned to your group yet.</p>
        ) : (
          <>
            {questions.length > 1 && (
              <nav className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" aria-label="Questions">
                {questions.map((qq, i) => (
                  <button
                    key={qq.id}
                    onClick={() => setQIndex(i)}
                    aria-current={i === qIndex ? "page" : undefined}
                    className={cx(
                      "relative flex max-w-[16rem] shrink-0 items-center gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-left text-[14.5px]",
                      i === qIndex ? "border-ink bg-surface font-semibold" : "border-line bg-surface/50 text-muted hover:text-ink",
                    )}
                  >
                    <span className="font-display font-bold tabular">{i + 1}</span>
                    <span className="truncate">{qq.title}</span>
                    {unseen(qq.id) && i !== qIndex && <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-weave" aria-label="Answer updated" />}
                  </button>
                ))}
              </nav>
            )}

            {q && (
              <section className="mt-5" aria-labelledby="q-title">
                <p className="text-sm font-semibold text-muted">
                  Question {qIndex + 1} of {questions.length}
                </p>
                <h1 id="q-title" className="mt-1 max-w-[38ch] font-display text-[27px] leading-[1.15] font-bold sm:text-[34px]">
                  {q.title}
                </h1>
                <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-start">
                  {q.image_version && (
                    <button onClick={() => setZoom(true)} className="group shrink-0 md:w-[44%]" aria-label="Enlarge the reference image">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/questions/${q.id}/image?v=${q.image_version}`}
                        alt={q.image_alt || "Reference image for this question"}
                        className="w-full rounded-[var(--radius-md)] border border-line bg-surface shadow-[0_1px_0_rgb(21_32_30/0.05)] group-hover:border-ink"
                      />
                      <span className="mt-1 block text-left text-[13px] text-muted">Tap to enlarge</span>
                    </button>
                  )}
                  {q.instructions && <Instructions text={q.instructions} />}
                </div>

                <div className="mt-5 grid grid-cols-2 rounded-[var(--radius-md)] border border-line bg-surface p-1 lg:hidden" role="tablist">
                  {(["contribute", "answer"] as const).map((p) => (
                    <button
                      key={p}
                      role="tab"
                      aria-selected={pane === p}
                      onClick={() => setPane(p)}
                      className={cx("relative h-10 rounded-[7px] text-[15px] font-semibold", pane === p ? (p === "answer" ? "bg-weave text-white" : "bg-spruce text-white") : "text-muted")}
                    >
                      {p === "contribute" ? `Contribute${feed.length ? ` (${feed.length})` : ""}` : "Group answer"}
                      {p === "answer" && pane !== "answer" && unseen(q.id) && <span className="absolute top-2 right-3 size-2 rounded-full bg-weave" aria-label="updated" />}
                    </button>
                  ))}
                </div>

                <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-8">
                  <div className={cx("space-y-4", pane !== "contribute" && "hidden lg:block")}>
                    <Composer
                      key={q.id}
                      questionId={q.id}
                      enabled={open}
                      disabledReason={disabledReason}
                      limits={data.limits}
                      allowMedia={data.consent.recordings}
                      onSent={() => mutate()}
                    />
                    {data.ai.transcriptionFallback && open && <p className="text-[13px] text-muted">Voice and video are saved but won’t be transcribed on this server.</p>}
                    <div>
                      <h2 className="mb-2 flex items-baseline gap-2 font-display text-[17px] font-semibold">
                        Contributions <span className="text-sm font-medium text-muted">{feed.length ? `${feed.length}, newest first` : ""}</span>
                      </h2>
                      {feed.length === 0 ? (
                        <p className="rounded-[var(--radius-md)] border border-dashed border-line-strong px-4 py-6 text-center text-[15px] text-muted">
                          {open ? "Nothing yet. Your first thought is a good place to start." : "No contributions in this round."}
                        </p>
                      ) : (
                        <div className="space-y-2.5">
                          {feed.map((c) => (
                            <ContributionCard key={c.id} c={c} flash={flashRef === c.ref} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={cx(pane !== "answer" && "hidden lg:block")}>
                    <div className="lg:sticky lg:top-28">
                      <AnswerPanel
                        answer={answer}
                        cycle={cycle}
                        onRef={goToRef}
                        refLabel={(n) => lookup(n)?.text?.slice(0, 120)}
                        versionsUrl={answer && answer.version > 0 ? `/api/p/answers/${answer.id}` : undefined}
                      />
                    </div>
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <footer className="mx-auto mt-12 flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 text-[13px] text-muted sm:px-6">
        <span>
          You appear as {data.me.display_name || data.me.alias} to your group and facilitator.
        </span>
        <span className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" className="whitespace-nowrap" onClick={() => setDataOpen(true)}>
            Consent and your data
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="whitespace-nowrap"
            onClick={async () => {
              await api("/api/p/leave", { body: {} }).catch(() => {});
              router.replace("/");
            }}
          >
            Leave group
          </Button>
        </span>
      </footer>
      <YourDataModal open={dataOpen} onClose={() => setDataOpen(false)} onChanged={() => mutate()} />

      <Modal open={zoom && !!q?.image_version} onClose={() => setZoom(false)} title={q?.title ?? ""} wide>
        {q?.image_version && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/questions/${q.id}/image?v=${q.image_version}`} alt={q.image_alt || "Reference image"} className="w-full" />
        )}
      </Modal>
      <Modal open={!!earlier} onClose={() => setEarlier(null)} title={earlier ? `C${earlier.ref} from an earlier round` : ""}>
        {earlier && <ContributionCard c={earlier} />}
      </Modal>
    </div>
  );
}

/** Long instructions collapse so the contribution tools stay near the top. */
function Instructions({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 420;
  return (
    <div className="min-w-0 flex-1">
      <p className={cx("max-w-[65ch] text-[16px] whitespace-pre-wrap text-muted", long && !open && "line-clamp-6")}>{text}</p>
      {long && (
        <button onClick={() => setOpen(!open)} className="mt-1 text-sm font-semibold text-spruce hover:underline">
          {open ? "Show less" : "Show full guidance"}
        </button>
      )}
    </div>
  );
}
