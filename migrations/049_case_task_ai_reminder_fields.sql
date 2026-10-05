-- Backs the AI assistant's set_case_reminder tool (aiTools.js) and the new
-- "المهام" section in the AI Assistant page: which case_tasks rows were
-- requested THROUGH the assistant (source/created_by), whether the daily
-- due-date check has actually notified the team about it yet (notified_at --
-- the "result" the user asked to see), and completing one at all
-- (completed_at was already being SET by PUT /api/tasks/:id/status --
-- team.routes.js -- without ever having been a real column, a silent
-- failure for anyone who tried marking a task complete).
ALTER TABLE public.case_tasks ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.case_tasks ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE public.case_tasks ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
ALTER TABLE public.case_tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
