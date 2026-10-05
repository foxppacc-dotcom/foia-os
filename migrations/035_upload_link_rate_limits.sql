-- Vercel serverless functions don't share in-process memory across
-- instances/cold starts, so express-rate-limit's default in-memory store
-- (used by fileFetch.js's publicUploadLimiter) is effectively decorative in
-- production -- each instance counts independently and resets on every cold
-- start. This table backs a real, centrally-enforced per-token rate limit.
CREATE TABLE IF NOT EXISTS public.upload_link_rate_limits (
  token text PRIMARY KEY REFERENCES public.case_upload_links(token) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0
);
