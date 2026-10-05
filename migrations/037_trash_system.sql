-- Trash / Recycle Bin: one convention (deleted_at + deleted_by) added to
-- every table whose DELETE route is being converted from an immediate hard
-- delete to a restorable soft-delete. Mirrors the existing revoked_at/
-- archived_at style already used elsewhere in this codebase, deliberately
-- distinct from unrelated is_active/archived booleans (those mean
-- something else and must never be conflated with trash state).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cases','requests','case_documents','case_comments','communications',
    'case_assignees','case_agency_channels','case_records_checklist','production_queue',
    'agencies','forum_topics','forum_comments','users','teams','roles',
    'case_team_roles','departments','portal_credentials','email_accounts',
    'intake_criteria_definitions','phone_logs','mail_logs','automations',
    'ai_provider_configs','checklist_templates','pipeline_lists'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deleted_at timestamptz', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deleted_by bigint REFERENCES public.users(id) ON DELETE SET NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_deleted_at ON public.%I(deleted_at)', t, t);
  END LOOP;
END $$;

-- case_documents was assumed to already have a dormant `is_deleted` boolean
-- (written once by documentCenter.js's old soft-delete route, read nowhere)
-- -- confirmed on this database that column was never actually added in the
-- first place (same "migration file existed but was never run" class of bug
-- seen elsewhere in this codebase), so there's nothing to backfill. Guarded
-- with a column-existence check instead of assuming, so this migration
-- stays safe to re-run regardless of which environment it hits.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'case_documents' AND column_name = 'is_deleted'
  ) THEN
    UPDATE public.case_documents SET deleted_at = now() WHERE is_deleted = true AND deleted_at IS NULL;
  END IF;
END $$;
