"use client";
import { use, useEffect, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { api, fetcher, HttpError } from "@/lib/client/api";
import { Countdown } from "@/components/Countdown";
import { CycleControls, type CycleV } from "@/components/admin/CycleControls";
import { Button, Empty, Field, Input, Modal, Pill, Spinner, Textarea, cx } from "@/components/ui";

const PRESETS = [5, 10, 15, 30, 60, 90];

function statusPill(c: CycleV) {
  if (c.status === "running") return <Pill tone="spruce">Running</Pill>;
  if (c.status === "paused") return <Pill tone="tide">Paused</Pill>;
  if (c.status === "ended") return <Pill tone={c.finalStatus === "done" ? "neutral" : "weave"}>{c.finalStatus === "done" ? "Complete" : "Finalising answers"}</Pill>;
  return <Pill>Not started</Pill>;
}

export default function CyclesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const key = `/api/admin/projects/${id}/cycles`;
  const { data, mutate } = useSWR<{ cycles: CycleV[] }>(key, fetcher);
  const { data: proj } = useSWR<{ project: { defaultCycleMinutes: number } }>(`/api/admin/projects/${id}`, fetcher);
  const [minutes, setMinutes] = useState(15);
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [carry, setCarry] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CycleV | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ c: CycleV; msg: string } | null>(null);
  const cycles = data?.cycles ?? [];

  useEffect(() => {
    if (proj) {
      setMinutes(proj.project.defaultCycleMinutes);
      setCustom(!PRESETS.includes(proj.project.defaultCycleMinutes));
    }
  }, [proj]);
  useEffect(() => setCarry(cycles.some((c) => c.status === "ended")), [cycles.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(key, { body: { name: name || undefined, minutes, note, carryForward: carry } });
      setName("");
      setNote("");
      mutate();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function del(c: CycleV, force = false) {
    try {
      await api(`/api/admin/cycles/${c.id}${force ? "?force=true" : ""}`, { method: "DELETE" });
      setConfirmDel(null);
      mutate();
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) setConfirmDel({ c, msg: e.message });
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <section>
        <h2 className="font-display text-xl font-semibold">Feedback cycles</h2>
        <p className="mb-4 text-[15px] text-muted">A cycle is one timed round. Run several to revisit questions or move through phases; each keeps its own results.</p>
        {!data ? (
          <Spinner className="size-6 text-spruce" />
        ) : cycles.length === 0 ? (
          <Empty title="No cycles yet">Set a duration on the right, then start it when your groups are ready.</Empty>
        ) : (
          <ol className="space-y-3">
            {cycles.map((c, i) => (
              <li key={c.id} className={cx("rounded-[var(--radius-lg)] border bg-surface p-4", c.status === "running" ? "border-spruce" : c.status === "paused" ? "border-tide" : "border-line")}>
                <div className="flex flex-wrap items-start gap-3">
                  <span className="font-display text-xl font-bold text-faint tabular">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-[18px] font-semibold">{c.name}</span>
                      {statusPill(c)}
                      {c.carryForward && <Pill>Builds on previous answers</Pill>}
                    </p>
                    <p className="text-[13.5px] text-muted">
                      {Math.round(c.durationMs / 60000)} minutes
                      {c.startedAt && <>, started {new Date(c.startedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</>}
                    </p>
                    {c.note && <p className="mt-1 text-[14.5px]">{c.note}</p>}
                  </div>
                  {c.status !== "draft" && <Countdown cycle={c} size="sm" />}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <CycleControls cycle={c} onChange={() => mutate()} size="sm" />
                  <span className="ml-auto flex gap-1.5">
                    {(c.status === "running" || c.status === "paused") && (
                      <Link href={`/admin/projects/${id}`} className="inline-flex h-8 items-center rounded-[var(--radius-sm)] px-3 text-sm font-semibold text-spruce hover:bg-spruce-wash">
                        Monitor live
                      </Link>
                    )}
                    {c.status === "ended" && (
                      <Link href={`/admin/projects/${id}/results?cycle=${c.id}`} className="inline-flex h-8 items-center rounded-[var(--radius-sm)] px-3 text-sm font-semibold text-spruce hover:bg-spruce-wash">
                        Results
                      </Link>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                      Edit
                    </Button>
                    {c.status !== "running" && c.status !== "paused" && (
                      <Button size="sm" variant="ghost" className="text-alarm" onClick={() => del(c)}>
                        Delete
                      </Button>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-5 lg:self-start">
        <h2 className="font-display text-lg font-semibold">New cycle</h2>
        <form onSubmit={create} className="mt-3 space-y-4">
          <fieldset>
            <legend className="mb-1.5 text-[15px] font-semibold">Duration</legend>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((m) => (
                <Button key={m} type="button" size="sm" variant={!custom && minutes === m ? "primary" : "secondary"} onClick={() => (setMinutes(m), setCustom(false))} aria-pressed={!custom && minutes === m}>
                  {m} min
                </Button>
              ))}
              <Button type="button" size="sm" variant={custom ? "primary" : "secondary"} onClick={() => setCustom(true)} aria-pressed={custom}>
                Custom
              </Button>
            </div>
            {custom && (
              <label className="mt-2 flex items-center gap-2 text-[15px]">
                <Input type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(Math.max(1, Number(e.target.value) || 1))} className="w-24" aria-label="Minutes" />
                minutes
              </label>
            )}
          </fieldset>
          <Field label="Name" htmlFor="cn" hint={`Defaults to “Round ${cycles.length + 1}”.`}>
            <Input id="cn" value={name} onChange={(e) => setName(e.target.value)} placeholder={`Round ${cycles.length + 1}`} />
          </Field>
          <Field label="Note to participants" htmlFor="cnote" hint="Optional. Shown at the top of the workspace during this cycle.">
            <Textarea id="cnote" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="This round: focus on what we could do in the next six months." />
          </Field>
          <label className="flex items-start gap-2 text-[15px]">
            <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} className="mt-1 size-4 accent-[var(--color-spruce)]" />
            <span>
              Start from the previous cycle’s answers
              <span className="block text-sm text-muted">Groups refine their earlier answers instead of starting over.</span>
            </span>
          </label>
          {error && <p className="text-sm text-alarm">{error}</p>}
          <Button type="submit" variant="primary" busy={busy}>
            Create cycle
          </Button>
        </form>
      </section>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit cycle">
        {editing && <EditCycle c={editing} onDone={() => (setEditing(null), mutate())} />}
      </Modal>
      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Delete this cycle?">
        <p>{confirmDel?.msg}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setConfirmDel(null)}>Keep it</Button>
          <Button variant="danger" onClick={() => confirmDel && del(confirmDel.c, true)}>
            Delete permanently
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function EditCycle({ c, onDone }: { c: CycleV; onDone: () => void }) {
  const [name, setName] = useState(c.name);
  const [note, setNote] = useState(c.note);
  const [minutes, setMinutes] = useState(Math.round(c.durationMs / 60000));
  const [carry, setCarry] = useState(c.carryForward);
  const [error, setError] = useState<string | null>(null);
  const draft = c.status === "draft";
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/api/admin/cycles/${c.id}`, { method: "PATCH", body: draft ? { name, note, minutes, carryForward: carry } : { name, note } });
          onDone();
        } catch (err: any) {
          setError(err.message);
        }
      }}
    >
      <Field label="Name" htmlFor="ecn">
        <Input id="ecn" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Note to participants" htmlFor="ecno">
        <Textarea id="ecno" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {draft ? (
        <>
          <Field label="Duration (minutes)" htmlFor="ecm">
            <Input id="ecm" type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <label className="flex items-center gap-2 text-[15px]">
            <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} className="size-4 accent-[var(--color-spruce)]" />
            Start from the previous cycle’s answers
          </label>
        </>
      ) : (
        <p className="text-sm text-muted">This cycle has started; use the controls to extend it.</p>
      )}
      {error && <p className="text-sm text-alarm">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary">
          Save changes
        </Button>
      </div>
    </form>
  );
}
