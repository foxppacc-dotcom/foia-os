-- FOIA OS Migration: Email engine unification (Sprint 18.8 Phase 2)
-- Fixes schema drift: supabase/sprint-15-documents-email.sql and sprint-15-tables.sql
-- both used `CREATE TABLE IF NOT EXISTS email_accounts` with a different column set
-- than the one that actually created the table (supabase_migration.sql), so those
-- columns silently never got added. Adding them here via idempotent ALTER TABLE.

ALTER TABLE public.email_accounts ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.email_accounts ADD COLUMN IF NOT EXISTS signature text;
ALTER TABLE public.email_accounts ADD COLUMN IF NOT EXISTS smtp_secure boolean DEFAULT true;
ALTER TABLE public.email_accounts ADD COLUMN IF NOT EXISTS imap_secure boolean DEFAULT true;
ALTER TABLE public.email_accounts ADD COLUMN IF NOT EXISTS default_sender boolean DEFAULT false;
ALTER TABLE public.email_accounts ADD COLUMN IF NOT EXISTS agency_id bigint REFERENCES public.agencies(id) ON DELETE SET NULL;
ALTER TABLE public.email_accounts ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
ALTER TABLE public.email_accounts ADD COLUMN IF NOT EXISTS last_checked timestamptz;

-- Indexes for the mailPoller dedup/matching queries (message_id lookup on every
-- fetched message, thread_id lookup for reply matching) — previously unindexed.
CREATE INDEX IF NOT EXISTS idx_communications_message_id ON public.communications(message_id);
CREATE INDEX IF NOT EXISTS idx_communications_thread_id ON public.communications(thread_id);
CREATE INDEX IF NOT EXISTS idx_communications_case_id ON public.communications(case_id);
