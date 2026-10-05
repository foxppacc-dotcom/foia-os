-- FOIA OS Migration: attachment support for case_comments (team discussion
-- section in the case Overview tab). Run manually in Supabase Dashboard ->
-- SQL Editor (same as 001-012).
--
-- Flat columns rather than a JSON metadata blob, matching this table's
-- existing style (case_comments has never used a metadata column, unlike
-- communications). attachment_type is one of 'image' | 'file' | 'link'.

ALTER TABLE public.case_comments
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_type text,
  ADD COLUMN IF NOT EXISTS attachment_name text;
