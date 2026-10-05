-- Lets a team member mark a "تخطّى الموعد المتوقع للرد" (overdue agency
-- response) item as acknowledged. Once acknowledged: it drops off the
-- system-wide Dashboard overdue panel (handled by the query filtering
-- overdue_ack_by IS NULL), but stays visible inside the case itself with
-- who-acknowledged-it-and-when instead of disappearing -- this row plus the
-- activity_logs entry the acknowledge route writes are the permanent,
-- undeletable record (no DELETE route exists for either table).
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS overdue_ack_by INT REFERENCES public.users(id);
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS overdue_ack_at TIMESTAMPTZ;
