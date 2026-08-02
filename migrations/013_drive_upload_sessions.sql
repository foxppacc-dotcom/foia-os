-- FOIA OS Migration 013: drive upload sessions (resume support)
-- Run manually in Supabase Dashboard -> SQL Editor.
-- Lets large-file uploads survive network drops: the browser registers a
-- Drive resumable session here; on retry it asks Google "how far did we
-- get?" and resumes from that byte offset instead of re-uploading from 0.
-- After a successful finalize the row is deleted (or marked complete).

CREATE TABLE IF NOT EXISTS public.drive_upload_sessions (
  id SERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type TEXT,
  category TEXT DEFAULT 'attachments',
  folder_id TEXT NOT NULL,
  session_url TEXT NOT NULL,
  uploaded_bytes BIGINT DEFAULT 0,
  status TEXT DEFAULT 'active',          -- active | complete | expired
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (case_id, file_name, file_size)
);

CREATE INDEX IF NOT EXISTS idx_drive_sessions_active
  ON public.drive_upload_sessions(case_id, file_name) WHERE status = 'active';
