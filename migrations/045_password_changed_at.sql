-- Closes a real gap found in this session's security audit: requireAuth
-- (middleware/auth.js) re-checks role/is_active on every request, but a
-- password reset/change had NO effect on a token already issued -- an
-- attacker holding a stolen JWT kept working for up to its full 24h
-- lifetime even after the compromised password was changed, defeating the
-- one incident-response action an admin would actually take.
--
-- password_changed_at, compared against the JWT's own `iat` claim in
-- requireAuth, lets any token issued BEFORE the most recent password change
-- be rejected immediately. Backfilled to created_at (not NULL, not now())
-- so this migration itself doesn't force-logout the whole company on
-- deploy day -- only a genuine password change from this point forward
-- invalidates anything.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
UPDATE public.users SET password_changed_at = created_at WHERE password_changed_at IS NULL;
