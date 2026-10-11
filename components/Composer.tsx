"use client";
import { useEffect, useRef, useState } from "react";
import { api, formatDuration, uploadFile, HttpError } from "@/lib/client/api";
import { Button, KindIcon, Modal, Textarea, cx } from "./ui";

type Category = "image" | "audio" | "video";
type Attachment = { key: string; category: Category; blob: Blob; name: string; url: string; progress: number; mediaId?: string; error?: string };

export type Limits = { imageMb: number; audioMb: number; videoMb: number; textChars: number; imagesPerContribution: number };

const AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const VIDEO_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
const MAX_AUDIO_SECONDS = 600;
const MAX_VIDEO_SECONDS = 180;

function pickType(list: string[]) {
  if (typeof MediaRecorder === "undefined") return "";
  return list.find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
}

/** Downscale large photos in the browser: faster uploads on mobile, and HEIC becomes JPEG where the browser can decode it. */
async function prepareImage(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file;
  const needs = file.size > 2.5 * 1024 * 1024 || !/^image\/(jpeg|png|webp)$/.test(file.type);
  if (!needs) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.86));
    return blob ?? file;
  } catch {
    return file;
  }
}

export function Composer({ questionId, enabled, disabledReason, limits, onSent }: { questionId: string; enabled: boolean; disabledReason?: string; limits: Limits; onSent?: () => void }) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentFlash, setSentFlash] = useState(false);
  const [recording, setRecording] = useState<null | "audio" | "video">(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const draftKey = `lofn-draft-${questionId}`;

  // Keep unsent text across reloads.
  useEffect(() => {
    try {
      const d = localStorage.getItem(draftKey);
      if (d) setText(d);
    } catch {}
  }, [draftKey]);
  useEffect(() => {
    try {
      text ? localStorage.setItem(draftKey, text) : localStorage.removeItem(draftKey);
    } catch {}
  }, [text, draftKey]);
  useEffect(() => () => items.forEach((i) => URL.revokeObjectURL(i.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const category = items[0]?.category;
  const maxMb = { image: limits.imageMb, audio: limits.audioMb, video: limits.videoMb };

  function add(category: Category, blob: Blob, name: string) {
    setError(null);
    if (blob.size > maxMb[category] * 1024 * 1024) {
      setError(`That ${category} is larger than ${maxMb[category]} MB. Try a shorter or smaller one.`);
      return;
    }
    setItems((prev) => {
      if (prev.length && prev[0].category !== category) {
        prev.forEach((p) => URL.revokeObjectURL(p.url));
        prev = [];
      }
      if (category !== "image") {
        prev.forEach((p) => URL.revokeObjectURL(p.url));
        prev = [];
      }
      if (category === "image" && prev.length >= limits.imagesPerContribution) {
        setError(`You can attach up to ${limits.imagesPerContribution} images at once.`);
        return prev;
      }
      return [...prev, { key: crypto.randomUUID(), category, blob, name, url: URL.createObjectURL(blob), progress: 0 }];
    });
  }

  async function onImages(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) add("image", await prepareImage(f), f.name);
  }

  function remove(key: string) {
    setItems((prev) => {
      const it = prev.find((p) => p.key === key);
      if (it) URL.revokeObjectURL(it.url);
      return prev.filter((p) => p.key !== key);
    });
  }

  async function send() {
    if (busy) return;
    if (!text.trim() && !items.length) {
      setError("Write something or add a photo, recording or video first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ids: string[] = [];
      for (const it of items) {
        if (it.mediaId) {
          ids.push(it.mediaId);
          continue;
        }
        const type = it.blob.type.split(";")[0];
        const blob = type !== it.blob.type ? new Blob([it.blob], { type }) : it.blob;
        const res = await uploadFile(`/api/p/media?category=${it.category}&name=${encodeURIComponent(it.name)}`, blob, (p) =>
          setItems((prev) => prev.map((x) => (x.key === it.key ? { ...x, progress: p, error: undefined } : x))),
        ).catch((e) => {
          setItems((prev) => prev.map((x) => (x.key === it.key ? { ...x, error: e.message } : x)));
          throw e;
        });
        ids.push(res.media.id);
        // Remember the upload so "try again" doesn't re-send bytes.
        setItems((prev) => prev.map((x) => (x.key === it.key ? { ...x, mediaId: res.media.id, progress: 1 } : x)));
      }
      await api("/api/p/contributions", { body: { questionId, text, mediaIds: ids } });
      items.forEach((i) => URL.revokeObjectURL(i.url));
      setItems([]);
      setText("");
      setSentFlash(true);
      setTimeout(() => setSentFlash(false), 2200);
      onSent?.();
    } catch (e) {
      setError(e instanceof HttpError ? e.message : "Couldn’t send. Your contribution is still here — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return <div className="rounded-[var(--radius-lg)] border border-dashed border-line-strong bg-surface/60 px-4 py-5 text-center text-[15px] text-muted">{disabledReason}</div>;
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-line-strong bg-surface p-3 shadow-[0_1px_0_rgb(21_32_30/0.04)] focus-within:border-spruce">
      <label htmlFor={`composer-${questionId}`} className="sr-only">
        Your contribution
      </label>
      <Textarea
        id={`composer-${questionId}`}
        autoGrow
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, limits.textChars))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }}
        placeholder={category === "image" ? "Say what the image shows or why it matters (optional)" : "Share an idea, example, concern or suggestion…"}
        className="border-0 px-1 py-1 text-[17px] focus:ring-0"
      />

      {items.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attachments">
          {items.map((it) => (
            <li key={it.key} className="relative overflow-hidden rounded-[var(--radius-md)] border border-line bg-paper">
              {it.category === "image" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.url} alt="" className="h-24 w-24 object-cover" />
              )}
              {it.category === "audio" && <audio src={it.url} controls className="h-12 w-64 max-w-full" />}
              {it.category === "video" && <video src={it.url} controls playsInline className="h-36 max-w-[18rem] bg-ink" />}
              {busy && !it.mediaId && (
                <div className="absolute inset-x-0 bottom-0 h-1.5 bg-ink/10">
                  <div className="h-full bg-spruce transition-[width]" style={{ width: `${Math.round(it.progress * 100)}%` }} />
                </div>
              )}
              {it.error && <p className="bg-alarm-wash px-2 py-1 text-[12px] text-alarm">{it.error}</p>}
              {!busy && (
                <button
                  onClick={() => remove(it.key)}
                  className="absolute top-1 right-1 rounded-full bg-ink/75 p-1 text-white hover:bg-ink"
                  aria-label={`Remove ${it.category}`}
                >
                  <svg viewBox="0 0 20 20" className="size-3.5" aria-hidden="true">
                    <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-2 text-[14.5px] font-medium text-alarm" role="alert">
          {error}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
        <input ref={imageInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => (onImages(e.target.files), (e.target.value = ""))} />
        <input ref={videoInput} type="file" accept="video/*" className="hidden" onChange={(e) => (e.target.files?.[0] && add("video", e.target.files[0], e.target.files[0].name), (e.target.value = ""))} />
        <input ref={audioInput} type="file" accept="audio/*" className="hidden" onChange={(e) => (e.target.files?.[0] && add("audio", e.target.files[0], e.target.files[0].name), (e.target.value = ""))} />
        <ToolButton label="Photo" kind="image" onClick={() => imageInput.current?.click()} disabled={busy} />
        <ToolButton label="Voice" kind="audio" onClick={() => setRecording("audio")} disabled={busy} />
        <ToolButton label="Video" kind="video" onClick={() => setRecording("video")} disabled={busy} />
        <span className="ml-auto flex items-center gap-2">
          {sentFlash && (
            <span className="text-sm font-semibold text-spruce" role="status">
              Sent
            </span>
          )}
          <Button variant="primary" onClick={send} busy={busy} className="min-w-24">
            {busy ? "Sending" : "Send"}
          </Button>
        </span>
      </div>

      <Recorder
        mode={recording}
        onClose={() => setRecording(null)}
        onDone={(cat, blob, name) => {
          add(cat, blob, name);
          setRecording(null);
        }}
        onPickFile={(cat) => {
          setRecording(null);
          (cat === "audio" ? audioInput : videoInput).current?.click();
        }}
      />
    </div>
  );
}

function ToolButton({ label, kind, onClick, disabled }: { label: string; kind: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] px-3 text-[15px] font-semibold text-spruce hover:bg-spruce-wash disabled:opacity-50"
    >
      <KindIcon kind={kind} className="size-5" />
      {label}
    </button>
  );
}

function Recorder({
  mode,
  onClose,
  onDone,
  onPickFile,
}: {
  mode: null | "audio" | "video";
  onClose: () => void;
  onDone: (cat: Category, blob: Blob, name: string) => void;
  onPickFile: (cat: "audio" | "video") => void;
}) {
  const [state, setState] = useState<"idle" | "starting" | "recording" | "error">("idle");
  const [err, setErr] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const preview = useRef<HTMLVideoElement>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const raf = useRef<number | undefined>(undefined);
  const audioCtx = useRef<AudioContext | null>(null);
  const supported = typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

  function cleanup() {
    clearInterval(timer.current);
    if (raf.current) cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    setState("idle");
    setElapsed(0);
    setLevel(0);
  }
  useEffect(() => {
    if (!mode) cleanup();
    return () => cleanup();
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    if (!mode) return;
    setState("starting");
    setErr("");
    try {
      const s = await navigator.mediaDevices.getUserMedia(mode === "audio" ? { audio: true } : { audio: true, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } });
      stream.current = s;
      if (mode === "video" && preview.current) {
        preview.current.srcObject = s;
        preview.current.play().catch(() => {});
      }
      if (mode === "audio") {
        // Live input level so people can see the mic works.
        const ctx = new AudioContext();
        audioCtx.current = ctx;
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(s).connect(an);
        const buf = new Uint8Array(an.fftSize);
        const tick = () => {
          an.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
          setLevel(peak / 128);
          raf.current = requestAnimationFrame(tick);
        };
        tick();
      }
      const type = pickType(mode === "audio" ? AUDIO_TYPES : VIDEO_TYPES);
      const r = new MediaRecorder(s, type ? { mimeType: type, ...(mode === "video" ? { videoBitsPerSecond: 1_500_000 } : { audioBitsPerSecond: 64_000 }) } : undefined);
      rec.current = r;
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        const mime = (r.mimeType || type || (mode === "audio" ? "audio/webm" : "video/webm")).split(";")[0];
        const blob = new Blob(chunks.current, { type: mime });
        const ext = mime.includes("mp4") ? (mode === "audio" ? "m4a" : "mp4") : mime.includes("ogg") ? "ogg" : "webm";
        const m = mode;
        cleanup();
        if (blob.size > 0 && m) onDone(m, blob, `recording.${ext}`);
      };
      r.start(1000);
      setState("recording");
      const t0 = Date.now();
      timer.current = setInterval(() => {
        const sec = (Date.now() - t0) / 1000;
        setElapsed(sec);
        if (sec >= (mode === "audio" ? MAX_AUDIO_SECONDS : MAX_VIDEO_SECONDS)) r.state === "recording" && r.stop();
      }, 250);
    } catch (e: any) {
      cleanup();
      setState("error");
      setErr(
        e?.name === "NotAllowedError"
          ? `Lofn needs permission to use your ${mode === "audio" ? "microphone" : "camera and microphone"}. Allow it in your browser’s site settings, or upload a file instead.`
          : `Couldn’t start recording on this device. Upload a file instead.`,
      );
    }
  }

  function stop() {
    if (rec.current?.state === "recording") rec.current.stop();
  }

  const max = mode === "audio" ? MAX_AUDIO_SECONDS : MAX_VIDEO_SECONDS;
  return (
    <Modal
      open={!!mode}
      onClose={() => {
        if (rec.current?.state === "recording") {
          rec.current.onstop = null;
          rec.current.stop();
        }
        cleanup();
        onClose();
      }}
      title={mode === "audio" ? "Record your voice" : "Record a video"}
    >
      <div className="space-y-4">
        {mode === "video" && (
          <video ref={preview} muted playsInline className={cx("aspect-video w-full rounded-[var(--radius-md)] bg-ink object-cover", state !== "recording" && state !== "starting" && "hidden")} />
        )}
        {mode === "audio" && (
          <div className="flex h-20 items-center justify-center gap-[3px]" aria-hidden="true">
            {Array.from({ length: 28 }).map((_, i) => {
              const h = state === "recording" ? 8 + Math.abs(Math.sin(i * 1.7 + elapsed * 6)) * level * 64 : 6;
              return <span key={i} className="w-1.5 rounded-full bg-spruce transition-[height] duration-100" style={{ height: h }} />;
            })}
          </div>
        )}
        {state === "recording" && (
          <p className="flex items-center justify-center gap-2 font-display text-2xl font-bold tabular" role="status">
            <span className="rec-dot size-3 rounded-full bg-alarm" aria-hidden="true" />
            {formatDuration(elapsed * 1000)}
            <span className="text-sm font-medium text-muted">of {formatDuration(max * 1000)}</span>
          </p>
        )}
        {err && <p className="text-[15px] text-alarm">{err}</p>}
        {!supported && <p className="text-[15px] text-muted">This browser can’t record directly. Choose a file instead — on phones that lets you use the camera or voice recorder app.</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          {supported && state !== "recording" && (
            <Button variant="primary" size="lg" className="flex-1" onClick={start} busy={state === "starting"}>
              Start recording
            </Button>
          )}
          {state === "recording" && (
            <Button variant="danger" size="lg" className="flex-1" onClick={stop}>
              Stop and attach
            </Button>
          )}
          {state !== "recording" && mode && (
            <Button size="lg" className="flex-1" onClick={() => onPickFile(mode)}>
              {mode === "audio" ? "Choose an audio file" : "Choose or capture a video"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
