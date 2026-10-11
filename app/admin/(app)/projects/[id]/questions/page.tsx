"use client";
import { use, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { api, fetcher, HttpError } from "@/lib/client/api";
import { Button, Empty, Field, Modal, Spinner, Textarea } from "@/components/ui";

type Q = { id: string; title: string; instructions: string; position: number };

export default function QuestionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const key = `/api/admin/projects/${id}/questions`;
  const { data, mutate } = useSWR<{ questions: Q[] }>(key, fetcher);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [assignAll, setAssignAll] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Q | null>(null);
  const [confirm, setConfirm] = useState<{ q: Q; message: string } | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const qs = data?.questions ?? [];

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(key, { body: { title, instructions, assignToAllGroups: assignAll } });
      setTitle("");
      setInstructions("");
      mutate();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function move(i: number, dir: -1 | 1) {
    const order = qs.map((q) => q.id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    mutate({ questions: order.map((oid) => qs.find((q) => q.id === oid)!) }, false);
    await api(key, { method: "PUT", body: { order } });
    mutate();
  }
  async function remove(q: Q, force = false) {
    try {
      await api(`/api/admin/questions/${q.id}${force ? "?force=true" : ""}`, { method: "DELETE" });
      setConfirm(null);
      mutate();
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) setConfirm({ q, message: e.message });
      else setListError((e as Error).message);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <section>
        <h2 className="font-display text-xl font-semibold">Questions</h2>
        <p className="mb-4 text-[15px] text-muted">Groups answer these together. The order here is the order participants see.</p>
        {!data ? (
          <Spinner className="size-6 text-spruce" />
        ) : qs.length === 0 ? (
          <Empty title="Add your first question">Write it the way you’d ask a room of people. Add instructions if they need context.</Empty>
        ) : (
          <ol className="space-y-2">
            {qs.map((q, i) => (
              <li key={q.id} className="flex gap-3 rounded-[var(--radius-md)] border border-line bg-surface px-4 py-3">
                <span className="font-display text-xl font-bold text-faint tabular">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{q.title}</p>
                  {q.instructions && <p className="mt-0.5 text-[14.5px] whitespace-pre-wrap text-muted">{q.instructions}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-start">
                  <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move question ${i + 1} up`}>
                    Up
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === qs.length - 1} aria-label={`Move question ${i + 1} down`}>
                    Down
                  </Button>
                  <Button size="sm" onClick={() => setEditing(q)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => remove(q)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
        {listError && <p className="mt-3 text-sm font-medium text-alarm">{listError}</p>}
        {qs.length > 0 && (
          <p className="mt-4 text-[15px]">
            Next:{" "}
            <Link href={`/admin/projects/${id}/groups`} className="font-semibold text-spruce underline-offset-2 hover:underline">
              create groups and access codes
            </Link>
          </p>
        )}
      </section>

      <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-5 lg:self-start">
        <h2 className="font-display text-lg font-semibold">Add a question</h2>
        <form onSubmit={add} className="mt-3 space-y-4">
          <Field label="Question" htmlFor="qt">
            <Textarea id="qt" rows={2} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What should our neighbourhood change first to make walking safer?" required />
          </Field>
          <Field label="Instructions" htmlFor="qi" hint="Optional. Shown under the question.">
            <Textarea id="qi" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Think about routes you use every day. Photos of specific spots help." />
          </Field>
          <label className="flex items-center gap-2 text-[15px]">
            <input type="checkbox" checked={assignAll} onChange={(e) => setAssignAll(e.target.checked)} className="size-4 accent-[var(--color-spruce)]" />
            Assign to all existing groups
          </label>
          {error && <p className="text-sm font-medium text-alarm">{error}</p>}
          <Button type="submit" variant="primary" busy={busy}>
            Add question
          </Button>
        </form>
      </section>

      <EditModal q={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), mutate())} />
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Delete this question?">
        <p>{confirm?.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setConfirm(null)}>Keep it</Button>
          <Button variant="danger" onClick={() => confirm && remove(confirm.q, true)}>
            Delete permanently
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function EditModal({ q, onClose, onSaved }: { q: Q | null; onClose: () => void; onSaved: () => void }) {
  return (
    <Modal open={!!q} onClose={onClose} title="Edit question">
      {q && <EditForm key={q.id} q={q} onSaved={onSaved} />}
    </Modal>
  );
}

function EditForm({ q, onSaved }: { q: Q; onSaved: () => void }) {
  const [title, setTitle] = useState(q.title);
  const [instructions, setInstructions] = useState(q.instructions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api(`/api/admin/questions/${q.id}`, { method: "PATCH", body: { title, instructions } });
          onSaved();
        } catch (err: any) {
          setError(err.message);
          setBusy(false);
        }
      }}
    >
      <Field label="Question" htmlFor="eqt">
        <Textarea id="eqt" rows={2} value={title} onChange={(e) => setTitle(e.target.value)} required />
      </Field>
      <Field label="Instructions" htmlFor="eqi">
        <Textarea id="eqi" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </Field>
      {error && <p className="text-sm text-alarm">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" busy={busy}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

