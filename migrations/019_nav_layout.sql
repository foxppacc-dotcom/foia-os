-- Global (not per-role) sidebar ordering + placement, configurable from
-- الإعدادات → ترتيب القائمة الجانبية. Independent from role_permissions'
-- nav.* rows (which control per-ROLE visibility) -- this table controls,
-- for everyone, the ORDER items appear in and whether an item lives in the
-- sidebar at all or only as a quick link inside الإعدادات.
CREATE TABLE IF NOT EXISTS public.nav_layout (
  nav_key TEXT PRIMARY KEY,
  location TEXT NOT NULL DEFAULT 'sidebar' CHECK (location IN ('sidebar', 'settings')),
  sort_order INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with the exact order the sidebar already rendered in (grouped
-- رئيسية / سير العمل / الإدارة, flattened), so nothing visually reshuffles
-- until an admin customizes it. production_lists is new -- it used to be a
-- tab inside الإعدادات ("📋 إدارة قوائم الإنتاج") and is now its own page;
-- seeded last per the request to place it at the bottom of the sidebar.
INSERT INTO public.nav_layout (nav_key, location, sort_order) VALUES
  ('dashboard', 'sidebar', 1),
  ('intake', 'sidebar', 2),
  ('cases', 'sidebar', 3),
  ('pipeline', 'sidebar', 4),
  ('production', 'sidebar', 5),
  ('agencies', 'sidebar', 6),
  ('portals', 'sidebar', 7),
  ('inbox', 'sidebar', 8),
  ('email_accounts', 'sidebar', 9),
  ('teams', 'sidebar', 10),
  ('permissions', 'sidebar', 11),
  ('gdrive', 'sidebar', 12),
  ('phone_logs', 'sidebar', 13),
  ('mail_logs', 'sidebar', 14),
  ('production_lists', 'sidebar', 15)
ON CONFLICT (nav_key) DO NOTHING;

-- Without this, the new 'production_lists' nav key would default to HIDDEN
-- for the manager role: any role with at least one existing nav.* row
-- already configured (manager has several) treats an unconfigured key as
-- hidden, not shown -- this reproduces the exact "permission says yes, link
-- says no" bug already fixed once this session for cases/agencies/production.
INSERT INTO public.role_permissions (role, resource, action, allowed) VALUES
  ('manager', 'nav', 'production_lists', true)
ON CONFLICT (role, resource, action) DO NOTHING;
