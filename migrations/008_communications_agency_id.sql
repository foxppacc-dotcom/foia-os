-- FOIA OS Migration: communications.agency_id was never a real column
-- Same pattern as is_read (migration 006) -- mailPoller.js's matching tiers
-- (agency email, agency_contacts email) set insertData.agency_id whenever a
-- match is found, but the column never existed, so any inbound email that
-- matched an agency (rather than falling through to no match) failed to
-- insert entirely with "Could not find the 'agency_id' column of
-- 'communications' in the schema cache". Went unnoticed earlier because
-- agency-email matches were rare until the agency_contacts matching tier
-- was added.

ALTER TABLE public.communications ADD COLUMN IF NOT EXISTS agency_id bigint REFERENCES public.agencies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_communications_agency_id ON public.communications(agency_id);
