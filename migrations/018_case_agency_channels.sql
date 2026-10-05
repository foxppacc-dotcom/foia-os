-- Per-(case, agency) communication channel: a portal link, a specific email
-- address, and free-text filter keywords/phrases. Replaces the old generic
-- "جهة اتصال" (name/phone/title contact person) add-flow inside a case's
-- الجهات tab -- that older feature had zero effect on anything (it wrote to
-- agencies.notes JSON, which mailPoller.js never read), whereas this data
-- feeds directly into inbound-email-to-case auto-matching (see
-- backend/src/services/mailPoller.js).
CREATE TABLE IF NOT EXISTS public.case_agency_channels (
  id SERIAL PRIMARY KEY,
  case_id INT NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  agency_id INT NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  portal_link TEXT,
  email TEXT,
  filter_keywords TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_agency_channels_case ON public.case_agency_channels(case_id);
CREATE INDEX IF NOT EXISTS idx_case_agency_channels_agency ON public.case_agency_channels(agency_id);
CREATE INDEX IF NOT EXISTS idx_case_agency_channels_email ON public.case_agency_channels(email);
