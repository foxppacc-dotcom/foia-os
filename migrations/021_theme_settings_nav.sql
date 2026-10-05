-- "الألوان والثيم" moved out of the الإعدادات tab bar and into its own
-- sidebar-linked page (route /theme-settings), same treatment already given
-- to "إدارة قوائم الإنتاج": seeded into nav_layout at the bottom of the
-- sidebar, and pre-granted to the manager role so it doesn't reproduce the
-- "new nav key defaults to hidden once a role has any nav.* rows" issue
-- already fixed once this session for cases/agencies/production and again
-- for production_lists.
INSERT INTO public.nav_layout (nav_key, location, sort_order) VALUES
  ('theme_settings', 'sidebar', 16)
ON CONFLICT (nav_key) DO NOTHING;

INSERT INTO public.role_permissions (role, resource, action, allowed) VALUES
  ('manager', 'nav', 'theme_settings', true)
ON CONFLICT (role, resource, action) DO NOTHING;
