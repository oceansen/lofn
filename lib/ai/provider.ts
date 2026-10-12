import { config } from "../config";
import { isLive, keyFor, type UserAi } from "./settings";

export type Part = { type: "text"; text: string } | { type: "image"; mime: string; base64: string };

export type CompleteArgs = { system: string; parts: Part[]; json?: boolean; maxTokens?: number; temperature?: number };

export interface ChatProvider {
  name: "anthropic" | "openai" | "huggingface";
  model: string;
  complete(args: CompleteArgs): Promise<string>;
}

export class AiError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
  }
}

async function postJson(url: string, headers: Record<string, string>, payload: unknown): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(config.ai.timeoutMs),
      });
      const text = await res.text();
      if (res.ok) return JSON.parse(text);
      const retryable = res.status === 429 || res.status >= 500;
      lastErr = new AiError(`AI provider returned ${res.status}: ${text.slice(0, 400)}`, retryable);
      if (!retryable) throw lastErr;
      const ra = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, Number.isFinite(ra) && ra > 0 ? Math.min(ra, 20) * 1000 : 1500 * 2 ** attempt));
    } catch (e) {
      if (e instanceof AiError && !e.retryable) throw e;
      lastErr = e;
      if (!(e instanceof AiError)) await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new AiError(String(lastErr), true);
}

class AnthropicProvider implements ChatProvider {
  name = "anthropic" as const;
  constructor(public model: string, private key: string) {}
  async complete({ system, parts, maxTokens, temperature }: CompleteArgs) {
    const content = parts.map((p) =>
      p.type === "text"
        ? { type: "text", text: p.text }
        : { type: "image", source: { type: "base64", media_type: p.mime, data: p.base64 } },
    );
    const data = await postJson(
      `${config.ai.anthropicBaseUrl}/v1/messages`,
      { "x-api-key": this.key, "anthropic-version": "2023-06-01" },
      {
        model: this.model,
        max_tokens: maxTokens ?? config.ai.maxOutputTokens,
        ...(temperature !== undefined ? { temperature } : {}),
        system,
        messages: [{ role: "user", content }],
      },
    );
    const out = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    if (!out) throw new AiError("AI provider returned an empty response.", true);
    return out;
  }
}

/** OpenAI Chat Completions, also used for any OpenAI-compatible endpoint (incl. the Hugging Face router). */
class OpenAICompatibleProvider implements ChatProvider {
  constructor(
    public name: "openai" | "huggingface",
    public model: string,
    private baseUrl: string,
    private key: string,
    private tokensParam: string,
    private jsonMode: boolean,
  ) {}
  async complete({ system, parts, json, maxTokens, temperature }: CompleteArgs) {
    const content = parts.map((p) =>
      p.type === "text" ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: `data:${p.mime};base64,${p.base64}` } },
    );
    const body = (withJson: boolean) => ({
      model: this.model,
      [this.tokensParam]: maxTokens ?? config.ai.maxOutputTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(json && withJson ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        // Text-only requests use a plain string: some open models reject content arrays without images.
        { role: "user", content: parts.every((p) => p.type === "text") ? parts.map((p) => (p as any).text).join("\n\n") : content },
      ],
    });
    let data: any;
    try {
      data = await postJson(`${this.baseUrl}/chat/completions`, { authorization: `Bearer ${this.key}` }, body(this.jsonMode));
    } catch (e) {
      // Not every hosted model supports JSON mode; the prompt already demands JSON, so retry without it.
      if (json && this.jsonMode && e instanceof AiError && !e.retryable && /response_format|json/i.test(e.message)) {
        data = await postJson(`${this.baseUrl}/chat/completions`, { authorization: `Bearer ${this.key}` }, body(false));
      } else throw e;
    }
    const msg = data.choices?.[0]?.message;
    const out = typeof msg?.content === "string" ? msg.content : Array.isArray(msg?.content) ? msg.content.map((c: any) => c.text ?? "").join("") : "";
    if (!out.trim()) throw new AiError("AI provider returned an empty response.", true);
    return stripReasoning(out);
  }
}

/** Reasoning models (Qwen3, DeepSeek-R1 …) may prefix answers with <think> blocks. */
export function stripReasoning(text: string) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();
}

/** Build a chat client for a provider using the given account's own key. Returns null without a key. */
export function makeChat(provider: string, model: string, ai: UserAi): ChatProvider | null {
  const key = keyFor(ai, provider);
  if (!model || !key) return null;
  if (provider === "anthropic") return new AnthropicProvider(model, key);
  if (provider === "openai") return new OpenAICompatibleProvider("openai", model, ai.openaiBaseUrl, key, process.env.OPENAI_TOKENS_PARAM || "max_completion_tokens", true);
  if (provider === "huggingface") return new OpenAICompatibleProvider("huggingface", model, config.ai.hfBaseUrl, key, "max_tokens", process.env.HF_JSON_MODE !== "false");
  return null;
}

/** Chat client for a task under the project owner's settings. Null = development fallback (no key or turned off). */
export function chatFor(task: "synthesis" | "vision", ai: UserAi | null): ChatProvider | null {
  if (!ai) return null;
  const s = ai.tasks[task];
  return makeChat(s.provider, s.model, ai);
}

export function parseJsonLoose<T = any>(text: string): T {
  let t = stripReasoning(text);
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) throw new AiError("AI response did not contain JSON.", true);
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    throw new AiError("AI response contained malformed JSON.", true);
  }
}

// ---------- transcription ----------

export function transcriptionSetting(ai: UserAi | null) {
  if (!ai || !isLive(ai, "transcription")) return null;
  return ai.tasks.transcription;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AiError && !e.retryable) throw e;
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  throw lastErr;
}

export async function transcribe(ai: UserAi | null, audio: Buffer, filename: string, mime: string): Promise<{ text: string; model: string; provider: string }> {
  const s = transcriptionSetting(ai);
  if (!s) throw new AiError("No transcription provider configured.", false);
  const timeout = AbortSignal.timeout(Math.max(config.ai.timeoutMs, 300_000));

  if (s.provider === "huggingface") {
    // Hugging Face Inference (automatic-speech-recognition). Audio goes base64-encoded in a JSON body:
    // the router rejects many raw audio content types (e.g. browser-recorded video/webm), but always accepts JSON.
    const payload = JSON.stringify({ inputs: audio.toString("base64") });
    return withRetry(async () => {
      const res = await fetch(`${config.ai.hfInferenceUrl}/${s.model.split(":")[0]}`, {
        method: "POST",
        headers: { authorization: `Bearer ${keyFor(ai!, "huggingface")}`, "content-type": "application/json" },
        body: payload,
        signal: timeout,
      });
      const text = await res.text();
      if (res.ok) {
        const j = JSON.parse(text);
        return { text: String(j.text ?? j[0]?.text ?? "").trim(), model: s.model, provider: "huggingface" };
      }
      // 503 = model loading on HF Inference; worth retrying.
      throw new AiError(`Transcription failed (${res.status}): ${text.slice(0, 300)}`, res.status === 429 || res.status >= 500);
    });
  }

  return withRetry(async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), filename);
    form.append("model", s.model);
    form.append("response_format", "json");
    const res = await fetch(`${ai!.openaiBaseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${keyFor(ai!, "openai")}` },
      body: form,
      signal: timeout,
    });
    const text = await res.text();
    if (res.ok) return { text: (JSON.parse(text).text || "").trim(), model: s.model, provider: "openai" };
    throw new AiError(`Transcription failed (${res.status}): ${text.slice(0, 300)}`, res.status === 429 || res.status >= 500);
  });
}
