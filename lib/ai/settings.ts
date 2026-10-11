// Which AI provider + model each task uses. Defaults come from the environment; administrators can
// override provider/model choices in the app (stored in app_settings). API keys stay in the environment.
import { config, type AiProviderName, type AsrProviderName } from "../config";
import { one, query } from "../db";

export type Task = "synthesis" | "vision" | "transcription";
export type TaskSetting = { provider: AiProviderName | AsrProviderName; model: string };
export type AiSettings = Record<Task, TaskSetting>;

export const CHAT_PROVIDERS: AiProviderName[] = ["anthropic", "openai", "huggingface", "none"];
export const ASR_PROVIDERS: AsrProviderName[] = ["openai", "huggingface", "none"];

export function hasKey(provider: string) {
  if (provider === "anthropic") return !!config.ai.anthropicKey;
  if (provider === "openai") return !!config.ai.openaiKey;
  if (provider === "huggingface") return !!config.ai.hfToken;
  return true;
}

export function defaultModel(task: Task, provider: string): string {
  if (provider === "anthropic") return config.ai.anthropicModel;
  if (provider === "openai") return task === "transcription" ? config.ai.openaiTranscriptionModel : config.ai.openaiModel;
  if (provider === "huggingface") return task === "transcription" ? config.ai.hfAsrModel : task === "vision" ? config.ai.hfVisionModel : config.ai.hfModel;
  return "";
}

function envDefaults(): AiSettings {
  const p = config.ai.provider;
  const t = config.ai.transcription;
  return {
    synthesis: { provider: p, model: defaultModel("synthesis", p) },
    vision: { provider: p, model: defaultModel("vision", p) },
    transcription: { provider: t, model: defaultModel("transcription", t) },
  };
}

let cache: { at: number; value: AiSettings } | null = null;
const TTL = 10_000;

export async function getAiSettings(fresh = false): Promise<AiSettings> {
  if (!fresh && cache && Date.now() - cache.at < TTL) return cache.value;
  const d = envDefaults();
  let stored: Partial<AiSettings> = {};
  try {
    stored = (await one(`SELECT value FROM app_settings WHERE key='ai'`))?.value ?? {};
  } catch {
    // table may not exist yet during first migration
  }
  const merge = (task: Task): TaskSetting => {
    const s = stored[task];
    if (!s?.provider) return d[task];
    return { provider: s.provider, model: s.model || defaultModel(task, s.provider) };
  };
  const value = { synthesis: merge("synthesis"), vision: merge("vision"), transcription: merge("transcription") };
  cache = { at: Date.now(), value };
  return value;
}

export async function saveAiSettings(next: AiSettings, adminId: string) {
  await query(
    `INSERT INTO app_settings(key, value, updated_by) VALUES ('ai', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [JSON.stringify(next), adminId],
  );
  cache = null;
}

/** A task is "live" when its provider is not "none" and its key is present. */
export function isLive(s: TaskSetting) {
  return s.provider !== "none" && hasKey(s.provider) && !!s.model;
}

export async function aiStatus() {
  const s = await getAiSettings();
  return {
    synthesisProvider: isLive(s.synthesis) ? s.synthesis.provider : "none",
    synthesisModel: isLive(s.synthesis) ? s.synthesis.model : null,
    visionProvider: isLive(s.vision) ? s.vision.provider : "none",
    visionModel: isLive(s.vision) ? s.vision.model : null,
    transcriptionProvider: isLive(s.transcription) ? s.transcription.provider : "none",
    transcriptionModel: isLive(s.transcription) ? s.transcription.model : null,
    isFallback: !isLive(s.synthesis),
    visionFallback: !isLive(s.vision),
    transcriptionFallback: !isLive(s.transcription),
  };
}
