-- The FileFetch public upload link's rate limiter (routes/fileFetch.js's
-- checkRateLimit) previously did a plain read-then-write against
-- upload_link_rate_limits: read request_count, then UPDATE it to count+1 in
-- a separate statement. Under genuinely concurrent requests (a scripted
-- burst, or several files' /session calls landing in the same instant) many
-- requests read roughly the same stale count before any write lands, so the
-- persisted counter barely advances no matter how many requests actually
-- got through -- since the in-memory express-rate-limit layer next to it is
-- already known to be decorative on Vercel's serverless model (each
-- instance has its own memory), this DB counter is the ONLY real
-- enforcement, and it didn't hold under concurrency.
--
-- A single UPSERT with the increment done AS the conflict-resolution
-- expression is atomic per row in Postgres (concurrent UPSERTs on the same
-- key serialize at the row level) -- no separate read step for a race to
-- land in between.
CREATE OR REPLACE FUNCTION public.check_and_increment_upload_rate_limit(
  p_token text,
  p_window_ms bigint,
  p_max integer
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.upload_link_rate_limits (token, window_started_at, request_count)
  VALUES (p_token, now(), 1)
  ON CONFLICT (token) DO UPDATE SET
    request_count = CASE
      WHEN now() - public.upload_link_rate_limits.window_started_at > (p_window_ms || ' milliseconds')::interval
        THEN 1
      ELSE public.upload_link_rate_limits.request_count + 1
    END,
    window_started_at = CASE
      WHEN now() - public.upload_link_rate_limits.window_started_at > (p_window_ms || ' milliseconds')::interval
        THEN now()
      ELSE public.upload_link_rate_limits.window_started_at
    END
  RETURNING request_count INTO v_count;
  RETURN v_count <= p_max;
END;
$$;
