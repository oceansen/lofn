"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { fetcher, useLive } from "@/lib/client/api";
import { Pill, cx } from "@/components/ui";

const TABS = [
  { href: "", label: "Live" },
  { href: "/questions", label: "Questions" },
  { href: "/groups", label: "Groups" },
  { href: "/cycles", label: "Cycles" },
  { href: "/compare", label: "Compare" },
  { href: "/results", label: "Results" },
  { href: "/settings", label: "Settings" },
];

export function ProjectNav({ id, name, archived }: { id: string; name: string; archived: boolean }) {
  const path = usePathname();
  const base = `/admin/projects/${id}`;
  const { data } = useSWR<{ project: { name: string; status: string } }>(`/api/admin/projects/${id}`, fetcher);
  // One live connection per project page; every admin view revalidates on change.
  const state = useLive(`/api/admin/projects/${id}/events`, (k) => k.startsWith("/api/admin/") && k !== "/api/admin/system");
  return (
    <div className="border-b border-line bg-surface/70">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-3 pt-5">
          <h1 className="font-display text-[26px] leading-tight font-bold">{data?.project.name ?? name}</h1>
          {(data?.project.status ?? (archived ? "archived" : "active")) === "archived" && <Pill>Archived</Pill>}
          <span className="ml-auto flex items-center gap-1.5 text-[13px] text-muted" aria-live="polite">
            <span className={cx("size-2 rounded-full", state === "live" ? "bg-spruce" : state === "connecting" ? "bg-line-strong" : "bg-tide")} />
            {state === "live" ? "Live" : state === "connecting" ? "Connecting" : "Reconnecting"}
          </span>
        </div>
        <nav className="-mx-4 mt-3 flex overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Project sections">
          {TABS.map((t) => {
            const href = base + t.href;
            const active = t.href === "" ? path === base || path.startsWith(`${base}/answers`) : path.startsWith(href);
            return (
              <Link
                key={t.label}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "shrink-0 border-b-[3px] px-3 py-2.5 text-[15px] font-semibold",
                  active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
