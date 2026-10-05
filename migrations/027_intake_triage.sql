ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS in_intake_review boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS intake_criteria jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS intake_source text;

CREATE TABLE IF NOT EXISTS public.intake_criteria_definitions (
  id serial PRIMARY KEY,
  key text UNIQUE NOT NULL,
  label_ar text NOT NULL,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

INSERT INTO public.intake_criteria_definitions (key, label_ar, sort_order) VALUES
  ('youtube_published', 'منشورة على يوتيوب', 1),
  ('has_witnesses', 'يوجد شهود', 2),
  ('has_victims', 'يوجد ضحايا', 3),
  ('accused_victim_relationship', 'علاقة بين المتهم والضحية', 4),
  ('has_twist', 'يوجد تويست في القضية', 5),
  ('arrest_on_bodycam', 'القبض تم أمام كاميرا الضباط', 6),
  ('has_investigation', 'يوجد تحقيق', 7)
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_cases_in_intake_review ON public.cases(in_intake_review);
