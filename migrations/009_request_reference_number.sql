-- FOIA OS Migration: agency-assigned reference/tracking number per request
-- Lets inbound emails auto-match to the right case even when the agency
-- replies from a different address than the one on file, as long as they
-- quote the reference number they themselves assigned to the request.

ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS reference_number text;
CREATE INDEX IF NOT EXISTS idx_requests_reference_number ON public.requests(reference_number);
