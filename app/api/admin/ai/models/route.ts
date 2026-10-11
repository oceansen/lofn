import { json, route, badRequest } from "@/lib/http";
import { requireAdmin } from "@/lib/session";

// Models on the Hugging Face Hub that are served by Inference Providers, by task.
const TASKS: Record<string, { tags: string[]; provider: string }> = {
  synthesis: { tags: ["text-generation", "image-text-to-text"], provider: "all" },
  vision: { tags: ["image-text-to-text"], provider: "all" },
  // Lofn calls speech recognition through HF Inference, so only models it serves are listed.
  transcription: { tags: ["automatic-speech-recognition"], provider: "hf-inference" },
};

export const GET = route(async (req) => {
  await requireAdmin();
  const sp = new URL(req.url).searchParams;
  const task = TASKS[sp.get("task") || ""];
  if (!task) throw badRequest("Unknown task.");
  const q = (sp.get("q") || "").trim().slice(0, 80);
  const results = await Promise.all(
    task.tags.map(async (tag) => {
      const url = new URL("https://huggingface.co/api/models");
      url.searchParams.set("inference_provider", task.provider);
      url.searchParams.set("pipeline_tag", tag);
      url.searchParams.set("sort", "trendingScore");
      url.searchParams.set("limit", "30");
      url.searchParams.append("expand[]", "inferenceProviderMapping");
      url.searchParams.append("expand[]", "downloads");
      url.searchParams.append("expand[]", "likes");
      if (q) url.searchParams.set("search", q);
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`Hugging Face returned ${res.status}`);
      const list: any[] = await res.json();
      return list.map((m) => {
        const raw = m.inferenceProviderMapping;
        const mapping: any[] = Array.isArray(raw) ? raw : Object.entries(raw || {}).map(([provider, v]: any) => ({ provider, ...v }));
        // Only providers that serve the model live, for the kind of call Lofn makes.
        const wanted = tag === "automatic-speech-recognition" ? "automatic-speech-recognition" : "conversational";
        const live = mapping.filter((p) => (p.status ?? "live") === "live" && (!p.task || p.task === wanted));
        const providers = live.map((p) => p.provider as string);
        const structured = live.some((p) => p.features?.structuredOutput);
        return {
          id: m.id as string,
          task: tag,
          providers,
          structured,
          downloads: m.downloads ?? 0,
          likes: m.likes ?? 0,
          vision: tag === "image-text-to-text",
          // Heuristic: served by several providers, or with structured (JSON) output, which the synthesis relies on.
          recommended: tag === "automatic-speech-recognition" ? providers.length > 0 : providers.length >= 2 || structured,
        };
      }).filter((m) => m.providers.length > 0);
    }),
  ).catch((e) => {
    throw badRequest(`Couldn't reach the Hugging Face Hub: ${(e as Error).message}`);
  });
  const seen = new Set<string>();
  const models = results
    .flat()
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .sort((a, b) => Number(b.recommended) - Number(a.recommended) || Number(b.structured) - Number(a.structured) || b.providers.length - a.providers.length || b.likes - a.likes);
  return json({ models });
});
