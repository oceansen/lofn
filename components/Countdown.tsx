"use client";
import { useEffect, useRef, useState } from "react";
import { formatDuration, useNow } from "@/lib/client/api";
import { cx } from "./ui";

export type CycleLike = {
  id: string;
  name: string;
  status: "draft" | "running" | "paused" | "ended";
  durationMs: number;
  endsAt: string | null;
  remainingMs: number;
  nextSynthesisAt?: string | null;
  finalStatus?: string;
};

export function useRemaining(cycle: CycleLike | null | undefined) {
  const now = useNow(250);
  if (!cycle) return { remaining: 0, now, fraction: 0 };
  const remaining = cycle.status === "running" && cycle.endsAt ? Math.max(0, new Date(cycle.endsAt).getTime() - now) : cycle.remainingMs;
  const fraction = cycle.durationMs > 0 ? Math.min(1, Math.max(0, remaining / cycle.durationMs)) : 0;
  return { remaining, now, fraction };
}

function tone(cycle: CycleLike, remaining: number) {
  if (cycle.status !== "running") return "calm";
  if (remaining <= 30_000) return "alarm";
  if (remaining <= 120_000) return "tide";
  return "calm";
}

export function Countdown({ cycle, size = "lg", className }: { cycle: CycleLike | null; size?: "lg" | "md" | "sm"; className?: string }) {
  const { remaining } = useRemaining(cycle);
  const [announce, setAnnounce] = useState("");
  const lastMinute = useRef<number | null>(null);

  useEffect(() => {
    if (!cycle || cycle.status !== "running") return;
    const mins = Math.ceil(remaining / 60000);
    if (lastMinute.current !== mins && (mins <= 5 || mins % 5 === 0)) {
      lastMinute.current = mins;
      setAnnounce(remaining > 0 ? `${mins} minute${mins === 1 ? "" : "s"} left` : "Time is up");
    }
  }, [remaining, cycle]);

  if (!cycle) return null;
  const t = tone(cycle, remaining);
  const label =
    cycle.status === "running" ? "left" : cycle.status === "paused" ? "paused" : cycle.status === "draft" ? "not started" : "ended";
  const sizes = { lg: "text-[44px] sm:text-[56px]", md: "text-[32px]", sm: "text-[22px]" };
  return (
    <div className={cx("flex items-baseline gap-2", className)} role="timer" aria-label={`${cycle.name}: ${formatDuration(remaining)} ${label}`}>
      <span
        className={cx(
          "font-display font-bold leading-none tabular tracking-tight",
          sizes[size],
          t === "alarm" ? "text-alarm" : t === "tide" ? "text-tide" : cycle.status === "running" ? "text-ink" : "text-faint",
        )}
        style={{ fontVariationSettings: '"wdth" 85' }}
      >
        {cycle.status === "ended" ? "00:00" : formatDuration(remaining)}
      </span>
      <span className={cx("font-semibold", size === "lg" ? "text-[15px]" : "text-sm", cycle.status === "paused" ? "text-tide" : "text-muted")}>{label}</span>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}

/** Full-width draining line: the most glanceable form of the remaining time. */
export function TideBar({ cycle }: { cycle: CycleLike | null }) {
  const { remaining, fraction } = useRemaining(cycle);
  if (!cycle) return null;
  const t = tone(cycle, remaining);
  const color = t === "alarm" ? "var(--color-alarm)" : t === "tide" ? "var(--color-tide)" : cycle.status === "paused" ? "var(--color-line-strong)" : "var(--color-spruce)";
  return (
    <div className="h-1.5 w-full bg-line" aria-hidden="true">
      <div className="tide-bar h-full" style={{ width: `${(cycle.status === "ended" ? 0 : cycle.status === "draft" ? 1 : fraction) * 100}%`, background: color }} />
    </div>
  );
}

export function NextUpdate({ cycle }: { cycle: CycleLike | null }) {
  const now = useNow(1000);
  if (!cycle?.nextSynthesisAt || cycle.status !== "running") return null;
  const s = Math.max(0, Math.round((new Date(cycle.nextSynthesisAt).getTime() - now) / 1000));
  return <span className="tabular">{s > 0 ? `next AI pass in ${s}s` : "AI pass running"}</span>;
}
