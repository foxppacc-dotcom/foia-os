-- FOIA OS Migration: communications.is_read was never a real column
-- Confirmed by grepping every prior migration file plus supabase_migration.sql --
-- it only ever existed on the `notifications` table. mailPoller.js,
-- documentCenter.js's /inbox routes (unread filter, unread-count, archive)
-- all read/write communications.is_read and have been failing on every
-- single inbound insert with "Could not find the 'is_read' column of
-- 'communications' in the schema cache" ever since the email engine was
-- unified onto mailPoller as the one insert path (the old, now-removed
-- dual-pipeline code happened to never reference this column, which is why
-- inbound mail appeared to work before that fix).

ALTER TABLE public.communications ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_communications_is_read ON public.communications(is_read);
