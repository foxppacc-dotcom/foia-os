-- FOIA OS Migration: per-message review tracking + a real archive state for
-- صندوق البريد. Run manually in Supabase Dashboard -> SQL Editor (same as
-- 001-011).
--
-- reviewed_by/reviewed_at: "تم الفحص" button -- which employee reviewed a
-- given message, so far tracked nowhere in the schema at all.
--
-- is_archived/archived_at: PUT /inbox/:id/archive used to just set is_read
-- (a no-op alias, since opening the message already does that) -- there was
-- no actual archived state to filter the main list by. This makes it real.

ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS reviewed_by integer REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_communications_archived ON public.communications(is_archived);
CREATE INDEX IF NOT EXISTS idx_communications_reviewed_by ON public.communications(reviewed_by);
