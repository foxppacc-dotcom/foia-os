-- Catalog of job titles ("مسميات وظيفية") offered when assigning an employee
-- to a case's investigation team. Previously hardcoded in the frontend
-- (TeamTab.jsx's INVESTIGATION_ROLES) with no way for an admin to add,
-- rename, or remove one -- now editable from فريق العمل settings.
CREATE TABLE IF NOT EXISTS public.case_team_roles (
  id SERIAL PRIMARY KEY,
  value TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#636366',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with the exact set that was previously hardcoded, so existing
-- case_assignees.role values keep resolving to the same label/color.
INSERT INTO public.case_team_roles (value, label, color, sort_order) VALUES
  ('lead_investigator', 'محقق رئيسي', '#3b82f6', 1),
  ('investigator', 'محقق', '#8b5cf6', 2),
  ('researcher', 'باحث', '#22c55e', 3),
  ('legal_reviewer', 'مراجع قانوني', '#ef4444', 4),
  ('producer', 'منتج', '#eab308', 5),
  ('viewer', 'مشاهد', '#636366', 6),
  ('observer', 'مراقب', '#636366', 7)
ON CONFLICT (value) DO NOTHING;
