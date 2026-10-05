-- FOIA OS - Missing Tables & Columns Migration

-- Users columns
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS job_title text;

-- Cases columns
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS case_number text;

-- Case assignees columns
ALTER TABLE public.case_assignees ADD COLUMN IF NOT EXISTS role_type text DEFAULT 'member';
ALTER TABLE public.case_assignees ADD COLUMN IF NOT EXISTS custom_role_name text;

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
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications(user_id, is_read);

-- Attendance logs table
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
CREATE INDEX IF NOT EXISTS idx_attendance_user ON public.attendance_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance_logs(user_id, date);

-- Case records checklist table
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
CREATE INDEX IF NOT EXISTS idx_checklist_case ON public.case_records_checklist(case_id);

-- More indexes
CREATE INDEX IF NOT EXISTS idx_case_assignees_case ON public.case_assignees(case_id);
CREATE INDEX IF NOT EXISTS idx_case_assignees_user ON public.case_assignees(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_target ON public.activity_logs(target_type, target_id);