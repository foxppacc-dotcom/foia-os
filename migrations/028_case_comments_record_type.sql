-- Lets one comment thread (case_comments) serve BOTH the case-wide "نقاش
-- الفريق" (record_type IS NULL) and a per-checklist-item notes feed
-- (record_type = the checklist's record_type, e.g. 'body_cam') without a
-- separate table -- same reply/mention/attachment/delete rules apply to
-- both, just scoped by this one extra column.
ALTER TABLE public.case_comments ADD COLUMN IF NOT EXISTS record_type text;
CREATE INDEX IF NOT EXISTS idx_case_comments_record_type ON public.case_comments(case_id, record_type);
