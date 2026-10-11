"use client";
import { useState } from "react";
import { Button, Field, Input, Textarea } from "@/components/ui";

export type ProjectInput = { name: string; description: string; defaultCycleMinutes: number; mediaRetentionDays: number | null; synthesisGuidance: string };

export function ProjectForm({ initial, submitLabel, onSubmit }: { initial?: Partial<ProjectInput>; submitLabel: string; onSubmit: (v: ProjectInput) => Promise<void> }) {
  const [v, setV] = useState<ProjectInput>({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    defaultCycleMinutes: initial?.defaultCycleMinutes ?? 15,
    mediaRetentionDays: initial?.mediaRetentionDays ?? null,
    synthesisGuidance: initial?.synthesisGuidance ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="max-w-2xl space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit(v);
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        } catch (err: any) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Project name" htmlFor="pname">
        <Input id="pname" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required maxLength={200} placeholder="e.g. Neighbourhood mobility workshop" />
      </Field>
      <Field label="Description" htmlFor="pdesc" hint="Shown to participants and given to the AI as context.">
        <Textarea id="pdesc" rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} maxLength={5000} />
      </Field>
      <Field label="Guidance for the AI synthesis" htmlFor="pguide" hint="Optional. For example: “Write for municipal planners; keep concrete locations.”">
        <Textarea id="pguide" rows={2} value={v.synthesisGuidance} onChange={(e) => setV({ ...v, synthesisGuidance: e.target.value })} maxLength={3000} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Default cycle length (minutes)" htmlFor="pmin">
          <Input id="pmin" type="number" min={1} max={1440} value={v.defaultCycleMinutes} onChange={(e) => setV({ ...v, defaultCycleMinutes: Number(e.target.value) || 1 })} />
        </Field>
        <Field label="Delete uploaded media after" htmlFor="pret" hint="Days after a cycle ends. Leave empty to keep media. Transcripts and descriptions are kept.">
          <Input
            id="pret"
            type="number"
            min={0}
            max={3650}
            placeholder="Keep"
            value={v.mediaRetentionDays ?? ""}
            onChange={(e) => setV({ ...v, mediaRetentionDays: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </Field>
      </div>
      {error && (
        <p role="alert" className="font-medium text-alarm">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" busy={busy}>
          {submitLabel}
        </Button>
        {saved && (
          <span role="status" className="text-sm font-semibold text-spruce">
            Saved
          </span>
        )}
      </div>
    </form>
  );
}
