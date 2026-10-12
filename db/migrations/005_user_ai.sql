-- Bring-your-own-key: each account stores its own AI provider keys (encrypted) and model choices.
CREATE TABLE user_ai_settings (
  admin_id    uuid PRIMARY KEY REFERENCES admins(id) ON DELETE CASCADE,
  tasks       jsonb NOT NULL DEFAULT '{}',   -- { synthesis|vision|transcription: { provider, model } }
  options     jsonb NOT NULL DEFAULT '{}',   -- { openaiBaseUrl }
  keys_enc    jsonb NOT NULL DEFAULT '{}',   -- { anthropic|openai|huggingface: "v1:<iv>:<tag>:<ciphertext>" }
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- The old instance-wide AI choice no longer applies.
DELETE FROM app_settings WHERE key = 'ai';
