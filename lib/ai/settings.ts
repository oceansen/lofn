// Per-account AI configuration ("bring your own key"). Each project's AI work runs on its owner's keys;
// server environment keys are never used for anyone's projects.
import { config } from "../config";
import { one, query } from "../db";
import { decryptSecret, encryptSecret, maskSecret } from "../secrets";

export type Task = "synthesis" | "vision" | "transcription";
export type KeyProvider = "anthropic" | "openai" | "huggingface";
export type TaskSetting = { provider: KeyProvider | "none"; model: string };
export type AiSettings = Record<Task, TaskSetting>;
export type UserAi = { ownerId: string; tasks: AiSettings; openaiBaseUrl: string; keys: Partial<Record<KeyProvider, string>> };

export const CHAT_PROVIDERS = ["huggingface", "anthropic", "openai", "none"] as const;
export const ASR_PROVIDERS = ["huggingface", "openai", "none"] as const;
export const KEY_PROVIDERS: KeyProvider[] = ["huggingface", "anthropic", "openai"];

export function defaultModel(task: Task, provider: string): string {
  if (provider === "anthropic") return task === "transcription" ? "" : config.ai.anthropicModel;
  if (provider === "openai") return task === "transcription" ? config.ai.openaiTranscriptionModel : config.ai.openaiModel;
  if (provider === "huggingface") return task === "transcription" ? config.ai.hfAsrModel : task === "vision" ? config.ai.hfVisionModel : config.ai.hfModel;
  return "";
}

const DEFAULT_TASKS: AiSettings = {
  synthesis: { provider: "huggingface", model: defaultModel("synthesis", "huggingface") },
  vision: { provider: "huggingface", model: defaultModel("vision", "huggingface") },
  transcription: { provider: "huggingface", model: defaultModel("transcription", "huggingface") },
};

const cache = new Map<string, { at: number; value: UserAi }>();
const TTL = 10_000;

export async function getUserAi(ownerId: string, fresh = false): Promise<UserAi> {
  const hit = cache.get(ownerId);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.value;
  const row = await one(`SELECT tasks, options, keys_enc FROM user_ai_settings WHERE admin_id=$1`, [ownerId]).catch(() => null);
  const tasks = { ...DEFAULT_TASKS };
  for (const t of ["synthesis", "vision", "transcription"] as Task[]) {
    const s = row?.tasks?.[t];
    if (s?.provider) tasks[t] = { provider: s.provider, model: s.model || defaultModel(t, s.provider) };
  }
  const keys: UserAi["keys"] = {};
  for (const p of KEY_PROVIDERS) {
    const enc = row?.keys_enc?.[p];
    const plain = enc ? decryptSecret(enc) : null;
    if (plain) keys[p] = plain;
  }
  const value: UserAi = {
    ownerId,
    tasks,
    openaiBaseUrl: (row?.options?.openaiBaseUrl || "https://api.openai.com/v1").replace(/\/$/, ""),
    keys,
  };
  cache.set(ownerId, { at: Date.now(), value });
  return value;
}

const ownerCache = new Map<string, string>();
export async function ownerOfProject(projectId: string): Promise<string | null> {
  if (ownerCache.has(projectId)) return ownerCache.get(projectId)!;
  const r = await one(`SELECT owner_id FROM projects WHERE id=$1`, [projectId]);
  if (r) ownerCache.set(projectId, r.owner_id);
  return r?.owner_id ?? null;
}

export async function aiForProject(projectId: string): Promise<UserAi | null> {
  const owner = await ownerOfProject(projectId);
  return owner ? getUserAi(owner) : null;
}

export async function saveUserTasks(ownerId: string, tasks: AiSettings, openaiBaseUrl: string) {
  await query(
    `INSERT INTO user_ai_settings(admin_id, tasks, options) VALUES ($1,$2,$3)
     ON CONFLICT (admin_id) DO UPDATE SET tasks=EXCLUDED.tasks, options=EXCLUDED.options, updated_at=now()`,
    [ownerId, JSON.stringify(tasks), JSON.stringify({ openaiBaseUrl })],
  );
  cache.delete(ownerId);
}

/** Store (or, with null, remove) one provider key, encrypted. */
export async function setUserKey(ownerId: string, provider: KeyProvider, key: string | null) {
  const patch = key ? JSON.stringify({ [provider]: encryptSecret(key) }) : "{}";
  await query(
    `INSERT INTO user_ai_settings(admin_id, keys_enc) VALUES ($1, $2::jsonb)
     ON CONFLICT (admin_id) DO UPDATE SET keys_enc = (user_ai_settings.keys_enc - $3::text) || $2::jsonb, updated_at=now()`,
    [ownerId, patch, provider],
  );
  cache.delete(ownerId);
}

export function keyFor(ai: UserAi, provider: string) {
  return provider === "anthropic" || provider === "openai" || provider === "huggingface" ? ai.keys[provider] ?? "" : "";
}

/** A task is "live" when its provider is not "none", has a model, and the owner supplied that provider's key. */
export function isLive(ai: UserAi, task: Task) {
  const s = ai.tasks[task];
  return s.provider !== "none" && !!s.model && !!keyFor(ai, s.provider);
}

export function maskedKeys(ai: UserAi) {
  return Object.fromEntries(KEY_PROVIDERS.map((p) => [p, ai.keys[p] ? maskSecret(ai.keys[p]!) : null])) as Record<KeyProvider, string | null>;
}

export function statusOf(ai: UserAi | null) {
  const live = (t: Task) => !!ai && isLive(ai, t);
  return {
    synthesisProvider: live("synthesis") ? ai!.tasks.synthesis.provider : "none",
    synthesisModel: live("synthesis") ? ai!.tasks.synthesis.model : null,
    visionProvider: live("vision") ? ai!.tasks.vision.provider : "none",
    visionModel: live("vision") ? ai!.tasks.vision.model : null,
    transcriptionProvider: live("transcription") ? ai!.tasks.transcription.provider : "none",
    transcriptionModel: live("transcription") ? ai!.tasks.transcription.model : null,
    hasAnyKey: !!ai && Object.keys(ai.keys).length > 0,
    isFallback: !live("synthesis"),
    visionFallback: !live("vision"),
    transcriptionFallback: !live("transcription"),
  };
}

export async function aiStatus(ownerId: string) {
  return statusOf(await getUserAi(ownerId));
}
