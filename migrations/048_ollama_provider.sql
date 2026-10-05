-- Adds Ollama (self-hosted local LLM server) as a selectable AI provider.
-- Ollama has no real API key -- its OpenAI-compatible endpoint accepts any
-- placeholder string -- and it needs a reachable base_url instead (every
-- other provider today has a fixed/well-known API host baked into its own
-- adapter, so base_url never existed as a column before this).
ALTER TABLE public.ai_provider_configs ALTER COLUMN api_key_encrypted DROP NOT NULL;
ALTER TABLE public.ai_provider_configs ADD COLUMN IF NOT EXISTS base_url text;

ALTER TABLE public.ai_provider_configs DROP CONSTRAINT IF EXISTS ai_provider_configs_provider_check;
ALTER TABLE public.ai_provider_configs ADD CONSTRAINT ai_provider_configs_provider_check
  CHECK (provider IN ('anthropic', 'openai', 'deepseek', 'gemini', 'ollama'));
