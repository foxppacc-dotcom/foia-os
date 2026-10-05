-- "معلومات تسجيل القضية" -- journalism/case-origin metadata recorded when a
-- case is created and shown in the case's overview (replacing the old
-- الهدف/السؤال/المرحلة summary card). Also referenced by
-- services/mailPoller.js's inbound-email-to-case matching (defendant_name
-- joins the existing case-title-in-subject heuristic).
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS defendant_name TEXT;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS source_agency_name TEXT;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS story_hook TEXT;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS article_url TEXT;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS case_summary TEXT;
