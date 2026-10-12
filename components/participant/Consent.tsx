"use client";
import { useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { api, fetcher } from "@/lib/client/api";
import { Button, Input, LofnMark, Modal, Notice, Spinner, cx } from "@/components/ui";
import type { ConsentDocument } from "@/lib/consent-text";

type Choices = { core: boolean; age: boolean; recordings: boolean; health: boolean; hipaa: boolean };
type ConsentData = {
  project: { name: string };
  group: { name: string };
  me: { alias: string; name: string };
  form: { versionId: string; version: number; document: ConsentDocument };
  signed: null | { choices: Choices; signedName: string; signedAt: string; version: number; text: string; isCurrent: boolean };
};

export function ConsentDocumentView({ doc }: { doc: ConsentDocument }) {
  return (
    <div className="space-y-5 text-[15.5px] leading-relaxed">
      {doc.sections.map((s) => (
        <section key={s.heading}>
          <h3 className="font-display text-[17px] font-semibold">{s.heading}</h3>
          {s.paragraphs.map((p, i) => (
            <p key={i} className="mt-1.5 text-ink/90">
              {p}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}

/** Full-page consent step shown after joining, and again whenever the form changes. */
export function ConsentGate({ onSigned }: { onSigned: () => void }) {
  const router = useRouter();
  const { data, mutate } = useSWR<ConsentData>("/api/p/consent", fetcher);
  const [choices, setChoices] = useState<Choices>({ core: false, age: false, recordings: false, health: false, hipaa: false });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"sign" | "decline" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!data) return <div className="flex min-h-dvh items-center justify-center"><Spinner className="size-7 text-spruce" /></div>;
  const doc = data.form.document;
  const ready = doc.checks.every((c) => !c.required || choices[c.id]) && name.trim().length >= 2;
  const changed = data.signed && !data.signed.isCurrent;

  async function sign(e: React.FormEvent) {
    e.preventDefault();
    setBusy("sign");
    setErr(null);
    try {
      await api("/api/p/consent", { body: { versionId: data!.form.versionId, signedName: name.trim(), choices } });
      onSigned();
    } catch (e: any) {
      setErr(e.message);
      if (e.code === "consent_changed") mutate();
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <div className="flex items-center gap-3">
        <LofnMark className="size-8" />
        <p className="text-[15px] text-muted">
          {data.project.name} · {data.group.name}
        </p>
      </div>
      <h1 className="mt-5 font-display text-[30px] leading-tight font-bold sm:text-[36px]">{doc.title}</h1>
      <p className="mt-2 text-[17px] text-muted">{doc.intro}</p>
      {changed && (
        <Notice tone="tide" className="mt-5">
          The consent form changed since you signed version {data.signed!.version}. Please read it again; your earlier contributions stay as they are.
        </Notice>
      )}
      <div className="mt-6 rounded-[var(--radius-lg)] border border-line bg-surface p-5 sm:p-6">
        <ConsentDocumentView doc={doc} />
      </div>

      <form onSubmit={sign} className="mt-6 space-y-4">
        <fieldset className="space-y-3">
          <legend className="sr-only">Declarations</legend>
          {doc.checks.map((c) => (
            <label key={c.id} className={cx("flex gap-3 rounded-[var(--radius-md)] border p-3.5 text-[15.5px]", choices[c.id] ? "border-spruce/40 bg-spruce-wash" : "border-line bg-surface")}>
              <input
                type="checkbox"
                checked={choices[c.id]}
                onChange={(e) => setChoices({ ...choices, [c.id]: e.target.checked })}
                className="mt-1 size-[18px] shrink-0 accent-[var(--color-spruce)]"
              />
              <span>
                {c.label} {c.required ? <span className="text-alarm" aria-label="required">*</span> : <span className="text-muted">(optional)</span>}
              </span>
            </label>
          ))}
        </fieldset>
        <div>
          <label htmlFor="sig" className="block text-[15px] font-semibold">
            Signature
          </label>
          <p className="text-sm text-muted">{doc.signature}</p>
          <Input id="sig" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} className="mt-1.5 max-w-md font-display text-[19px]" placeholder="Your full name" />
          <p className="mt-1 text-[13px] text-muted">Dated {new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.</p>
        </div>
        {err && <p role="alert" className="text-[15px] font-medium text-alarm">{err}</p>}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button type="submit" variant="primary" size="lg" busy={busy === "sign"} disabled={!ready}>
            Sign and continue
          </Button>
          <Button
            type="button"
            variant="ghost"
            busy={busy === "decline"}
            onClick={async () => {
              setBusy("decline");
              await api("/api/p/consent", { method: "DELETE" }).catch(() => {});
              router.replace("/");
            }}
          >
            {changed ? "Withdraw and leave" : "I don’t agree"}
          </Button>
        </div>
        <p className="text-[13px] text-muted">
          {changed
            ? "Withdrawing deletes your contributions and removes them from the group answers."
            : "If you don’t agree, you leave the group and nothing you entered is kept."}
        </p>
      </form>
    </main>
  );
}

/** "Consent & your data": view what you signed, change optional choices, download your data, withdraw. */
export function YourDataModal({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const router = useRouter();
  const { data, mutate } = useSWR<ConsentData>(open ? "/api/p/consent" : null, fetcher);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const s = data?.signed;
  async function toggleRecordings() {
    if (!data || !s) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/api/p/consent", { body: { versionId: data.form.versionId, signedName: s.signedName, choices: { ...s.choices, recordings: !s.choices.recordings } } });
      await mutate();
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={() => (setConfirm(false), onClose())} title="Consent and your data" wide>
      {!data || !s ? (
        <Spinner className="size-6 text-spruce" />
      ) : confirm ? (
        <div>
          <p className="text-[16px]">
            Withdrawing deletes everything you sent in this project: text, recordings, photos, videos, transcripts and descriptions. The group answers are rewritten
            without them, and you leave the group. This can’t be undone.
          </p>
          {err && <p className="mt-2 text-sm text-alarm">{err}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setConfirm(false)}>Keep my consent</Button>
            <Button
              variant="danger"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/api/p/consent", { method: "DELETE" });
                  router.replace("/?withdrawn=1");
                } catch (e: any) {
                  setErr(e.message);
                  setBusy(false);
                }
              }}
            >
              Withdraw and delete my data
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-[15.5px]">
            Signed by <strong>{s.signedName}</strong> on {new Date(s.signedAt).toLocaleString()} (form version {s.version}).
          </p>
          <ul className="space-y-1 text-[15px]">
            <li>Contributions processed as described: yes</li>
            <li>Recordings, photos and videos: {s.choices.recordings ? "yes" : "no, text only"}</li>
            {data.form.document.checks.some((c) => c.id === "health") && <li>Health information: {s.choices.health ? "yes" : "no"}; HIPAA authorization: {s.choices.hipaa ? "given" : "not given"}</li>}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={toggleRecordings} busy={busy}>
              {s.choices.recordings ? "Stop allowing recordings" : "Allow recordings, photos and videos"}
            </Button>
            <a href="/api/p/my-data" className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-line-strong bg-surface px-3 text-sm font-semibold hover:border-ink">
              Download my data
            </a>
            <a
              href={`data:text/plain;charset=utf-8,${encodeURIComponent(`${s.text}\n\nSigned: ${s.signedName}, ${new Date(s.signedAt).toISOString()}`)}`}
              download="lofn-consent.txt"
              className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-line-strong bg-surface px-3 text-sm font-semibold hover:border-ink"
            >
              Download signed form
            </a>
            <Button size="sm" variant="danger" onClick={() => setConfirm(true)}>
              Withdraw consent
            </Button>
          </div>
          {err && <p className="text-sm text-alarm">{err}</p>}
          <details className="rounded-[var(--radius-md)] border border-line p-4">
            <summary className="cursor-pointer font-semibold">Read the form you signed</summary>
            <pre className="mt-3 font-sans text-[14.5px] whitespace-pre-wrap">{s.text}</pre>
          </details>
        </div>
      )}
    </Modal>
  );
}
