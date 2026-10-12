// Central runtime configuration. Server-side only: never import from client components.

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export type AiProviderName = "anthropic" | "openai" | "huggingface" | "none";
export type AsrProviderName = "openai" | "huggingface" | "none";

export const config = {
  databaseUrl: process.env.DATABASE_URL || "postgres://lofn:lofn@localhost:5432/lofn",
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || (process.env.SPACE_HOST ? `https://${process.env.SPACE_HOST}` : "") || "http://localhost:3000").replace(/\/$/, ""),
  isProd: process.env.NODE_ENV === "production",

  // AI keys come from each account (bring your own key); the server holds no provider keys.
  ai: {
    anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    anthropicBaseUrl: (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, ""),
    openaiModel: process.env.OPENAI_MODEL || "gpt-4o",
    openaiTranscriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1",
    hfBaseUrl: (process.env.HF_BASE_URL || "https://router.huggingface.co/v1").replace(/\/$/, ""),
    hfRouterUrl: (process.env.HF_ROUTER_URL || "https://router.huggingface.co").replace(/\/$/, ""),
    hfHubUrl: (process.env.HF_HUB_URL || "https://huggingface.co").replace(/\/$/, ""),
    hfModel: process.env.HF_MODEL || "Qwen/Qwen3.8-27B",
    hfVisionModel: process.env.HF_VISION_MODEL || process.env.HF_MODEL || "Qwen/Qwen3.8-27B",
    hfAsrModel: process.env.HF_ASR_MODEL || "openai/whisper-large-v3-turbo",
    timeoutMs: int("AI_TIMEOUT_MS", 120_000),
    maxOutputTokens: int("AI_MAX_OUTPUT_TOKENS", 4096),
  },

  synthesis: {
    intervalMs: int("SYNTHESIS_INTERVAL_SECONDS", 60) * 1000,
    // Max characters of prior-contribution excerpts given to the model for grounding.
    ledgerBudgetChars: int("SYNTHESIS_LEDGER_BUDGET_CHARS", 60_000),
    leaseSeconds: int("SYNTHESIS_LEASE_SECONDS", 180),
    // How long the final synthesis waits for media still being processed.
    finalWaitSeconds: int("FINAL_SYNTHESIS_WAIT_SECONDS", 180),
  },

  storage: {
    driver: (process.env.STORAGE_DRIVER || "local") as "local" | "s3",
    localDir: process.env.STORAGE_DIR || "./storage",
    s3Bucket: process.env.S3_BUCKET || "",
    s3Region: process.env.S3_REGION || "us-east-1",
    s3Endpoint: process.env.S3_ENDPOINT || undefined,
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    signedUrlSeconds: int("S3_SIGNED_URL_SECONDS", 300),
  },

  limits: {
    imageBytes: int("MAX_IMAGE_MB", 15) * 1024 * 1024,
    audioBytes: int("MAX_AUDIO_MB", 50) * 1024 * 1024,
    videoBytes: int("MAX_VIDEO_MB", 250) * 1024 * 1024,
    textChars: int("MAX_TEXT_CHARS", 8000),
    imagesPerContribution: int("MAX_IMAGES_PER_CONTRIBUTION", 4),
    videoAnalyseSeconds: int("MAX_VIDEO_ANALYSE_SECONDS", 600),
    contributionGraceSeconds: int("CONTRIBUTION_GRACE_SECONDS", 5),
  },

  worker: {
    concurrency: int("WORKER_CONCURRENCY", 4),
    pollMs: int("WORKER_POLL_MS", 1000),
  },
};
