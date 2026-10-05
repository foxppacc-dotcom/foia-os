-- The AI assistant's OWN capability set, separate from role_permissions.
-- Per-role permissions (role_permissions, resource='ai_assistant',
-- action='use_chat') control WHO may talk to the assistant at all; this
-- table controls WHAT the assistant itself is allowed to do once someone
-- does -- a single global on/off per tool, independent of who's chatting,
-- so an admin can widen or narrow the assistant's own capabilities based on
-- how accurate they find its results, without touching per-role grants.
CREATE TABLE IF NOT EXISTS public.ai_capabilities (
  action text PRIMARY KEY,
  allowed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
