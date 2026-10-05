-- Scopes uploaded documents and in-progress upload sessions to the specific
-- FileFetch link (case_upload_links) they came through, not just the case --
-- a case can have more than one link over its lifetime (a new one per
-- agency, or a replacement after revoking one), and "what did THIS link
-- already upload" needs its own answer distinct from the case's full
-- document list, to keep the public page's privacy boundary intact (it
-- exposes nothing about the case beyond its title today).
ALTER TABLE public.case_documents ADD COLUMN IF NOT EXISTS upload_link_id integer REFERENCES public.case_upload_links(id) ON DELETE SET NULL;
ALTER TABLE public.drive_upload_sessions ADD COLUMN IF NOT EXISTS upload_link_id integer REFERENCES public.case_upload_links(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_case_documents_upload_link ON public.case_documents(upload_link_id);
CREATE INDEX IF NOT EXISTS idx_drive_upload_sessions_upload_link ON public.drive_upload_sessions(upload_link_id);
