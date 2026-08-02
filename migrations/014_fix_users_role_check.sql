-- FOIA OS Migration 014: fix users.role CHECK constraint (stale role whitelist)
-- Run manually in Supabase Dashboard -> SQL Editor.
--
-- Problem: the `users` table had an OLD CHECK constraint (users_role_check)
-- limiting role to ('admin','manager','member') — created before the dynamic
-- roles system (migration 011). The Roles tab / Permissions tab let admins
-- pick agent/editor/viewer, and /roles (teamManagement.js) validates against
-- the live roles table, BUT every write of those roles to users.role was
-- rejected by the DB with SQLSTATE 23514 (check_violation). Symptom: PUT
-- /api/users/:id returned success while the role silently stayed unchanged.
--
-- Fix: drop the stale constraint and re-create it with the full role set
-- (mirrors what migration 011 seeded into the roles table). The backend
-- already validates against the roles table before writing, so this whitelist
-- is a secondary guard only.

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','manager','agent','editor','viewer','member'));

-- Optional sanity: confirm the constraint definition now reads the new list:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.users'::regclass AND contype = 'c';
