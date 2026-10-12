"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { ProjectForm } from "@/components/admin/ProjectForm";
import { Button } from "@/components/ui";

export default function NewProject() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function importFile(f: File) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/projects/import", { method: "POST", headers: { "content-type": f.type || "application/octet-stream" }, body: f });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Import failed (${res.status}).`);
      router.push(data.restored ? `/admin/projects/${data.id}` : `/admin/projects/${data.id}/groups`);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-[34px] font-bold">New project</h1>
      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section>
          <h2 className="font-display text-lg font-semibold">Start from scratch</h2>
          <p className="mb-5 text-muted">Next you’ll add questions, create groups and set up a timed cycle.</p>
          <ProjectForm
            submitLabel="Create project"
            onSubmit={async (v) => {
              const r = await api("/api/admin/projects", { body: v });
              router.push(`/admin/projects/${r.project.id}/questions`);
            }}
          />
        </section>
        <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-5 lg:self-start">
          <h2 className="font-display text-lg font-semibold">Import a project</h2>
          <p className="mt-1 text-[15px] text-muted">
            <strong>Project archive (.zip)</strong>: restores a whole project exported from Lofn, with every round, contribution, recording, answer and
            version, and the consent register, as a new project of yours. Groups get fresh access codes.
          </p>
          <p className="mt-2 text-[15px] text-muted">
            <strong>Project file (.json)</strong>: sets up the structure in one step: questions with their reference images, groups and cycles.
          </p>
          <input
            ref={input}
            type="file"
            accept="application/json,.json,application/zip,.zip"
            className="hidden"
            onChange={(e) => (e.target.files?.[0] && importFile(e.target.files[0]), (e.target.value = ""))}
          />
          <Button className="mt-4" variant="primary" busy={busy} onClick={() => input.current?.click()}>
            {busy ? "Importing…" : "Choose archive or project file"}
          </Button>
          {error && (
            <p role="alert" className="mt-3 text-sm font-medium text-alarm">
              {error}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
