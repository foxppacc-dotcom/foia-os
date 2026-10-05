-- FOIA OS Migration: create the notifications table
-- Run manually in Supabase Dashboard -> SQL Editor (same as 001-009).
-- Backend code across case_detail.routes.js, mailPoller.js, team.routes.js,
-- and the new deadline-check cron already inserts/reads this table and
-- gracefully no-ops when it's missing -- this migration makes it real.

CREATE TABLE IF NOT EXISTS public.notifications (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL,
  type text,
  title text,
  body text,
  target_type text,
  target_id integer,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id, is_read);
