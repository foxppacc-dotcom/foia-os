-- emailService.js's daily_limit enforcement was a plain read-then-write:
-- read sent_today at function entry, send via SMTP, re-read sent_today
-- "fresh" right before incrementing. That re-read narrows the race window
-- but doesn't close it -- two concurrent sendEmail() calls for the SAME
-- account can both do their "fresh" read at the same instant, both see
-- e.g. sent_today=9 (one below daily_limit=10), both pass the earlier
-- `sent_today >= daily_limit` gate (evaluated against an even staler value),
-- and both actually send -- exceeding daily_limit by design intent, with
-- one increment silently lost on top of that.
--
-- Same fix shape as migration 039's check_and_increment_upload_rate_limit:
-- do the check AND the increment as one atomic UPDATE, so concurrent calls
-- serialize at the row level in Postgres instead of racing in application
-- code. RETURNING + FOUND tells the caller whether a slot was actually
-- reserved (row matched sent_today < daily_limit) or the limit was already
-- hit (WHERE clause excluded the row, nothing updated).
CREATE OR REPLACE FUNCTION public.check_and_increment_email_daily_limit(
  p_account_id bigint
) RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.email_accounts
  SET sent_today = sent_today + 1
  WHERE id = p_account_id AND sent_today < daily_limit;
  RETURN FOUND;
END;
$$;

-- Reserving a slot happens BEFORE the actual SMTP send (so the reservation
-- itself is race-free) -- if the send then fails, the slot must be handed
-- back, since a failed send was never supposed to count against the daily
-- limit. GREATEST(...,0) guards against underflow if this is ever called
-- more than once for the same reservation.
CREATE OR REPLACE FUNCTION public.decrement_email_daily_count(
  p_account_id bigint
) RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.email_accounts SET sent_today = GREATEST(sent_today - 1, 0) WHERE id = p_account_id;
$$;

-- This self-hosted stack's PostgREST authenticates every request as
-- web_anon (no PGRST_JWT_SECRET, real authorization lives in Express
-- middleware) -- an RPC function needs an explicit EXECUTE grant for that
-- role or every .rpc() call 403s/errors, same gotcha as a brand-new table
-- (see memory: postgrest_new_table_grants).
GRANT EXECUTE ON FUNCTION public.check_and_increment_email_daily_limit(bigint) TO web_anon;
GRANT EXECUTE ON FUNCTION public.decrement_email_daily_count(bigint) TO web_anon;
