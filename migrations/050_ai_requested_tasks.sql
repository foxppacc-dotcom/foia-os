-- Backs the AI assistant's broadened set_reminder/list_reminders/
-- log_requested_task tools (aiTools.js): personal, minute-precision
-- reminders and plain to-dos that aren't tied to a case (case_tasks.case_id
-- is NOT NULL, so it can't represent these). Kept as its own table rather
-- than loosening case_tasks -- the existing day-granularity, case-required
-- reminder path (case_tasks) stays completely untouched.
CREATE TABLE IF NOT EXISTS public.ai_requested_tasks (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id BIGINT REFERENCES cases(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  remind_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'todo',
  notified_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_requested_tasks_due
  ON public.ai_requested_tasks (remind_at)
  WHERE remind_at IS NOT NULL AND notified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_requested_tasks_user
  ON public.ai_requested_tasks (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_requested_tasks TO web_anon;
GRANT USAGE, SELECT ON SEQUENCE public.ai_requested_tasks_id_seq TO web_anon;
