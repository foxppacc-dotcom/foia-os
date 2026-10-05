-- Requested by the user: let the AI assistant (and the Agencies tab) filter
-- requests by what an agency actually DID in response -- sent records, said
-- there are none, rejected the request, asked for payment first, or hasn't
-- responded yet. This is a genuinely new concept, distinct from the two
-- fields that already use the word "classification" in this codebase:
--   - requests.status ('pending'/'sent'/'responded') is a coarse WORKFLOW
--     state (did we send it, did anything come back at all), not an outcome.
--   - requests.agency_classification ('arrest'/'investigation'/'both')
--     classifies the AGENCY'S ROLE in the case, unrelated to how it replied.
-- Named reply_outcome (not "status" or "classification") specifically to
-- avoid colliding with either of those existing concepts.
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS reply_outcome text NOT NULL DEFAULT 'pending';

ALTER TABLE public.requests DROP CONSTRAINT IF EXISTS requests_reply_outcome_check;
ALTER TABLE public.requests ADD CONSTRAINT requests_reply_outcome_check
  CHECK (reply_outcome IN ('pending', 'records_received', 'no_records', 'rejected', 'payment_requested'));

CREATE INDEX IF NOT EXISTS idx_requests_reply_outcome ON public.requests(reply_outcome);
