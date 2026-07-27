-- FOIA OS — Database Migration
-- Run this in Supabase Dashboard → SQL Editor
-- Date: 2026-07-17
-- Adds missing columns for production deployment

-- === REQUESTS TABLE ===
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS agency_classification text;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS storage_key text;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS url text;

-- === CASE DOCUMENTS TABLE ===
ALTER TABLE public.case_documents ADD COLUMN IF NOT EXISTS file_type text;
ALTER TABLE public.case_documents ADD COLUMN IF NOT EXISTS storage_key text;
ALTER TABLE public.case_documents ADD COLUMN IF NOT EXISTS url text;

-- === CHECKLIST TABLE ===
ALTER TABLE public.case_records_checklist ADD COLUMN IF NOT EXISTS doc_status text DEFAULT 'pending';
ALTER TABLE public.case_records_checklist ADD COLUMN IF NOT EXISTS receipt_status text DEFAULT '';

-- === CASE ASSIGNEES ===
ALTER TABLE public.case_assignees ADD COLUMN IF NOT EXISTS storage_key text;

-- === USERS TABLE ===
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_storage_key text;

-- === STORAGE BUCKETS ===
-- These will be auto-created by the backend on first start:
--   case-documents (private)
--   intake-files (private)
--   agency-files (private)
--   public (public)

SELECT '✅ Migration completed successfully' AS status;
