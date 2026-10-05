-- Fixes the duplicate-email bug at its data layer (app-side fix already
-- deployed separately in mailPoller.js) and lays the groundwork for
-- match-reason transparency + a self-service matching-criteria panel.

-- 1. Clean up existing duplicate rows BEFORE adding the unique index below,
-- or the index creation would fail immediately against them. Keeps the
-- earliest (lowest id) row per message_id, deletes the rest. Confirmed live
-- (2026-08-22): 4 message_ids each duplicated exactly 16x, 60 extra rows
-- total, all identical subject/sender/case_id/created_at per cluster -- safe
-- to delete the extras with nothing lost.
DELETE FROM public.communications a
USING public.communications b
WHERE a.message_id IS NOT NULL
  AND a.message_id = b.message_id
  AND a.id > b.id;

-- 2. The actual root-cause guarantee against duplicates -- an in-process
-- lock (mailPoller.js) only protects one warm server instance; this is what
-- makes a duplicate impossible even under true cross-instance concurrency.
-- Partial (WHERE message_id IS NOT NULL) since outbound/manually-composed
-- rows may legitimately have no message_id.
CREATE UNIQUE INDEX IF NOT EXISTS communications_message_id_unique
  ON public.communications (message_id)
  WHERE message_id IS NOT NULL;

-- 3. Records WHY a communication got linked to its case -- previously only
-- computed for the ambiguous/unresolved case (possible_matches) and thrown
-- away the moment a link was confirmed. tier_key matches
-- email_matching_criteria.tier_key below (or 'thread_reply'/'thread_references'/
-- 'manual' for the non-toggle-able structural tiers).
ALTER TABLE public.communications ADD COLUMN IF NOT EXISTS match_reason jsonb;

-- 4. One row per toggle-able matching heuristic. matchToCase() skips a
-- tier entirely when is_active is false. confirmed_count/rejected_count are
-- the "learning" signal surfaced in the admin panel -- not automatic, an
-- admin reads the ratio and decides whether to turn a noisy tier off.
CREATE TABLE IF NOT EXISTS public.email_matching_criteria (
  id serial PRIMARY KEY,
  tier_key text UNIQUE NOT NULL,
  label_ar text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  confirmed_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.email_matching_criteria (tier_key, label_ar, description) VALUES
  ('agency_email', 'عنوان بريد الجهة', 'الإيميل من عنوان جهة (أو أحد جهات الاتصال بها) له قضية واحدة مفتوحة فقط'),
  ('reference_number', 'رقم مرجعي', 'الرد يحتوي رقم مرجع سبق للنظام تسجيله لطلب معين'),
  ('case_number_subject', 'رقم القضية في الموضوع', 'رقم القضية مذكور صراحة في عنوان أو نص الرسالة'),
  ('fuzzy_title', 'تشابه عنوان القضية', 'عنوان إحدى القضايا المفتوحة موجود كنص داخل الرسالة'),
  ('fuzzy_defendant', 'تشابه اسم المتهم', 'اسم متهم إحدى القضايا المفتوحة موجود كنص داخل الرسالة'),
  ('fuzzy_agency_name', 'تشابه اسم الجهة', 'اسم جهة مرتبطة بقضية مفتوحة موجود كنص داخل الرسالة'),
  ('sender_continuity', 'استمرارية اسم المرسل', 'نفس الاسم قبل @ في عنوان بريد مختلف سبق أن راسل هذه القضية'),
  ('case_channel_email', 'قناة تواصل القضية (إيميل)', 'عنوان بريد مسجل يدويًا كقناة تواصل خاصة بقضية معينة'),
  ('case_channel_portal', 'قناة تواصل القضية (بوابة)', 'نطاق البوابة الإلكترونية المسجلة لقضية معينة'),
  ('case_channel_keywords', 'كلمات مفتاحية لقضية معينة', 'كلمة/عبارة مسجلة يدويًا كقناة تواصل خاصة بقضية معينة'),
  ('custom_keywords', 'كلمات مفتاحية عامة (مخصصة)', 'قواعد كلمات مفتاحية عامة أضافها المسؤول -- غير مرتبطة بجهة تواصل قضية بعينها')
ON CONFLICT (tier_key) DO NOTHING;

-- 5. Admin-added global keyword rules ("ضيف معيار فلترة" -- the self-service
-- ask). Unlike case_agency_channels.filter_keywords (scoped to one case's
-- registered agency channel), these apply system-wide. case_id is required
-- -- a keyword rule with nothing to point at can't do anything, so the
-- admin panel requires a case up front rather than accepting a rule that
-- would silently never match anything.
CREATE TABLE IF NOT EXISTS public.email_matching_custom_keywords (
  id serial PRIMARY KEY,
  keyword_phrase text NOT NULL,
  case_id integer NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
