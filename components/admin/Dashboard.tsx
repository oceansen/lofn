"use client";
import Link from "next/link";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, fetcher } from "@/lib/client/api";
import { Countdown } from "@/components/Countdown";
import { Button, Empty, Notice, Pill, Spinner, cx } from "@/components/ui";

type P = {
  id: string;
  name: string;
  description: string;
  status: string;
  questionCount: number;
  groupCount: number;
  contributionCount: number;
  synthesizing: number;
  updatedAt: string;
  cycle: null | { id: string; name: string; status: any; ends_at: string | null; remaining_ms: number | null; duration_ms: number; final_status: string };
};

export function Dashboard() {
  const router = useRouter();
  const { data, mutate } = useSWR<{ projects: P[] }>("/api/admin/projects", fetcher, { refreshInterval: 10_000 });
  const { data: sys } = useSWR("/api/admin/system", fetcher, { refreshInterval: 30_000 });
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const projects = (data?.projects ?? []).filter((p) => showArchived || p.status === "active");
  const archived = (data?.projects ?? []).filter((p) => p.status === "archived").length;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="font-display text-[34px] leading-tight font-bold">Projects</h1>
          <p className="text-muted">Each project holds questions, groups and timed feedback cycles.</p>
        </div>
        <Button variant="primary" onClick={() => router.push("/admin/projects/new")}>
          New project
        </Button>
      </div>

      {sys?.ai?.isFallback && (
        <Notice tone="tide" className="mt-6">
          <strong>AI synthesis is not configured.</strong> Answers will be clearly labelled development fallbacks that list contributions verbatim. Set{" "}
          <code>ANTHROPIC_API_KEY</code> or <code>OPENAI_API_KEY</code> for the app and the worker, then restart both.
        </Notice>
      )}
      {sys && !sys.ai.isFallback && sys.ai.transcriptionFallback && (
        <Notice className="mt-6 text-[14.5px]">
          Audio and video transcription needs <code>OPENAI_API_KEY</code> (or an OpenAI-compatible endpoint). Images are interpreted; recordings are stored but not transcribed.
        </Notice>
      )}

      <div className="mt-6">
        {!data ? (
          <Spinner className="size-6 text-spruce" />
        ) : projects.length === 0 ? (
          <Empty title="No projects yet" action={<Button variant="primary" onClick={() => router.push("/admin/projects/new")}>Create your first project</Button>}>
            A project gathers the questions you want groups to answer together.
          </Empty>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
            {projects.map((p) => {
              const live = p.cycle && (p.cycle.status === "running" || p.cycle.status === "paused");
              const cycle = p.cycle
                ? { id: p.cycle.id, name: p.cycle.name, status: p.cycle.status, durationMs: p.cycle.duration_ms, endsAt: p.cycle.status === "running" ? p.cycle.ends_at : null, remainingMs: p.cycle.remaining_ms ?? 0 }
                : null;
              return (
                <li key={p.id} className="relative flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 hover:bg-paper/50">
                  <span
                    className={cx("absolute inset-y-0 left-0 w-1", live ? (p.cycle!.status === "running" ? "bg-spruce" : "bg-tide") : "bg-transparent")}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1 basis-72">
                    <Link href={`/admin/projects/${p.id}`} className="font-display text-[19px] font-semibold hover:underline">
                      {p.name}
                    </Link>
                    {p.status === "archived" && <Pill className="ml-2">Archived</Pill>}
                    {p.description && <p className="mt-0.5 line-clamp-1 text-[15px] text-muted">{p.description}</p>}
                    <p className="mt-1 text-[13.5px] text-muted">
                      {p.questionCount} question{p.questionCount === 1 ? "" : "s"}, {p.groupCount} group{p.groupCount === 1 ? "" : "s"}, {p.contributionCount} contribution
                      {p.contributionCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex min-w-48 items-center gap-3">
                    {live && cycle ? (
                      <div>
                        <p className="text-[13px] font-semibold text-muted">{p.cycle!.name}</p>
                        <Countdown cycle={cycle as any} size="sm" />
                      </div>
                    ) : p.cycle?.status === "ended" ? (
                      <Pill tone={p.cycle.final_status === "done" ? "spruce" : "weave"}>{p.cycle.final_status === "done" ? `${p.cycle.name} complete` : "Finalising answers"}</Pill>
                    ) : (
                      <Pill>{p.cycle ? "Ready to start" : "No cycles yet"}</Pill>
                    )}
                    {p.synthesizing > 0 && (
                      <Pill tone="weave">
                        <Spinner className="size-3" /> AI working
                      </Pill>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="primary" onClick={() => router.push(`/admin/projects/${p.id}`)}>
                      Open
                    </Button>
                    <Button
                      size="sm"
                      busy={busy === p.id}
                      onClick={async () => {
                        setBusy(p.id);
                        const r = await api(`/api/admin/projects/${p.id}/duplicate`, { body: {} }).finally(() => setBusy(null));
                        mutate();
                        router.push(`/admin/projects/${r.project.id}/settings`);
                      }}
                    >
                      Duplicate
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {archived > 0 && (
          <button className="mt-4 text-sm font-semibold text-muted hover:text-ink" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "Hide archived projects" : `Show ${archived} archived project${archived === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
      {sys && (
        <p className="mt-10 text-[13px] text-muted">
          AI: {sys.ai.isFallback ? "development fallback" : `${sys.ai.synthesisProvider} (${sys.ai.synthesisModel})`}. Transcription:{" "}
          {sys.ai.transcriptionFallback ? "off" : `${sys.ai.transcriptionProvider} (${sys.ai.transcriptionModel})`}. Synthesis every {sys.synthesisIntervalSeconds}s. Queue: {sys.queue.queued} waiting,{" "}
          {sys.queue.running} running{sys.queue.failed_24h ? `, ${sys.queue.failed_24h} failed today` : ""}. Storage: {sys.storage}.
        </p>
      )}
    </main>
  );
}
