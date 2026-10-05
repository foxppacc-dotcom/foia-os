-- FOIA OS Migration: expected response deadline tracking for requests
-- Lets the investigator set an expected-response window when sending an
-- email (1/2/3/7/14/30 days or custom), so overdue agencies can be
-- surfaced automatically instead of tracked manually.

ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS expected_response_date date;
CREATE INDEX IF NOT EXISTS idx_requests_expected_response ON public.requests(expected_response_date);
