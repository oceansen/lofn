"use client";
import { use, useEffect, useState } from "react";
import useSWR from "swr";
import { api, fetcher } from "@/lib/client/api";
import { Button, Field, Input, Modal, Notice, Pill, Spinner, Textarea } from "@/components/ui";
import { ConsentDocumentView } from "@/components/participant/Consent";
import { buildConsent, type ConsentDocument, type ConsentSettings } from "@/lib/consent-text";

type Rec = {
  id: string; alias: string; group: string | null; signedName: string; signedAt: string; withdrawnAt: string | null; erased: number | null; version: number; superseded: boolean;
  choices: { recordings: boolean; health: boolean; hipaa: boolean };
};
type Data = { settings: ConsentSettings; reviewed: boolean; document: ConsentDocument; version: number; records: Rec[] };

export default function ConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const key = `/api/admin/projects/${id}/consent`;
  const { data, mutate } = useSWR<Data>(key, fetcher);
  const [s, setS] = useState<ConsentSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (data && !s) setS(data.settings);
  }, [data, s]);
  if (!data || !s) return <Spinner className="size-6 text-spruce" />;

  const dirty = JSON.stringify(s) !== JSON.stringify(data.settings);
  const set = <K extends keyof ConsentSettings>(k: K, v: ConsentSettings[K]) => setS({ ...s, [k]: v });
  // Preview with the server's AI and retention context, re-rendered from the edited settings.
  const ctx = {
    projectName: data.document.title.replace(/^Consent to take part in “|”$/g, ""),
    mediaRetentionDays: null as number | null,
    ai: { synthesis: null, vision: null, transcription: null },
  };
  const previewDoc = dirty ? { ...buildConsent(s, ctx), sections: mergeContext(buildConsent(s, ctx).sections, data.document.sections) } : data.document;
  const active = data.records.filter((r) => !r.withdrawnAt).length;
  const withdrawn = data.records.filter((r) => r.withdrawnAt && !r.superseded).length;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api(key, { method: "PUT", body: s });
      setS(r.settings);
      await mutate(r, false);
      setMsg({ ok: true, text: r.version !== data!.version ? `Saved as version ${r.version}. Participants will be asked to sign it again before contributing.` : "Saved. The wording didn’t change." });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <section>
        <h2 className="font-display text-xl font-semibold">Consent form</h2>
        <p className="mt-1 max-w-[62ch] text-[15px] text-muted">
          Every participant reads and signs this form after entering their group code, before they can contribute. It covers what GDPR requires you to tell
          them; turn on health information to add explicit consent and a HIPAA authorization. Current version: {data.version}.
        </p>
        {!data.reviewed && (
          <Notice tone="tide" className="mt-4">
            Participants currently see the default wording, with you as data controller. Check each field, ideally with your organisation’s data protection officer, and save.
          </Notice>
        )}
        <div className="mt-5 space-y-4">
          <Field label="Data controller" htmlFor="c1" hint="The organisation (or person) responsible, e.g. SINTEF AS.">
            <Input id="c1" value={s.controllerName} onChange={(e) => set("controllerName", e.target.value)} />
          </Field>
          <Field label="Contact for questions and data requests" htmlFor="c2">
            <Input id="c2" value={s.controllerContact} onChange={(e) => set("controllerContact", e.target.value)} />
          </Field>
          <Field label="Data protection officer" htmlFor="c3" hint="Optional. Name and email, if your organisation has one.">
            <Input id="c3" value={s.dpoContact} onChange={(e) => set("dpoContact", e.target.value)} />
          </Field>
          <Field label="Purpose" htmlFor="c4" hint="Why you collect the input and what the results will be used for. Be specific.">
            <Textarea id="c4" rows={4} value={s.purpose} onChange={(e) => set("purpose", e.target.value)} />
          </Field>
          <Field label="Where data is stored" htmlFor="c5">
            <Input id="c5" value={s.hosting} onChange={(e) => set("hosting", e.target.value)} />
          </Field>
          <Field label="Transfers outside the EU/EEA" htmlFor="c6" hint="Check where your AI provider processes data, and which safeguard applies.">
            <Textarea id="c6" rows={3} value={s.transfers} onChange={(e) => set("transfers", e.target.value)} />
          </Field>
          <Field label="How long contributions are kept" htmlFor="c7" hint="Media retention is added automatically from the project settings.">
            <Input id="c7" value={s.retention} onChange={(e) => set("retention", e.target.value)} />
          </Field>
          <Field label="Supervisory authority for complaints" htmlFor="c8">
            <Input id="c8" value={s.authority} onChange={(e) => set("authority", e.target.value)} />
          </Field>
          <Field label="Minimum age" htmlFor="c9" hint="The age of digital consent: 13 to 16 depending on the country. Younger participants need parental consent outside Lofn.">
            <Input id="c9" type="number" min={13} max={21} value={s.minAge} onChange={(e) => set("minAge", Number(e.target.value) || 16)} className="w-28" />
          </Field>
          <div className="rounded-[var(--radius-md)] border border-line bg-surface p-4">
            <label className="flex items-start gap-3 text-[15px]">
              <input type="checkbox" checked={s.healthData} onChange={(e) => set("healthData", e.target.checked)} className="mt-1 size-4 accent-[var(--color-spruce)]" />
              <span>
                <strong>This project may collect health information.</strong> Adds explicit consent for special-category data (GDPR Art. 9) and a HIPAA
                authorization with revocation, non-conditioning and redisclosure statements.
              </span>
            </label>
            {s.healthData && (
              <div className="mt-3 space-y-3">
                <Field label="HIPAA authorization expires" htmlFor="c10" hint="A date or event, e.g. “31 December 2027” or “at the end of the study”.">
                  <Input id="c10" value={s.hipaaExpiry} onChange={(e) => set("hipaaExpiry", e.target.value)} />
                </Field>
                <Notice tone="alarm" className="text-[14px]">
                  A signed authorization is only one part of HIPAA. If you are a covered entity or business associate, you also need a Business Associate
                  Agreement with every service that handles the data, including your hosting and AI providers, and Lofn can’t check that for you.
                </Notice>
              </div>
            )}
          </div>
          <Field label="Further information" htmlFor="c11" hint="Optional: ethics approval reference, funding, how results are published…">
            <Textarea id="c11" rows={3} value={s.extra} onChange={(e) => set("extra", e.target.value)} />
          </Field>
        </div>
        <div className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-3 border-t border-line bg-paper/95 py-4 backdrop-blur">
          <Button variant="primary" onClick={save} busy={busy} disabled={!dirty && data.reviewed}>
            {data.reviewed ? "Save consent form" : "Confirm and save"}
          </Button>
          <Button variant="ghost" onClick={() => setPreview(true)}>
            Preview as participant
          </Button>
          {dirty && <Button variant="ghost" onClick={() => setS(data.settings)}>Discard changes</Button>}
          {msg && <p className={msg.ok ? "text-sm font-medium text-spruce" : "text-sm font-medium text-alarm"} role="status">{msg.text}</p>}
        </div>
      </section>

      <section className="lg:self-start">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-display text-xl font-semibold">Signed consents</h2>
          <span className="text-[14px] text-muted">
            {active} active{withdrawn ? `, ${withdrawn} withdrawn` : ""}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-sm font-semibold">
          <a className="text-spruce hover:underline" href={`/api/admin/projects/${id}/consent/export`}>Download register (CSV)</a>
          <a className="text-spruce hover:underline" href={`/api/admin/projects/${id}/consent/export?what=versions`}>Download all form versions</a>
        </div>
        {data.records.length === 0 ? (
          <p className="mt-4 text-[15px] text-muted">No one has signed yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-surface">
            {data.records.map((r) => (
              <li key={r.id} className="px-4 py-3 text-[14.5px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.signedName}</span>
                  <span className="text-muted">{r.alias}{r.group ? `, ${r.group}` : ""}</span>
                  <span className="ml-auto text-[13px] text-muted">{new Date(r.signedAt).toLocaleString()}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Pill>v{r.version}</Pill>
                  {r.choices.recordings ? <Pill tone="spruce">recordings</Pill> : <Pill>text only</Pill>}
                  {r.choices.health && <Pill tone="weave">health data</Pill>}
                  {r.choices.hipaa && <Pill tone="weave">HIPAA</Pill>}
                  {r.withdrawnAt && (r.superseded ? <Pill>superseded</Pill> : <Pill tone="alarm">withdrawn, {r.erased ?? 0} erased</Pill>)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal open={preview} onClose={() => setPreview(false)} title={previewDoc.title} wide>
        <p className="mb-4 text-muted">{previewDoc.intro}</p>
        <ConsentDocumentView doc={previewDoc} />
        <ul className="mt-5 space-y-2 text-[15px]">
          {previewDoc.checks.map((c) => (
            <li key={c.id}>☐ {c.label} {c.required ? "*" : "(optional)"}</li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">{previewDoc.signature}</p>
      </Modal>
    </div>
  );
}

/** Keep the server-rendered AI and retention wording in the preview while the edited fields change. */
function mergeContext(edited: ConsentDocument["sections"], server: ConsentDocument["sections"]) {
  return edited.map((sec) => {
    const srv = server.find((x) => x.heading === sec.heading);
    if (!srv) return sec;
    if (sec.heading === "How it is processed") return srv;
    if (sec.heading === "How long it is kept") return { ...sec, paragraphs: [sec.paragraphs[0], srv.paragraphs[1] ?? sec.paragraphs[1]] };
    return sec;
  });
}
