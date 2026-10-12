"use client";
import { use, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { api, fetcher } from "@/lib/client/api";
import { ProjectForm } from "@/components/admin/ProjectForm";
import { Button, Input, Modal, Spinner } from "@/components/ui";

export default function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, mutate } = useSWR<{ project: any }>(`/api/admin/projects/${id}`, fetcher);
  const { data: media, mutate: mutateMedia } = useSWR<{ stored: number; bytes: number; deleted: number }>(`/api/admin/projects/${id}/media`, fetcher);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return <Spinner className="size-6 text-spruce" />;
  const p = data.project;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <section>
        <h2 className="mb-4 font-display text-xl font-semibold">Project settings</h2>
        <ProjectForm
          key={p.updatedAt}
          initial={p}
          submitLabel="Save changes"
          onSubmit={async (v) => {
            await api(`/api/admin/projects/${id}`, { method: "PATCH", body: v });
            mutate();
            router.refresh();
          }}
        />
      </section>
      <section className="space-y-5">
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
          <h3 className="font-display text-lg font-semibold">Uploaded media</h3>
          <p className="mt-1 text-[15px] text-muted">
            {media ? (
              <>
                {media.stored} file{media.stored === 1 ? "" : "s"} stored ({(Number(media.bytes) / 1048576).toFixed(1)} MB)
                {media.deleted ? `, ${media.deleted} already deleted` : ""}.{" "}
                {p.mediaRetentionDays === null ? "Kept until you delete them." : `Deleted ${p.mediaRetentionDays} days after each cycle ends.`}
              </>
            ) : (
              "Loading…"
            )}
          </p>
          <Button className="mt-3" variant="danger" size="sm" onClick={() => setConfirmPurge(true)} disabled={!media?.stored}>
            Delete all media now
          </Button>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
          <h3 className="font-display text-lg font-semibold">Export all project data</h3>
          <p className="mt-1 text-[15px] text-muted">
            One .zip with everything: questions, groups, rounds, every contribution with its photos, recordings and videos, transcripts, all answer
            versions, syntheses and the consent register. Import it under New project to restore or move the project.
          </p>
          <a
            href={`/api/admin/projects/${id}/archive`}
            className="mt-3 inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-line-strong bg-surface px-3 text-sm font-semibold hover:border-ink"
          >
            Download project archive
          </a>
          <p className="mt-2 text-[13.5px] text-muted">It contains participants’ personal data. Keep it as safe as the project itself.</p>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
          <h3 className="font-display text-lg font-semibold">Project</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              busy={busy === "dup"}
              onClick={() =>
                run("dup", async () => {
                  const r = await api(`/api/admin/projects/${id}/duplicate`, { body: {} });
                  router.push(`/admin/projects/${r.project.id}/settings`);
                })
              }
            >
              Duplicate structure
            </Button>
            <Button
              size="sm"
              busy={busy === "arch"}
              onClick={() =>
                run("arch", async () => {
                  await api(`/api/admin/projects/${id}`, { method: "PATCH", body: { status: p.status === "archived" ? "active" : "archived" } });
                  mutate();
                  router.refresh();
                })
              }
            >
              {p.status === "archived" ? "Restore from archive" : "Archive"}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete project
            </Button>
          </div>
          <p className="mt-2 text-[13.5px] text-muted">Duplicating copies questions, groups (with new codes) and cycle settings, without contributions. Archiving closes access for participants.</p>
          {error && <p className="mt-2 text-sm text-alarm">{error}</p>}
        </div>
      </section>

      <Modal open={confirmPurge} onClose={() => setConfirmPurge(false)} title="Delete all uploaded media?">
        <p>Every photo, recording and video in this project is removed from storage. Transcripts and AI descriptions stay, so answers are unaffected.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setConfirmPurge(false)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() =>
              run("purge", async () => {
                await api(`/api/admin/projects/${id}/media`, { method: "DELETE" });
                setConfirmPurge(false);
                setTimeout(() => mutateMedia(), 1500);
              })
            }
          >
            Delete media
          </Button>
        </div>
      </Modal>
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this project permanently?">
        <p>All questions, groups, contributions, media and answers are removed. This can’t be undone.</p>
        <label className="mt-4 block text-[15px]">
          Type the project name to confirm
          <Input className="mt-1.5" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={p.name} />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button
            variant="danger"
            disabled={typed.trim() !== p.name.trim()}
            busy={busy === "del"}
            onClick={() =>
              run("del", async () => {
                await api(`/api/admin/projects/${id}`, { method: "DELETE" });
                router.replace("/admin");
                router.refresh();
              })
            }
          >
            Delete project
          </Button>
        </div>
      </Modal>
    </div>
  );
}
