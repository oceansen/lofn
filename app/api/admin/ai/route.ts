import { z } from "zod";
import { body, json, route, badRequest } from "@/lib/http";
import { requireAdmin } from "@/lib/session";
import { TASKS, ASR_PROVIDERS, CHAT_PROVIDERS, KEY_PROVIDERS, defaultModel, getUserAi, maskedKeys, saveUserTasks, statusOf } from "@/lib/ai/settings";

// Every signed-in account manages its own AI settings and keys. Keys are never returned, only masked.
const Task = z.object({ provider: z.string(), model: z.string().trim().max(200) });
const Schema = z.object({
  settings: z.object({ synthesis: Task, vision: Task, video: Task, transcription: Task }),
  openaiBaseUrl: z.string().trim().url().max(300).optional(),
});

async function view(ownerId: string) {
  const ai = await getUserAi(ownerId, true);
  const defaults: Record<string, Record<string, string>> = {};
  for (const task of TASKS)
    defaults[task] = Object.fromEntries((task === "transcription" ? ASR_PROVIDERS : CHAT_PROVIDERS).map((p) => [p, defaultModel(task, p)]));
  return {
    settings: ai.tasks,
    openaiBaseUrl: ai.openaiBaseUrl,
    keys: maskedKeys(ai),
    keyProviders: KEY_PROVIDERS,
    defaults,
    status: statusOf(ai),
    providers: { chat: CHAT_PROVIDERS, asr: ASR_PROVIDERS },
  };
}

export const GET = route(async () => {
  const me = await requireAdmin();
  return json(await view(me.id));
});

export const PUT = route(async (req) => {
  const me = await requireAdmin();
  const b = await body(req, Schema);
  const s = b.settings;
  if ([s.synthesis, s.vision, s.video].some((t) => !CHAT_PROVIDERS.includes(t.provider as any))) throw badRequest("Unknown provider.");
  if (!ASR_PROVIDERS.includes(s.transcription.provider as any)) throw badRequest("Unknown transcription provider.");
  for (const [task, t] of Object.entries(s)) if (t.provider !== "none" && !t.model) throw badRequest(`Choose a model for ${task}.`);
  const current = await getUserAi(me.id, true);
  await saveUserTasks(me.id, s as any, (b.openaiBaseUrl || current.openaiBaseUrl).replace(/\/$/, ""));
  return json(await view(me.id));
});
