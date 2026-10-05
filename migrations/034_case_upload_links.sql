-- FileFetch: public, token-based upload links external agencies can use to
-- submit files into a case's Drive folder with no login at all. Tokens
-- never expire on their own (product decision) -- revoked_at is the only
-- way one stops working, so the token itself must be strong (64 hex chars,
-- crypto.randomBytes(32)) and easy to kill from the Files tab.
CREATE TABLE IF NOT EXISTS public.case_upload_links (
  id serial PRIMARY KEY,
  case_id integer NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL,
  created_by integer REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  upload_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_case_upload_links_case_id ON public.case_upload_links(case_id);

-- Tags files that arrived through a FileFetch link rather than a logged-in
-- upload, so the Files tab can badge them distinctly. uploaded_by stays
-- NULL for these rows -- no user session exists for an external submitter.
ALTER TABLE public.case_documents ADD COLUMN IF NOT EXISTS upload_source text DEFAULT 'internal';
