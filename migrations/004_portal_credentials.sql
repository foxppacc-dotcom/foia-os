-- FOIA OS Migration: portal_credentials table (Sprint 18.8 SQLite removal)
-- This table was referenced by backend/src/routes/portals.js via local SQLite
-- and never existed in Supabase at all -- the Portals page has never worked
-- (its GET /api/portals call fails and the frontend silently shows an empty list).

CREATE TABLE IF NOT EXISTS public.portal_credentials (
  id bigserial PRIMARY KEY,
  agency_id bigint REFERENCES public.agencies(id) ON DELETE SET NULL,
  portal_name text NOT NULL,
  portal_url text,
  username text NOT NULL,
  password_encrypted text NOT NULL,
  registered_email text,
  notes text,
  is_active boolean DEFAULT true,
  last_used timestamptz,
  created_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_credentials_agency ON public.portal_credentials(agency_id);
