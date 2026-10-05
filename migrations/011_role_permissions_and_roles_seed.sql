-- FOIA OS Migration: role_permissions table (activates the Permissions tab,
-- which has been fully built and wired in the frontend/backend but always
-- 400s today because this table doesn't exist) + seed the role vocabulary
-- actually used by the app's real authorization logic (App.jsx canAccess,
-- backend permissions.js, users.role) into the existing-but-disconnected
-- `roles` table.
-- Run manually in Supabase Dashboard -> SQL Editor.

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (role, resource, action)
);

-- role names must be unique so app code (dynamic role validation, the
-- permissions matrix) can look them up reliably.
ALTER TABLE public.roles ADD CONSTRAINT roles_name_unique UNIQUE (name);

-- Seed the 5 roles actually referenced by canAccess()/permissions.js, plus
-- 'member' for backward compatibility with existing users.role='member'
-- rows. The pre-existing administrator/senior_investigator rows are left
-- as-is (harmless, and now manageable/deletable from the new Roles tab)
-- since nothing in the codebase reads them.
INSERT INTO public.roles (name, label, permissions, sort_order) VALUES
  ('admin', 'مدير النظام', '{}'::jsonb, 1),
  ('agent', 'وكيل', '{}'::jsonb, 3),
  ('editor', 'محرر', '{}'::jsonb, 4),
  ('viewer', 'مشاهد', '{}'::jsonb, 5),
  ('member', 'عضو', '{}'::jsonb, 6)
ON CONFLICT (name) DO NOTHING;

-- Default permission values matching the CURRENT hardcoded requireRole(...)
-- behavior across the backend, so activating this table doesn't silently
-- change anyone's existing access on day one -- these are starting values
-- an admin can then adjust from the Permissions tab.
INSERT INTO public.role_permissions (role, resource, action, allowed) VALUES
  ('manager','cases','view',true), ('manager','cases','create',true), ('manager','cases','edit',true), ('manager','cases','delete',true),
  ('manager','agencies','view',true), ('manager','agencies','create',true), ('manager','agencies','edit',true), ('manager','agencies','delete',false),
  ('manager','pipeline','view',true), ('manager','pipeline','move',true), ('manager','pipeline','edit',true),
  ('manager','production','view',true), ('manager','production','edit',true),
  ('manager','reports','view',true), ('manager','reports','export',true),
  ('manager','settings','view',true), ('manager','settings','manage',true),
  ('manager','users','invite',true), ('manager','users','edit',false), ('manager','users','delete',false),
  ('manager','email_accounts','manage',true),

  ('agent','cases','view',true), ('agent','cases','create',true), ('agent','cases','edit',true), ('agent','cases','delete',false),
  ('agent','agencies','view',true), ('agent','agencies','create',false), ('agent','agencies','edit',false), ('agent','agencies','delete',false),
  ('agent','pipeline','view',false), ('agent','pipeline','move',false), ('agent','pipeline','edit',false),
  ('agent','production','view',false), ('agent','production','edit',false),
  ('agent','reports','view',false), ('agent','reports','export',false),
  ('agent','settings','view',false), ('agent','settings','manage',false),
  ('agent','users','invite',false), ('agent','users','edit',false), ('agent','users','delete',false),
  ('agent','email_accounts','manage',false),

  ('editor','cases','view',true), ('editor','cases','create',false), ('editor','cases','edit',false), ('editor','cases','delete',false),
  ('editor','agencies','view',false), ('editor','agencies','create',false), ('editor','agencies','edit',false), ('editor','agencies','delete',false),
  ('editor','pipeline','view',false), ('editor','pipeline','move',false), ('editor','pipeline','edit',false),
  ('editor','production','view',true), ('editor','production','edit',true),
  ('editor','reports','view',false), ('editor','reports','export',false),
  ('editor','settings','view',false), ('editor','settings','manage',false),
  ('editor','users','invite',false), ('editor','users','edit',false), ('editor','users','delete',false),
  ('editor','email_accounts','manage',false),

  ('viewer','cases','view',true), ('viewer','cases','create',false), ('viewer','cases','edit',false), ('viewer','cases','delete',false),
  ('viewer','agencies','view',false), ('viewer','agencies','create',false), ('viewer','agencies','edit',false), ('viewer','agencies','delete',false),
  ('viewer','pipeline','view',true), ('viewer','pipeline','move',false), ('viewer','pipeline','edit',false),
  ('viewer','production','view',false), ('viewer','production','edit',false),
  ('viewer','reports','view',true), ('viewer','reports','export',false),
  ('viewer','settings','view',false), ('viewer','settings','manage',false),
  ('viewer','users','invite',false), ('viewer','users','edit',false), ('viewer','users','delete',false),
  ('viewer','email_accounts','manage',false)
ON CONFLICT (role, resource, action) DO NOTHING;
