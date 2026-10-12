import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { requireAdmin } from "@/lib/session";
import { getUserAi } from "@/lib/ai/settings";
import { testModel } from "@/lib/ai/test";

const Schema = z.object({ task: z.enum(["synthesis", "vision", "transcription"]), provider: z.string(), model: z.string().max(200) });

export const POST = route(async (req) => {
  const me = await requireAdmin();
  const b = await body(req, Schema);
  return json(await testModel(await getUserAi(me.id, true), b.task, b.provider, b.model));
});
