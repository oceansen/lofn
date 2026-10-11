"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { mutate as globalMutate } from "swr";

// ---------- server clock ----------
// The countdown is derived from server-authoritative endsAt plus this offset.
let offset = 0;
let best = Infinity;
const listeners = new Set<() => void>();
export function syncClock(serverNow: number, t0: number, t1: number) {
  const rtt = t1 - t0;
  // Prefer samples with the smallest round trip; allow drift correction over time.
  if (rtt <= best * 1.5 || rtt < 400) {
    best = Math.min(best, rtt);
    offset = serverNow - (t0 + t1) / 2;
    listeners.forEach((l) => l());
  }
}
export const serverNow = () => Date.now() + offset;

export function useNow(intervalMs = 250) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    const l = () => setNow(serverNow());
    listeners.add(l);
    return () => {
      clearInterval(id);
      listeners.delete(l);
    };
  }, [intervalMs]);
  return now;
}

// ---------- fetch ----------
export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method || (opts.body !== undefined ? "POST" : "GET"),
      headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      signal: opts.signal,
      cache: "no-store",
    });
  } catch {
    throw new HttpError(0, "Can't reach Lofn. Check your connection and try again.");
  }
  const t1 = Date.now();
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) throw new HttpError(res.status, (data as any)?.error || `Request failed (${res.status}).`, (data as any)?.code);
  if (data && typeof data === "object" && typeof (data as any).serverNow === "number") syncClock((data as any).serverNow, t0, t1);
  return data as T;
}

export const fetcher = (url: string) => api(url);

/** Upload a file as a raw body with progress. Retries network failures twice. */
export function uploadFile(
  url: string,
  file: Blob,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<any> {
  const attempt = () =>
    new Promise<any>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let data: any = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new HttpError(xhr.status, data.error || `Upload failed (${xhr.status}).`));
      };
      xhr.onerror = () => reject(new HttpError(0, "The upload was interrupted. Check your connection."));
      signal?.addEventListener("abort", () => xhr.abort());
      xhr.onabort = () => reject(new HttpError(0, "Upload cancelled."));
      xhr.send(file);
    });
  return (async () => {
    let last: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        return await attempt();
      } catch (e) {
        last = e;
        if (!(e instanceof HttpError) || e.status !== 0 || signal?.aborted) throw e;
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
    throw last;
  })();
}

// ---------- live events ----------
export type LiveEvent = { t: string; projectId: string; groupId?: string; cycleId?: string; questionId?: string; id?: string };

/**
 * Subscribe to an SSE stream; on every change (debounced) revalidate SWR keys matching `match`.
 * Returns connection state for a subtle "live" indicator.
 */
export function useLive(url: string | null, match: (key: string) => boolean, onEvent?: (ev: LiveEvent) => void) {
  const [state, setState] = useState<"connecting" | "live" | "offline">("connecting");
  const matchRef = useRef(match);
  const onEventRef = useRef(onEvent);
  matchRef.current = match;
  onEventRef.current = onEvent;
  useEffect(() => {
    if (!url) return;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => globalMutate((k) => typeof k === "string" && matchRef.current(k)), 200);
    };
    const open = () => {
      es = new EventSource(url);
      es.addEventListener("hello", (e) => {
        setState("live");
        const t = Date.now();
        try {
          syncClock(JSON.parse((e as MessageEvent).data).now, t - 50, t);
        } catch {}
        refresh(); // resync after (re)connect
      });
      es.addEventListener("time", () => setState("live"));
      es.addEventListener("resync", refresh);
      es.addEventListener("change", (e) => {
        try {
          onEventRef.current?.(JSON.parse((e as MessageEvent).data));
        } catch {}
        refresh();
      });
      es.onerror = () => {
        setState("offline");
        if (es?.readyState === EventSource.CLOSED && !closed) setTimeout(open, 3000);
      };
    };
    open();
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      closed = true;
      es?.close();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [url]);
  return state;
}

export function useHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function timeAgo(iso: string | null | undefined, now: number) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatDuration(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
