-- FOIA OS Migration: additional Agency fields (website, tracking portal)
-- Run manually in Supabase Dashboard -> SQL Editor (same as 001-003).
-- The backend already tolerates these columns being absent (graceful
-- fallback strips them from insert/update until this migration runs).

ALTER TABLE public.agencies ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE public.agencies ADD COLUMN IF NOT EXISTS tracking_portal_url text;
