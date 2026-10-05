-- Internal messaging: employees message each other directly, in groups, or
-- via an org-wide broadcast channel (admin/manager only) -- separate from
-- both `notifications` (system alerts, no sender, no thread) and `forum_*`
-- (public company-wide board, no private/participant-scoped conversations).
--
-- `internal_conversations.type`: 'dm' (exactly 2 participants), 'group'
-- (named, participant-scoped), 'broadcast' (org-wide -- visibility is
-- permission-gated, not participant-row-gated, same convention forum_topics
-- already uses for "everyone with view can see it").
CREATE TABLE IF NOT EXISTS public.internal_conversations (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('dm', 'group', 'broadcast')),
  title TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Membership + per-user read tracking for 'dm'/'group' conversations.
-- 'broadcast' conversations don't need rows here at all (visibility is a
-- role_permissions check, not membership) -- kept simple rather than
-- snapshotting every employee into a broadcast's participant list.
CREATE TABLE IF NOT EXISTS public.internal_conversation_participants (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES internal_conversations(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.internal_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES internal_conversations(id) ON DELETE CASCADE,
  sender_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  attachment_url TEXT,
  attachment_type TEXT,
  attachment_name TEXT,
  -- Set when this message was drafted by the AI assistant and a human
  -- explicitly confirmed sending it (never auto-sent) -- purely a
  -- transparency marker the UI can show ("عبر المساعد الذكي"); the message
  -- still shows as sent BY sender_id (the confirming human), not the AI.
  via_ai BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_internal_conv_participants_user ON public.internal_conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_internal_conv_participants_conv ON public.internal_conversation_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_internal_messages_conversation ON public.internal_messages(conversation_id, created_at);

-- Self-hosted PostgREST authenticates every request as web_anon -- a new
-- table has no privileges for that role until explicitly granted (see
-- memory: postgrest_new_table_grants). Every existing table carries this
-- same grant.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_conversations TO web_anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_conversation_participants TO web_anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_messages TO web_anon;
GRANT USAGE, SELECT ON SEQUENCE public.internal_conversations_id_seq TO web_anon;
GRANT USAGE, SELECT ON SEQUENCE public.internal_conversation_participants_id_seq TO web_anon;
GRANT USAGE, SELECT ON SEQUENCE public.internal_messages_id_seq TO web_anon;
