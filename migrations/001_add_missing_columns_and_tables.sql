-- FOIA OS Migration: Add missing columns and tables
-- Run in Supabase Dashboard → SQL Editor

-- =============================================
-- 1. ADD MISSING COLUMNS
-- =============================================

-- Users: avatar_url
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url text;

-- Users: job_title
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS job_title text;

-- Cases: case_number
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS case_number text;

-- Case Assignees: role_type (for flexible role assignment)
ALTER TABLE public.case_assignees ADD COLUMN IF NOT EXISTS role_type text DEFAULT 'member';

-- Case Assignees: custom_role_name
ALTER TABLE public.case_assignees ADD COLUMN IF NOT EXISTS custom_role_name text;

-- =============================================
-- 2. CREATE MISSING TABLES
-- =============================================

-- Notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  is_read boolean DEFAULT false,
  type text,
  title text,
  body text,
  created_at timestamptz DEFAULT now()
);

-- Attendance Logs table
CREATE TABLE IF NOT EXISTS public.attendance_logs (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT now(),
  check_in timestamptz,
  check_out timestamptz,
  status text DEFAULT 'present',
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Case Records Checklist table (for document audit tracking)
CREATE TABLE IF NOT EXISTS public.case_records_checklist (
  id bigserial PRIMARY KEY,
  case_id bigint NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  record_type text NOT NULL,
  record_name text,
  status text DEFAULT 'pending',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(case_id, record_type)
);

-- =============================================
-- 3. PERFORMANCE INDEXES
-- =============================================

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_attendance_user ON public.attendance_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_case_assignees_case ON public.case_assignees(case_id);
CREATE INDEX IF NOT EXISTS idx_case_assignees_user ON public.case_assignees(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_case ON public.requests(case_id);
CREATE INDEX IF NOT EXISTS idx_case_docs_case ON public.case_documents(case_id);
CREATE INDEX IF NOT EXISTS idx_activity_target ON public.activity_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_checklist_case ON public.case_records_checklist(case_id);

-- =============================================
-- 4. GRANT PERMISSIONS
-- =============================================

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_records_checklist ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access
CREATE POLICY "Authenticated users can manage notifications" ON public.notifications
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage attendance" ON public.attendance_logs
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage checklist" ON public.case_records_checklist
  FOR ALL USING (auth.role() = 'authenticated');
