-- FOIA OS Migration 012: document source column (manual vs email)
-- Run manually in Supabase Dashboard -> SQL Editor.
-- Lets the Files tab show where each document came from:
--   'manual' (default) — uploaded by a user in the Documents tab
--   'email'            — received/sent as an email attachment (mailPoller / compose)

ALTER TABLE public.case_documents ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
CREATE INDEX IF NOT EXISTS idx_case_documents_source ON public.case_documents(source);
