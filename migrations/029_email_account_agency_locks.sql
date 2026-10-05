-- Manual overrides for the (email_account, agency) -> case lock. The lock
-- itself is derived at query time from communications.email_account_id +
-- agency_id (any OTHER case already using that exact pair blocks a new one),
-- so no new column is needed there -- this table only stores the explicit
-- exceptions a permissioned user grants for a specific case.
CREATE TABLE IF NOT EXISTS public.email_account_agency_overrides (
  id serial PRIMARY KEY,
  email_account_id integer NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  agency_id integer NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  case_id integer NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(email_account_id, agency_id, case_id)
);

CREATE INDEX IF NOT EXISTS idx_email_account_agency_overrides_lookup
  ON public.email_account_agency_overrides (email_account_id, agency_id, case_id);
