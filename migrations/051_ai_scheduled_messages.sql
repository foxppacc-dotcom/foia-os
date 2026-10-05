-- Backs the AI assistant's scheduled-send capability: draft_message_to_employee
-- (aiTools.js) can now propose a send_at, and confirming "جدولة" (instead of
-- "إرسال الآن") inserts a row here rather than sending immediately. The
-- per-minute cron (checkDuePersonalTasks's sibling, sendDueScheduledMessages
-- in deadlineChecker.js) sends it for real once send_at arrives and marks it
-- 'sent'. conversation_id/sent_at are only filled in once actually sent --
-- the DM conversation itself is deliberately not created at schedule time,
-- so a cancelled schedule never leaves an empty DM thread behind.
CREATE TABLE IF NOT EXISTS public.ai_scheduled_messages (
  id BIGSERIAL PRIMARY KEY,
  requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  send_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  conversation_id INTEGER REFERENCES internal_conversations(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_scheduled_messages_due
  ON public.ai_scheduled_messages (send_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_ai_scheduled_messages_requester
  ON public.ai_scheduled_messages (requested_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_scheduled_messages TO web_anon;
GRANT USAGE, SELECT ON SEQUENCE public.ai_scheduled_messages_id_seq TO web_anon;
