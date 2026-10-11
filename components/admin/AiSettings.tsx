"use client";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { api, fetcher } from "@/lib/client/api";
import { Button, Input, Notice, Pill, Spinner, cx } from "@/components/ui";

type Task = "synthesis" | "vision" | "transcription";
type Setting = { provider: string; model: string };
type Data = {
  settings: Record<Task, Setting>;
  keys: Record<string, boolean>;
  defaults: Record<Task, Record<string, string>>;
  providers: { chat: string[]; asr: string[] };
};
type Model = { id: string; task: string; providers: string[]; structured: boolean; recommended: boolean; downloads: number; likes: number; vision: boolean };

const LABEL: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", huggingface: "Hugging Face", none: "Off" };
const KEY: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", huggingface: "HF_TOKEN" };
const TASKS: { task: Task; title: string; help: string }[] = [
  { task: "synthesis", title: "Answer synthesis", help: "Weaves contributions into each group’s answer every minute, and writes the project-level synthesis. Choose a strong instruction-following model." },
  { task: "vision", title: "Image and video interpretation", help: "Describes photos and video keyframes so they can be used as evidence. Needs a vision-language model." },
  { task: "transcription", title: "Voice and video transcription", help: "Turns recorded speech into text. Whisper-family models work well." },
];

export function AiSettingsForm() {
  const { data, mutate } = useSWR<Data>("/api/admin/ai", fetcher);
  const [draft, setDraft] = useState<Record<Task, Setting> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  useEffect(() => {
    if (data && !draft) setDraft(data.settings);
  }, [data, draft]);
  if (!data || !draft) return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6"><Spinner className="size-6 text-spruce" /></main>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api("/api/admin/ai", { method: "PUT", body: draft });
      setDraft(r.settings);
      mutate();
      setMsg({ tone: "ok", text: "Saved. New contributions use these models within a few seconds." });
    } catch (e: any) {
      setMsg({ tone: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-[34px] leading-tight font-bold">AI models</h1>
      <p className="mt-1 max-w-[62ch] text-muted">
        Choose which provider and model handle each job. Hugging Face gives you access to open models served by its Inference Providers, billed to your Hugging Face account.
      </p>
      {!Object.values(data.keys).some(Boolean) && (
        <Notice tone="tide" className="mt-5">
          No API keys are configured on the server, so Lofn runs in its labelled development fallback. Add <code>HF_TOKEN</code> (a Hugging Face token with
          “Make calls to Inference Providers” permission), <code>ANTHROPIC_API_KEY</code> or <code>OPENAI_API_KEY</code> as environment variables or Space secrets, then restart.
        </Notice>
      )}
      <div className="mt-6 space-y-5">
        {TASKS.map(({ task, title, help }) => (
          <TaskCard
            key={task}
            task={task}
            title={title}
            help={help}
            value={draft[task]}
            providers={task === "transcription" ? data.providers.asr : data.providers.chat}
            keys={data.keys}
            defaults={data.defaults[task]}
            onChange={(v) => setDraft({ ...draft, [task]: v })}
          />
        ))}
      </div>
      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-3 border-t border-line bg-paper/95 py-4 backdrop-blur">
        <Button variant="primary" onClick={save} busy={busy} disabled={!dirty}>
          Save AI settings
        </Button>
        {dirty && <Button variant="ghost" onClick={() => setDraft(data.settings)}>Discard changes</Button>}
        {msg && (
          <p role="status" className={cx("text-sm font-medium", msg.tone === "ok" ? "text-spruce" : "text-alarm")}>
            {msg.text}
          </p>
        )}
      </div>
    </main>
  );
}

function TaskCard({
  task, title, help, value, providers, keys, defaults, onChange,
}: {
  task: Task; title: string; help: string; value: Setting; providers: string[]; keys: Record<string, boolean>; defaults: Record<string, string>; onChange: (v: Setting) => void;
}) {
  const [test, setTest] = useState<null | "running" | { ok: boolean; latencyMs: number; sample?: string; error?: string }>(null);
  const missingKey = value.provider !== "none" && !keys[value.provider];
  async function runTest() {
    setTest("running");
    try {
      setTest(await api("/api/admin/ai/test", { body: { task, ...value } }));
    } catch (e: any) {
      setTest({ ok: false, latencyMs: 0, error: e.message });
    }
  }
  return (
    <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mt-0.5 max-w-[65ch] text-[14.5px] text-muted">{help}</p>
      <div className="mt-4 flex flex-wrap gap-1.5" role="radiogroup" aria-label={`${title} provider`}>
        {providers.map((p) => (
          <button
            key={p}
            role="radio"
            aria-checked={value.provider === p}
            onClick={() => {
              onChange({ provider: p, model: p === value.provider ? value.model : defaults[p] || "" });
              setTest(null);
            }}
            className={cx(
              "rounded-[var(--radius-md)] border px-3.5 py-2 text-[14.5px] font-semibold",
              value.provider === p ? "border-ink bg-ink text-white" : "border-line-strong bg-surface hover:border-ink",
            )}
          >
            {LABEL[p] ?? p}
            {p !== "none" && !keys[p] && <span className={cx("ml-1.5 text-[12px] font-medium", value.provider === p ? "text-white/70" : "text-faint")}>no key</span>}
          </button>
        ))}
      </div>
      {value.provider !== "none" && (
        <div className="mt-4">
          {value.provider === "huggingface" ? (
            <HfModelPicker task={task} value={value.model} onChange={(m) => (onChange({ ...value, model: m }), setTest(null))} />
          ) : (
            <label className="block text-[15px] font-semibold">
              Model
              <Input className="mt-1.5 font-normal" value={value.model} onChange={(e) => (onChange({ ...value, model: e.target.value }), setTest(null))} />
            </label>
          )}
          {missingKey && (
            <p className="mt-2 text-sm text-alarm">
              Set <code>{KEY[value.provider]}</code> on the server to use {LABEL[value.provider]}. Until then this job uses the development fallback.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={runTest} busy={test === "running"} disabled={missingKey || !value.model}>
              Test this model
            </Button>
            {test && test !== "running" && (
              <p className={cx("text-sm", test.ok ? "text-spruce" : "text-alarm")} role="status">
                {test.ok ? `Works (${(test.latencyMs / 1000).toFixed(1)}s): ${test.sample}` : test.error}
              </p>
            )}
          </div>
        </div>
      )}
      {value.provider === "none" && <p className="mt-3 text-sm text-muted">Off: Lofn uses its clearly labelled development fallback for this job.</p>}
    </section>
  );
}

function HfModelPicker({ task, value, onChange }: { task: Task; value: string; onChange: (m: string) => void }) {
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error, isLoading } = useSWR<{ models: Model[] }>(`/api/admin/ai/models?task=${task}&q=${encodeURIComponent(debounced)}`, fetcher, { revalidateOnFocus: false });
  return (
    <div>
      <label className="block text-[15px] font-semibold" htmlFor={`m-${task}`}>
        Model
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Input id={`m-${task}`} value={value} onChange={(e) => onChange(e.target.value.trim())} className="max-w-md font-mono text-[14px]" placeholder="org/model" />
        {value && (
          <a href={`https://huggingface.co/${value}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-spruce hover:underline">
            Model card
          </a>
        )}
      </div>
      <p className="mt-1 text-[13px] text-muted">
        Append <code>:provider</code> (e.g. <code>:together</code>) to pin an inference provider{task === "transcription" ? "; transcription runs on HF Inference" : ", otherwise Hugging Face picks one"}.
      </p>
      <div className="mt-3 rounded-[var(--radius-md)] border border-line">
        <div className="border-b border-line p-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={task === "transcription" ? "Search speech models, e.g. whisper" : "Search models, e.g. qwen, llama, gemma"} className="h-9" aria-label="Search Hugging Face models" />
        </div>
        <ul className="max-h-72 overflow-y-auto" aria-label="Hugging Face models">
          {isLoading && <li className="p-3"><Spinner className="size-4 text-spruce" /></li>}
          {error && <li className="p-3 text-sm text-alarm">{(error as Error).message}</li>}
          {data?.models.length === 0 && <li className="p-3 text-sm text-muted">No matching models are served by Inference Providers.</li>}
          {data?.models.filter((m) => showAll || m.recommended || !!debounced).map((m) => (
            <li key={m.id}>
              <button
                onClick={() => onChange(m.id)}
                className={cx("flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-paper", m.id === value && "bg-spruce-wash")}
                aria-current={m.id === value}
              >
                <span className="font-mono text-[13.5px] font-semibold">{m.id}</span>
                {m.vision && task === "synthesis" && <Pill tone="weave">vision</Pill>}
                {m.structured && task !== "transcription" && <Pill tone="spruce">JSON output</Pill>}
                <span className="ml-auto text-[12.5px] text-muted">
                  {m.providers.length} provider{m.providers.length === 1 ? "" : "s"}, {m.likes.toLocaleString()} likes
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!debounced && data && data.models.some((m) => !m.recommended) && (
          <button className="w-full border-t border-line px-3 py-2 text-left text-sm font-semibold text-spruce hover:bg-paper" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show recommended only" : `Show all ${data.models.length} models`}
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[12.5px] text-muted">Recommended: served by several providers or with structured JSON output, which Lofn’s synthesis relies on.</p>
    </div>
  );
}
