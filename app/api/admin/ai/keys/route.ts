import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { requireAdmin } from "@/lib/session";
import { getUserAi, maskedKeys, setUserKey, statusOf } from "@/lib/ai/settings";

// Set or remove one of the signed-in account's own provider keys. The key is encrypted at rest and never sent back.
const Schema = z.object({
  provider: z.enum(["huggingface", "anthropic", "openai"]),
  key: z.string().trim().min(8, "That doesn't look like an API key.").max(500).regex(/^\S+$/, "API keys can't contain spaces.").nullable(),
});

export const PUT = route(async (req) => {
  const me = await requireAdmin();
  const b = await body(req, Schema);
  await setUserKey(me.id, b.provider, b.key);
  const ai = await getUserAi(me.id, true);
  return json({ keys: maskedKeys(ai), status: statusOf(ai) });
});
