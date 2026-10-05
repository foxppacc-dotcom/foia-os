-- AI Assistant inside الاستقبال الذكي: provider config (encrypted API keys,
-- editable at runtime by an admin -- never a Vercel env var, since the whole
-- point is switching/adding providers from the app itself) plus conversation
-- history. No new "suggestion" table -- an AI-proposed case link reuses the
-- existing communications.metadata.possible_matches field mailPoller.js
-- already writes to and Inbox.jsx already renders.
CREATE TABLE IF NOT EXISTS public.ai_provider_configs (
  id serial PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('anthropic', 'openai', 'deepseek', 'gemini')),
  api_key_encrypted text NOT NULL,
  model text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  daily_request_count integer NOT NULL DEFAULT 0,
  daily_count_reset_at date NOT NULL DEFAULT CURRENT_DATE,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id serial PRIMARY KEY,
  user_id integer REFERENCES users(id) ON DELETE CASCADE,
  title text,
  provider_config_id integer REFERENCES ai_provider_configs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content text,
  tool_calls jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON public.ai_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON public.ai_conversations (user_id, created_at DESC);
