import { z } from "zod";
import { body, json, route, badRequest } from "@/lib/http";
import { requireInstanceAdmin as requireAdmin } from "@/lib/session";
import { ASR_PROVIDERS, CHAT_PROVIDERS, aiStatus, defaultModel, getAiSettings, hasKey, saveAiSettings } from "@/lib/ai/settings";

const Task = z.object({ provider: z.string(), model: z.string().trim().max(200) });
const Schema = z.object({ synthesis: Task, vision: Task, transcription: Task });

export const GET = route(async () => {
  await requireAdmin();
  const settings = await getAiSettings(true);
  const keys = { anthropic: hasKey("anthropic"), openai: hasKey("openai"), huggingface: hasKey("huggingface") };
  const defaults: Record<string, Record<string, string>> = {};
  for (const task of ["synthesis", "vision", "transcription"] as const)
    defaults[task] = Object.fromEntries((task === "transcription" ? ASR_PROVIDERS : CHAT_PROVIDERS).map((p) => [p, defaultModel(task, p)]));
  return json({ settings, keys, defaults, status: await aiStatus(), providers: { chat: CHAT_PROVIDERS, asr: ASR_PROVIDERS } });
});

export const PUT = route(async (req) => {
  const admin = await requireAdmin();
  const b = await body(req, Schema);
  if (!CHAT_PROVIDERS.includes(b.synthesis.provider as any) || !CHAT_PROVIDERS.includes(b.vision.provider as any)) throw badRequest("Unknown provider.");
  if (!ASR_PROVIDERS.includes(b.transcription.provider as any)) throw badRequest("Unknown transcription provider.");
  for (const [task, s] of Object.entries(b)) if (s.provider !== "none" && !s.model) throw badRequest(`Choose a model for ${task}.`);
  await saveAiSettings(b as any, admin.id);
  return json({ settings: await getAiSettings(true), status: await aiStatus() });
});
