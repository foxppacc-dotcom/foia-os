-- Per-employee mailbox access: restrict which email_accounts a given user
-- may see/use, independent of which cases they're assigned to. Mirrors the
-- existing list_assignees (user_id <-> pipeline_lists) shape exactly --
-- same simple full-replace join table, no soft-delete needed (an unassigned
-- mailbox just stops being visible, there's nothing to "restore").
--
-- Whether this restriction even APPLIES to a role is a separate toggle,
-- resource='email_accounts' action='view_all' in the already-existing
-- role_permissions table (same convention as cases.view_all --
-- services/caseAccess.js's canViewAllCases). No rows are seeded here on
-- purpose: role_permissions with no matching row already defaults to
-- unrestricted (see canViewAllCases's own comment), so activating this
-- migration changes nothing for anyone until an admin explicitly flips
-- email_accounts:view_all to false for a role from the Permissions tab and
-- then assigns specific mailboxes to specific employees.
CREATE TABLE IF NOT EXISTS public.employee_email_accounts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_account_id BIGINT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(user_id, email_account_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_email_accounts_user ON public.employee_email_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_employee_email_accounts_account ON public.employee_email_accounts(email_account_id);

-- This self-hosted stack's PostgREST talks to Postgres as `web_anon` (see
-- the VPS migration plan: no PGRST_JWT_SECRET, every request uses
-- PGRST_DB_ANON_ROLE, real authorization lives in Express middleware, not
-- Postgres RLS) -- a brand new table has no privileges for that role until
-- explicitly granted, unlike Supabase Cloud where this is automatic. Every
-- existing table (cases, email_accounts, ...) already carries this same
-- grant; forgetting it here surfaces as a confusing PostgREST "permission
-- denied for table" on every insert/update/delete against it.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_email_accounts TO web_anon;
GRANT USAGE, SELECT ON SEQUENCE public.employee_email_accounts_id_seq TO web_anon;
