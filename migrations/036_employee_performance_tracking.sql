-- Per-user-per-day active-usage accumulator (the heartbeat target). One row
-- per (user_id, date); active_seconds is incremented by the heartbeat
-- endpoint, never overwritten wholesale, so a stale client can't erase a
-- day's already-recorded time.
CREATE TABLE IF NOT EXISTS public.user_activity_time (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  active_seconds int NOT NULL DEFAULT 0,
  last_heartbeat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_user_activity_time_user_date ON public.user_activity_time(user_id, date);
ALTER TABLE public.user_activity_time ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Authenticated users can manage activity time" ON public.user_activity_time
    FOR ALL USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Context for the idle-assignment badge on the employee profile page
-- (existing rows get NULL -- no historical assignment date exists to
-- backfill from).
ALTER TABLE public.case_assignees ADD COLUMN IF NOT EXISTS assigned_at timestamptz DEFAULT now();

-- New read pattern this feature introduces: activity_logs / case_comments
-- filtered BY USER first (previously only ever queried by target). Deliberate,
-- not incidental -- activity_logs is the largest, continuously-growing table
-- in this system (see migration 016's own note on it).
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_target ON public.activity_logs(user_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_case_comments_user_case ON public.case_comments(user_id, case_id);
