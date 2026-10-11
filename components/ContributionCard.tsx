"use client";
import { useState, type ReactNode } from "react";
import { KIND_LABEL, KindIcon, Pill, Spinner, cx } from "./ui";

export type ContributionView = {
  id: string;
  ref: number;
  kind: string;
  text: string;
  status: string;
  error: string | null;
  hidden: boolean;
  createdAt: string;
  questionId: string;
  groupId: string;
  cycleId: string;
  author: { alias: string | null; name: string | null; mine?: boolean };
  media: { id: string; category: string; mime: string; size: number; deleted: boolean }[];
  derivations: { type: string; content: string; isFallback: boolean; provider: string; model: string }[];
};

function Derived({ label, content, fallback }: { label: string; content: string; fallback: boolean }) {
  const [open, setOpen] = useState(false);
  const long = content.length > 220;
  return (
    <div className={cx("mt-2 rounded-[var(--radius-sm)] border-l-[3px] px-3 py-2 text-[15px]", fallback ? "border-line-strong bg-ink/[0.03] text-muted" : "border-weave bg-weave-wash/60")}>
      <p className={cx("text-[13px] font-semibold", fallback ? "text-muted" : "text-weave-deep")}>{label}</p>
      <p className={cx("whitespace-pre-wrap", !open && long && "line-clamp-3")}>{content}</p>
      {long && (
        <button className="mt-1 text-[13px] font-semibold text-weave-deep underline-offset-2 hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}

export function ContributionCard({
  c,
  actions,
  flash,
  compact,
}: {
  c: ContributionView;
  actions?: ReactNode;
  flash?: boolean;
  compact?: boolean;
}) {
  const time = new Date(c.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const who = c.author.mine ? "You" : c.author.name || c.author.alias || "Participant";
  const transcript = c.derivations.find((d) => d.type === "transcript");
  const description = c.derivations.find((d) => d.type === "description");
  const images = c.media.filter((m) => m.category === "image");
  return (
    <article
      id={`contrib-${c.ref}`}
      className={cx(
        "scroll-mt-28 rounded-[var(--radius-md)] border bg-surface px-4 py-3",
        c.hidden ? "border-dashed border-line-strong opacity-60" : "border-line",
        flash && "flash",
      )}
      aria-label={`Contribution C${c.ref}`}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span className="font-display text-[15px] font-bold text-ink tabular">C{c.ref}</span>
        <span className="inline-flex items-center gap-1">
          <KindIcon kind={c.kind} />
          {KIND_LABEL[c.kind]}
        </span>
        <span aria-hidden="true">/</span>
        <span className={cx(c.author.mine && "font-semibold text-spruce")}>{who}</span>
        <time dateTime={c.createdAt} className="tabular">
          {time}
        </time>
        <span className="ml-auto flex items-center gap-1.5">
          {(c.status === "pending" || c.status === "processing") && (
            <Pill tone="weave">
              <Spinner className="size-3" /> {c.kind === "audio" || c.kind === "video" ? "Transcribing" : "Interpreting"}
            </Pill>
          )}
          {c.status === "failed" && <Pill tone="alarm">Couldn’t process media</Pill>}
          {c.hidden && <Pill>Hidden from synthesis</Pill>}
          {actions}
        </span>
      </header>

      {c.text && <p className={cx("mt-1.5 whitespace-pre-wrap", compact && "line-clamp-4")}>{c.text}</p>}

      {images.length > 0 && (
        <div className={cx("mt-2 grid gap-2", images.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
          {images.map((m) =>
            m.deleted ? (
              <MediaGone key={m.id} />
            ) : (
              <a key={m.id} href={`/api/media/${m.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-[var(--radius-sm)] border border-line bg-paper">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/media/${m.id}`} alt={description?.content ? `Image: ${description.content.slice(0, 140)}` : "Contributed image"} className="max-h-72 w-full object-contain" loading="lazy" />
              </a>
            ),
          )}
        </div>
      )}
      {c.media
        .filter((m) => m.category === "audio")
        .map((m) => (m.deleted ? <MediaGone key={m.id} /> : <audio key={m.id} controls preload="none" src={`/api/media/${m.id}`} className="mt-2 w-full" />))}
      {c.media
        .filter((m) => m.category === "video")
        .map((m) =>
          m.deleted ? (
            <MediaGone key={m.id} />
          ) : (
            <video key={m.id} controls preload="metadata" playsInline src={`/api/media/${m.id}`} className="mt-2 max-h-80 w-full rounded-[var(--radius-sm)] bg-ink" />
          ),
        )}

      {transcript && <Derived label="Transcript (AI)" content={transcript.content} fallback={transcript.isFallback} />}
      {description && <Derived label={c.kind === "video" ? "What the video shows (AI)" : "What the image shows (AI)"} content={description.content} fallback={description.isFallback} />}
      {c.status === "failed" && c.error && <p className="mt-2 text-sm text-alarm">{c.error}</p>}
    </article>
  );
}

function MediaGone() {
  return <p className="mt-2 rounded-[var(--radius-sm)] bg-ink/5 px-3 py-2 text-sm text-muted">Media file removed under the project’s retention policy.</p>;
}
