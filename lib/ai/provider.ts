import { config } from "../config";

export type Part = { type: "text"; text: string } | { type: "image"; mime: string; base64: string };

export type CompleteArgs = { system: string; parts: Part[]; json?: boolean; maxTokens?: number; temperature?: number };

export interface ChatProvider {
  name: "anthropic" | "openai";
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
  model = config.ai.anthropicModel;
  async complete({ system, parts, maxTokens, temperature }: CompleteArgs) {
    const content = parts.map((p) =>
      p.type === "text"
        ? { type: "text", text: p.text }
        : { type: "image", source: { type: "base64", media_type: p.mime, data: p.base64 } },
    );
    const data = await postJson(
      `${config.ai.anthropicBaseUrl}/v1/messages`,
      { "x-api-key": config.ai.anthropicKey, "anthropic-version": "2023-06-01" },
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

class OpenAIProvider implements ChatProvider {
  name = "openai" as const;
  model = config.ai.openaiModel;
  async complete({ system, parts, json, maxTokens, temperature }: CompleteArgs) {
    const content = parts.map((p) =>
      p.type === "text" ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: `data:${p.mime};base64,${p.base64}` } },
    );
    const tokensParam = process.env.OPENAI_TOKENS_PARAM || "max_completion_tokens";
    const data = await postJson(
      `${config.ai.openaiBaseUrl}/chat/completions`,
      { authorization: `Bearer ${config.ai.openaiKey}` },
      {
        model: this.model,
        [tokensParam]: maxTokens ?? config.ai.maxOutputTokens,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
      },
    );
    const out = data.choices?.[0]?.message?.content;
    if (!out) throw new AiError("AI provider returned an empty response.", true);
    return out;
  }
}

let cached: ChatProvider | null | undefined;
/** Returns null when no AI provider is configured (development fallback mode). */
export function chatProvider(): ChatProvider | null {
  if (cached !== undefined) return cached;
  if (config.ai.provider === "anthropic" && config.ai.anthropicKey) cached = new AnthropicProvider();
  else if (config.ai.provider === "openai" && config.ai.openaiKey) cached = new OpenAIProvider();
  else cached = null;
  return cached;
}

export function parseJsonLoose<T = any>(text: string): T {
  let t = text.trim();
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

export function transcriptionAvailable() {
  return config.ai.transcription === "openai" && !!config.ai.openaiKey;
}

export async function transcribe(audio: Buffer, filename: string, mime: string): Promise<{ text: string; model: string }> {
  if (!transcriptionAvailable()) throw new AiError("No transcription provider configured.", false);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), filename);
    form.append("model", config.ai.openaiTranscriptionModel);
    form.append("response_format", "json");
    try {
      const res = await fetch(`${config.ai.openaiBaseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.ai.openaiKey}` },
        body: form,
        signal: AbortSignal.timeout(Math.max(config.ai.timeoutMs, 300_000)),
      });
      const text = await res.text();
      if (res.ok) return { text: (JSON.parse(text).text || "").trim(), model: config.ai.openaiTranscriptionModel };
      const retryable = res.status === 429 || res.status >= 500;
      lastErr = new AiError(`Transcription failed (${res.status}): ${text.slice(0, 300)}`, retryable);
      if (!retryable) throw lastErr;
    } catch (e) {
      if (e instanceof AiError && !e.retryable) throw e;
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  throw lastErr;
}
