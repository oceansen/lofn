// Central runtime configuration. Server-side only: never import from client components.

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export type AiProviderName = "anthropic" | "openai" | "none";

function resolveProvider(): AiProviderName {
  const explicit = (process.env.AI_PROVIDER || "").toLowerCase();
  if (explicit === "anthropic" || explicit === "openai" || explicit === "none") return explicit;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "none";
}

function resolveTranscription(): "openai" | "none" {
  const explicit = (process.env.TRANSCRIPTION_PROVIDER || "").toLowerCase();
  if (explicit === "openai" || explicit === "none") return explicit;
  return process.env.OPENAI_API_KEY ? "openai" : "none";
}

export const config = {
  databaseUrl: process.env.DATABASE_URL || "postgres://lofn:lofn@localhost:5432/lofn",
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || (process.env.SPACE_HOST ? `https://${process.env.SPACE_HOST}` : "") || "http://localhost:3000").replace(/\/$/, ""),
  isProd: process.env.NODE_ENV === "production",

  ai: {
    provider: resolveProvider(),
    transcription: resolveTranscription(),
    anthropicKey: process.env.ANTHROPIC_API_KEY || "",
    anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    anthropicBaseUrl: (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, ""),
    openaiKey: process.env.OPENAI_API_KEY || "",
    openaiBaseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    openaiModel: process.env.OPENAI_MODEL || "gpt-4o",
    openaiTranscriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1",
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

export function aiStatus() {
  return {
    synthesisProvider: config.ai.provider,
    synthesisModel:
      config.ai.provider === "anthropic" ? config.ai.anthropicModel : config.ai.provider === "openai" ? config.ai.openaiModel : null,
    visionProvider: config.ai.provider,
    transcriptionProvider: config.ai.transcription,
    transcriptionModel: config.ai.transcription === "openai" ? config.ai.openaiTranscriptionModel : null,
    isFallback: config.ai.provider === "none",
    transcriptionFallback: config.ai.transcription === "none",
  };
}
