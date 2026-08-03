-- FOIA OS Migration 015: Navigation & Production Line visibility defaults
-- Run manually in Supabase Dashboard -> SQL Editor.
--
-- Adds two NEW visibility dimensions to the existing role_permissions table
-- (no schema change — same role/resource/action/allowed shape):
--   resource='nav'             action=<sidebar key>   (لوحة التحكم, القضايا, ...)
--   resource='production_line' action=<list_number>   (1..7)
--
-- Default: EVERYTHING visible for every existing role, so enabling this
-- feature changes nothing for anyone on day one. Admins then fine-tune
-- per role from TeamPermissions -> الصلاحيات -> رؤية القائمة الجانبية /
-- رؤية خط الإنتاج. Admin itself is wildcard and never needs rows.
--
-- NOTE: even without this seed, /permissions/mine treats a role with NO
-- visibility rows as "all visible" — this seed just makes the toggles
-- explicit and pre-populates the admin UI for existing roles.

INSERT INTO public.role_permissions (role, resource, action, allowed) VALUES
  ('manager','nav','dashboard',true), ('manager','nav','intake',true),
  ('manager','nav','cases',true), ('manager','nav','pipeline',true),
  ('manager','nav','production',true), ('manager','nav','agencies',true),
  ('manager','nav','portals',true), ('manager','nav','inbox',true),
  ('manager','nav','email_accounts',true), ('manager','nav','teams',true),
  ('manager','nav','permissions',true), ('manager','nav','gdrive',true),
  ('manager','nav','phone_logs',true), ('manager','nav','mail_logs',true),
  ('manager','production_line','1',true), ('manager','production_line','2',true),
  ('manager','production_line','3',true), ('manager','production_line','4',true),
  ('manager','production_line','5',true), ('manager','production_line','6',true),
  ('manager','production_line','7',true),

  ('agent','nav','dashboard',true), ('agent','nav','intake',true),
  ('agent','nav','cases',true), ('agent','nav','pipeline',true),
  ('agent','nav','production',true), ('agent','nav','agencies',true),
  ('agent','nav','portals',true), ('agent','nav','inbox',true),
  ('agent','nav','email_accounts',true), ('agent','nav','teams',true),
  ('agent','nav','permissions',true), ('agent','nav','gdrive',true),
  ('agent','nav','phone_logs',true), ('agent','nav','mail_logs',true),
  ('agent','production_line','1',true), ('agent','production_line','2',true),
  ('agent','production_line','3',true), ('agent','production_line','4',true),
  ('agent','production_line','5',true), ('agent','production_line','6',true),
  ('agent','production_line','7',true),

  ('editor','nav','dashboard',true), ('editor','nav','intake',true),
  ('editor','nav','cases',true), ('editor','nav','pipeline',true),
  ('editor','nav','production',true), ('editor','nav','agencies',true),
  ('editor','nav','portals',true), ('editor','nav','inbox',true),
  ('editor','nav','email_accounts',true), ('editor','nav','teams',true),
  ('editor','nav','permissions',true), ('editor','nav','gdrive',true),
  ('editor','nav','phone_logs',true), ('editor','nav','mail_logs',true),
  ('editor','production_line','1',true), ('editor','production_line','2',true),
  ('editor','production_line','3',true), ('editor','production_line','4',true),
  ('editor','production_line','5',true), ('editor','production_line','6',true),
  ('editor','production_line','7',true),

  ('viewer','nav','dashboard',true), ('viewer','nav','intake',true),
  ('viewer','nav','cases',true), ('viewer','nav','pipeline',true),
  ('viewer','nav','production',true), ('viewer','nav','agencies',true),
  ('viewer','nav','portals',true), ('viewer','nav','inbox',true),
  ('viewer','nav','email_accounts',true), ('viewer','nav','teams',true),
  ('viewer','nav','permissions',true), ('viewer','nav','gdrive',true),
  ('viewer','nav','phone_logs',true), ('viewer','nav','mail_logs',true),
  ('viewer','production_line','1',true), ('viewer','production_line','2',true),
  ('viewer','production_line','3',true), ('viewer','production_line','4',true),
  ('viewer','production_line','5',true), ('viewer','production_line','6',true),
  ('viewer','production_line','7',true),

  ('member','nav','dashboard',true), ('member','nav','intake',true),
  ('member','nav','cases',true), ('member','nav','pipeline',true),
  ('member','nav','production',true), ('member','nav','agencies',true),
  ('member','nav','portals',true), ('member','nav','inbox',true),
  ('member','nav','email_accounts',true), ('member','nav','teams',true),
  ('member','nav','permissions',true), ('member','nav','gdrive',true),
  ('member','nav','phone_logs',true), ('member','nav','mail_logs',true),
  ('member','production_line','1',true), ('member','production_line','2',true),
  ('member','production_line','3',true), ('member','production_line','4',true),
  ('member','production_line','5',true), ('member','production_line','6',true),
  ('member','production_line','7',true)
ON CONFLICT (role, resource, action) DO NOTHING;
