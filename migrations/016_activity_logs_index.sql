-- FOIA OS Migration: composite index for activity_logs lookups
-- activity_logs is the largest table in the system and grows continuously
-- (append-only). It's queried via a 5-way OR filter on
-- (target_type, target_id) ordered by created_at from the case timeline and
-- checklist-notes merge routes -- this index lets Postgres satisfy that
-- filter+sort with an index scan instead of a growing sequential scan.

CREATE INDEX IF NOT EXISTS idx_activity_logs_target_created
  ON public.activity_logs (target_type, target_id, created_at DESC);
