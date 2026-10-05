-- FOIA OS Migration: automations + automation_logs (Sprint 18.8 SQLite removal)
-- Never existed in Supabase; automation.js's rule engine has always crashed
-- via getDatabase(). Also currently has zero frontend callers (no UI) --
-- fixing the backend for consistency, but this needs a UI to be reachable.

CREATE TABLE IF NOT EXISTS public.automations (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  trigger_type text NOT NULL,
  trigger_config text DEFAULT '{}',
  action_type text NOT NULL,
  action_config text DEFAULT '{}',
  is_active boolean DEFAULT true,
  last_run timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.automation_logs (
  id bigserial PRIMARY KEY,
  automation_id bigint REFERENCES public.automations(id) ON DELETE CASCADE,
  case_id bigint REFERENCES public.cases(id) ON DELETE CASCADE,
  status text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_automation ON public.automation_logs(automation_id);
CREATE INDEX IF NOT EXISTS idx_automation_logs_case ON public.automation_logs(case_id);
