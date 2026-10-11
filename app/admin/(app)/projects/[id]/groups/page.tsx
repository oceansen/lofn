"use client";
import { use, useEffect, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import QRCode from "qrcode";
import { api, fetcher, HttpError } from "@/lib/client/api";
import { Button, Empty, Field, Input, Modal, Pill, Spinner, Textarea, cx } from "@/components/ui";

type G = { id: string; name: string; accessCode: string; codeActive: boolean; questionIds: string[]; participantCount: number; activeCount: number };
type Q = { id: string; title: string };

function useQr(text: string) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    QRCode.toString(text, { type: "svg", margin: 1, color: { dark: "#15201e", light: "#ffffff" } }).then(setSvg).catch(() => setSvg(""));
  }, [text]);
  return svg;
}

function Qr({ text, className }: { text: string; className?: string }) {
  const svg = useQr(text);
  // QR SVG is generated locally from our own URL, not user HTML.
  return <div className={className} role="img" aria-label="QR code for the join link" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export default function GroupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const key = `/api/admin/projects/${id}/groups`;
  const { data, mutate } = useSWR<{ groups: G[]; questions: Q[] }>(key, fetcher);
  const [names, setNames] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<G | null>(null);
  const [print, setPrint] = useState(false);
  const [confirm, setConfirm] = useState<null | { title: string; body: string; action: () => Promise<void>; label: string }>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const groups = data?.groups ?? [];
  const questions = data?.questions ?? [];
  const link = (g: G) => `${origin}/?code=${g.accessCode}`;

  async function create(list: string[]) {
    setBusy(true);
    setError(null);
    try {
      await api(key, { body: { names: list } });
      setNames("");
      mutate();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function patch(g: G, body: any) {
    await api(`/api/admin/groups/${g.id}`, { method: "PATCH", body });
    mutate();
  }
  async function del(g: G, force = false) {
    try {
      await api(`/api/admin/groups/${g.id}${force ? "?force=true" : ""}`, { method: "DELETE" });
      setConfirm(null);
      mutate();
    } catch (e) {
      if (e instanceof HttpError && e.status === 409)
        setConfirm({ title: `Delete ${g.name}?`, body: e.message, label: "Delete permanently", action: () => del(g, true) });
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <section>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h2 className="font-display text-xl font-semibold">Groups and access codes</h2>
            <p className="text-[15px] text-muted">Each group joins with its own code and gets its own evolving answers.</p>
          </div>
          {groups.length > 0 && <Button onClick={() => setPrint(true)}>Print codes</Button>}
        </div>
        {!data ? (
          <Spinner className="size-6 text-spruce" />
        ) : groups.length === 0 ? (
          <Empty title="No groups yet">Create one group per table, team or breakout room.</Empty>
        ) : (
          <ul className="space-y-3">
            {groups.map((g) => (
              <li key={g.id} className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <GroupName g={g} onSave={(name) => patch(g, { name })} />
                  <span className="text-[13.5px] text-muted">
                    {g.participantCount} joined{g.activeCount ? `, ${g.activeCount} active now` : ""}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => navigator.clipboard?.writeText(g.accessCode)}
                      className={cx("rounded-[var(--radius-sm)] border-2 px-3 py-1 font-display text-xl font-bold tracking-[0.12em] tabular", g.codeActive ? "border-ink" : "border-line text-faint line-through")}
                      title="Copy code"
                      aria-label={`Copy access code ${g.accessCode}`}
                    >
                      {g.accessCode}
                    </button>
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Button size="sm" onClick={() => navigator.clipboard?.writeText(link(g))}>
                    Copy join link
                  </Button>
                  <Button size="sm" onClick={() => setQr(g)}>
                    Show QR
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => patch(g, { codeActive: !g.codeActive })}>
                    {g.codeActive ? "Turn code off" : "Turn code on"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setConfirm({
                        title: "Make a new code?",
                        body: `The old code stops working and everyone currently in ${g.name} is signed out. Their contributions are kept.`,
                        label: "Make new code",
                        action: async () => {
                          await patch(g, { regenerateCode: true });
                          setConfirm(null);
                        },
                      })
                    }
                  >
                    New code
                  </Button>
                  <Button size="sm" variant="danger" className="ml-auto" onClick={() => del(g)}>
                    Delete
                  </Button>
                </div>
                {questions.length > 0 && (
                  <fieldset className="mt-3 border-t border-line pt-3">
                    <legend className="sr-only">Questions for {g.name}</legend>
                    <p className="mb-1.5 text-[13.5px] font-semibold text-muted">Answers these questions</p>
                    <div className="flex flex-wrap gap-1.5">
                      {questions.map((q, i) => {
                        const on = g.questionIds.includes(q.id);
                        return (
                          <label key={q.id} className={cx("flex max-w-xs cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-[13.5px]", on ? "border-spruce bg-spruce-wash" : "border-line text-muted")}>
                            <input
                              type="checkbox"
                              checked={on}
                              className="size-3.5 accent-[var(--color-spruce)]"
                              onChange={() => patch(g, { questionIds: on ? g.questionIds.filter((x) => x !== q.id) : [...g.questionIds, q.id] })}
                            />
                            <span className="font-semibold tabular">{i + 1}</span>
                            <span className="truncate">{q.title}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                )}
              </li>
            ))}
          </ul>
        )}
        {groups.length > 0 && (
          <p className="mt-4 text-[15px]">
            Next:{" "}
            <Link href={`/admin/projects/${id}/cycles`} className="font-semibold text-spruce underline-offset-2 hover:underline">
              set up a feedback cycle
            </Link>
          </p>
        )}
      </section>

      <section className="space-y-5 lg:self-start">
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
          <h2 className="font-display text-lg font-semibold">Add groups</h2>
          <form
            className="mt-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const list = names.split("\n").map((s) => s.trim()).filter(Boolean);
              if (list.length) create(list);
            }}
          >
            <Field label="Group names" htmlFor="gn" hint="One per line. New groups get every question unless you change it.">
              <Textarea id="gn" rows={4} value={names} onChange={(e) => setNames(e.target.value)} placeholder={"Table 1\nTable 2\nYouth council"} />
            </Field>
            {error && <p className="text-sm text-alarm">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" busy={busy}>
                Create groups
              </Button>
              <QuickCreate existing={groups.length} onCreate={create} busy={busy} />
            </div>
          </form>
        </div>
        {questions.length === 0 && data && (
          <p className="text-[14.5px] text-muted">
            Tip: <Link className="font-semibold text-spruce" href={`/admin/projects/${id}/questions`}>add questions</Link> first so new groups get them automatically.
          </p>
        )}
      </section>

      <Modal open={!!qr} onClose={() => setQr(null)} title={qr ? `Join ${qr.name}` : ""}>
        {qr && (
          <div className="text-center">
            <Qr text={link(qr)} className="mx-auto w-64 [&_svg]:h-auto [&_svg]:w-full" />
            <p className="mt-3 font-display text-3xl font-bold tracking-[0.14em] tabular">{qr.accessCode}</p>
            <p className="mt-1 text-sm break-all text-muted">{link(qr)}</p>
          </div>
        )}
      </Modal>
      <Modal open={print} onClose={() => setPrint(false)} title="Access codes" wide>
        <div className="print-area grid gap-4 sm:grid-cols-2">
          {groups.map((g) => (
            <div key={g.id} className="break-inside-avoid rounded-[var(--radius-md)] border border-line p-4 text-center">
              <p className="font-display text-lg font-semibold">{g.name}</p>
              <Qr text={link(g)} className="mx-auto my-2 w-40 [&_svg]:h-auto [&_svg]:w-full" />
              <p className="font-display text-2xl font-bold tracking-[0.14em] tabular">{g.accessCode}</p>
              <p className="text-[12px] text-muted">{origin}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </Modal>
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.title ?? ""}>
        <p>{confirm?.body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => confirm?.action()}>
            {confirm?.label}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function QuickCreate({ existing, onCreate, busy }: { existing: number; onCreate: (n: string[]) => void; busy: boolean }) {
  const [n, setN] = useState(4);
  return (
    <span className="flex items-center gap-2">
      <span className="text-sm text-muted">or</span>
      <Input type="number" min={1} max={50} value={n} onChange={(e) => setN(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} className="h-10 w-16" aria-label="Number of groups" />
      <Button type="button" disabled={busy} onClick={() => onCreate(Array.from({ length: n }, (_, i) => `Group ${existing + i + 1}`))}>
        Create numbered
      </Button>
    </span>
  );
}

function GroupName({ g, onSave }: { g: G; onSave: (n: string) => void }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(g.name);
  if (!edit)
    return (
      <button className="font-display text-[19px] font-semibold hover:underline" onClick={() => (setV(g.name), setEdit(true))} title="Rename">
        {g.name}
        {!g.codeActive && <Pill className="ml-2 align-middle">Code off</Pill>}
      </button>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSave(v.trim());
        setEdit(false);
      }}
      className="flex gap-2"
    >
      <Input value={v} onChange={(e) => setV(e.target.value)} autoFocus className="h-9 w-48" aria-label="Group name" />
      <Button size="sm" type="submit" variant="primary">
        Save
      </Button>
    </form>
  );
}
