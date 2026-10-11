import { EventEmitter } from "node:events";
import pg from "pg";
import { config } from "./config";
import { EVENT_CHANNEL, type LofnEvent } from "./events";

// One LISTEN connection per server process, fanned out to SSE streams in memory.
type Bus = { emitter: EventEmitter; client: pg.Client | null; connecting: boolean };
const g = globalThis as unknown as { __lofnBus?: Bus };

function bus(): Bus {
  if (!g.__lofnBus) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    g.__lofnBus = { emitter, client: null, connecting: false };
  }
  return g.__lofnBus;
}

async function connect() {
  const b = bus();
  if (b.client || b.connecting) return;
  b.connecting = true;
  const client = new pg.Client({
    connectionString: config.databaseUrl,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" } : undefined,
  });
  const retry = () => {
    b.client = null;
    b.connecting = false;
    client.removeAllListeners();
    client.end().catch(() => {});
    // Tell streams to resync: they may have missed events.
    b.emitter.emit("resync");
    setTimeout(() => connect().catch(() => {}), 2000);
  };
  try {
    await client.connect();
    client.on("notification", (msg) => {
      if (msg.channel !== EVENT_CHANNEL || !msg.payload) return;
      try {
        b.emitter.emit("event", JSON.parse(msg.payload) as LofnEvent);
      } catch {}
    });
    client.on("error", retry);
    client.on("end", retry);
    await client.query(`LISTEN ${EVENT_CHANNEL}`);
    b.client = client;
    b.connecting = false;
  } catch (e) {
    console.warn("[event-bus] connect failed, retrying", (e as Error).message);
    retry();
  }
}

export function subscribe(fn: (ev: LofnEvent | { t: "resync" }) => void): () => void {
  const b = bus();
  void connect();
  const onEv = (ev: LofnEvent) => fn(ev);
  const onResync = () => fn({ t: "resync" });
  b.emitter.on("event", onEv);
  b.emitter.on("resync", onResync);
  return () => {
    b.emitter.off("event", onEv);
    b.emitter.off("resync", onResync);
  };
}

/** Build an SSE response that forwards events passing `filter`. */
export function sseResponse(req: Request, filter: (ev: LofnEvent) => boolean, onTick?: () => Promise<void>) {
  const encoder = new TextEncoder();
  let unsub: () => void = () => {};
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        unsub();
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {}
      };
      controller.enqueue(encoder.encode(`retry: 3000\n\n`));
      send("hello", { now: Date.now() });
      unsub = subscribe((ev) => {
        if (ev.t === "resync") return send("resync", { now: Date.now() });
        if (filter(ev)) send("change", ev);
      });
      // Heartbeat also carries server time so clients keep clocks aligned.
      timer = setInterval(() => {
        send("time", { now: Date.now() });
        onTick?.().catch(() => {});
      }, 15000);
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      unsub();
      if (timer) clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
