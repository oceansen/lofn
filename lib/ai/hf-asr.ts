// Speech recognition through Hugging Face Inference Providers. A model id may pin a provider with ":provider"
// (e.g. "openai/whisper-large-v3:together"); otherwise the first supported live provider is used.
// Request shapes follow @huggingface/inference: hf-inference takes base64 JSON, Together and DeepInfra take
// OpenAI-style multipart uploads, fal-ai takes a data URL (MP3 or WAV only).
import { config } from "../config";

export const HF_ASR_PROVIDERS = ["hf-inference", "deepinfra", "together", "fal-ai"] as const;
export type HfAsrProvider = (typeof HF_ASR_PROVIDERS)[number];

type Mapping = Record<string, { providerId: string; status?: string; task?: string }>;
const cache = new Map<string, { at: number; map: Mapping | null }>();

async function mappingFor(model: string): Promise<Mapping | null> {
  const hit = cache.get(model);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.map;
  let map: Mapping | null = null;
  try {
    const res = await fetch(`${config.ai.hfHubUrl}/api/models/${model}?expand[]=inferenceProviderMapping`, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const raw = (await res.json()).inferenceProviderMapping;
      map = Array.isArray(raw) ? Object.fromEntries(raw.map((p: any) => [p.provider, p])) : raw || {};
    }
  } catch {
    map = null; // Hub unreachable: fall back to the model id as given.
  }
  cache.set(model, { at: Date.now(), map });
  return map;
}

export async function resolveHfAsr(model: string): Promise<{ provider: HfAsrProvider; providerId: string }> {
  const [id, pin] = model.split(":");
  const map = await mappingFor(id);
  const usable = (p: string) => {
    const m = map?.[p];
    return !!m && (m.status ?? "live") === "live" && (!m.task || m.task === "automatic-speech-recognition");
  };
  if (pin) {
    if (!(HF_ASR_PROVIDERS as readonly string[]).includes(pin)) throw new Error(`Lofn can't call speech recognition on "${pin}". Use one of: ${HF_ASR_PROVIDERS.join(", ")}.`);
    if (map && !usable(pin)) throw new Error(`${pin} doesn't serve ${id} for speech recognition right now.`);
    return { provider: pin as HfAsrProvider, providerId: map?.[pin]?.providerId || id };
  }
  if (!map) return { provider: "hf-inference", providerId: id };
  const p = HF_ASR_PROVIDERS.find(usable);
  if (!p) throw new Error(`No supported Hugging Face provider serves ${id} for speech recognition right now.`);
  return { provider: p, providerId: map[p].providerId || id };
}

/** Audio format a provider needs; fal-ai only accepts MP3 or WAV data URLs. */
export function asrFormatFor(provider: HfAsrProvider): "wav" | "flac" {
  return provider === "fal-ai" ? "wav" : "flac";
}

const ext = (mime: string) => {
  const m = mime.split(";")[0].toLowerCase();
  return m.includes("flac") ? "flac" : m.includes("wav") ? "wav" : m.includes("mpeg") || m.includes("mp3") ? "mp3" : m.includes("ogg") ? "ogg" : m.includes("mp4") || m.includes("m4a") ? "m4a" : "webm";
};

/** The audio/* content type HF Inference accepts for a file of this mime type. */
export function audioContentType(mime: string) {
  const m = mime.split(";")[0].trim().toLowerCase();
  if (/wav|wave/.test(m)) return "audio/wav";
  if (/flac/.test(m)) return "audio/flac";
  if (/mpeg|mp3/.test(m)) return "audio/mpeg";
  if (/ogg|opus/.test(m)) return "audio/ogg";
  if (/webm|matroska/.test(m)) return "audio/webm";
  if (/mp4|m4a|aac|quicktime|3gpp/.test(m)) return "audio/m4a";
  return m.startsWith("audio/") ? m : "audio/flac";
}

export class AsrHttpError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
  }
}

export async function hfTranscribe(key: string, model: string, audio: Buffer, mime: string, signal?: AbortSignal) {
  const route = await resolveHfAsr(model);
  const auth = { authorization: `Bearer ${key}` };
  let res: Response;
  if (route.provider === "hf-inference") {
    // HF Inference takes the raw audio bytes with an audio/* content type (as @huggingface/inference sends it).
    // A base64 string in a JSON body is now treated as a file name or URL, and browser recordings labelled
    // video/webm are rejected, so container types are mapped to their audio equivalents.
    res = await fetch(`${config.ai.hfRouterUrl}/hf-inference/models/${route.providerId}`, {
      method: "POST",
      headers: { ...auth, "content-type": audioContentType(mime) },
      body: new Uint8Array(audio),
      signal,
    });
  } else if (route.provider === "fal-ai") {
    const base = mime.split(";")[0].toLowerCase();
    const falMime = /wav|wave/.test(base) ? "audio/x-wav" : /mpeg|mp3/.test(base) ? "audio/mpeg" : /webm/.test(base) ? "video/webm" : null;
    if (!falMime) throw new AsrHttpError(`fal-ai needs MP3, WAV or WebM audio, not ${base}.`, false);
    res = await fetch(`${config.ai.hfRouterUrl}/fal-ai/${route.providerId}`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ audio_url: `data:${falMime};base64,${audio.toString("base64")}` }),
      signal,
    });
  } else {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `audio.${ext(mime)}`);
    form.append("model", route.providerId);
    const path = route.provider === "deepinfra" ? "deepinfra/v1/openai/audio/transcriptions" : "together/v1/audio/transcriptions";
    res = await fetch(`${config.ai.hfRouterUrl}/${path}`, { method: "POST", headers: auth, body: form, signal });
  }
  const text = await res.text();
  if (!res.ok) throw new AsrHttpError(`Transcription failed on ${route.provider} (${res.status}): ${text.slice(0, 300)}`, res.status === 429 || res.status >= 500);
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new AsrHttpError(`${route.provider} returned an unexpected response.`, false);
  }
  const out = typeof j.text === "string" ? j.text : typeof j.output === "string" ? j.output : Array.isArray(j) && typeof j[0]?.text === "string" ? j[0].text : null;
  if (out === null) throw new AsrHttpError(`${route.provider} returned no transcript.`, false);
  return { text: out.trim(), provider: route.provider };
}
