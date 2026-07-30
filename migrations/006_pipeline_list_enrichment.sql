-- FOIA OS Migration 006: Pipeline List Enrichment
-- Run in Supabase Dashboard → SQL Editor

-- Add rich fields to pipeline_lists
ALTER TABLE IF EXISTS public.pipeline_lists 
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS icon text DEFAULT 'circle',
  ADD COLUMN IF NOT EXISTS sla_days integer DEFAULT 20,
  ADD COLUMN IF NOT EXISTS reminder_days integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS responsible_team_id bigint REFERENCES public.teams(id) ON DELETE SET NULL;

-- Ensure list_assignees table exists for per-list employee assignments
CREATE TABLE IF NOT EXISTS public.list_assignees (
  id bigserial PRIMARY KEY,
  list_id bigint NOT NULL REFERENCES public.pipeline_lists(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(list_id, user_id)
);

ALTER TABLE public.list_assignees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all" ON public.list_assignees FOR ALL USING (auth.role() = 'authenticated');

-- Create index for assignee lookups
CREATE INDEX IF NOT EXISTS idx_list_assignees_list ON public.list_assignees(list_id);
CREATE INDEX IF NOT EXISTS idx_list_assignees_user ON public.list_assignees(user_id);

-- Grant permissions
GRANT ALL ON public.pipeline_lists TO authenticated;
GRANT ALL ON public.list_assignees TO authenticated;
