-- Recurring AI-assistant tasks ("مهام المساعد الدورية"): the assistant runs these
-- by itself on a schedule on behalf of management and records what it found.
--   ai_recurring_tasks  -- the task definitions (sensor + playbook + schedule + autonomy)
--   ai_task_runs        -- one row per execution (summary, counts, steps)
--   ai_task_findings    -- the "needs attention" items; auto-resolved when the
--                          condition clears (i.e. the employee handled it)
--   ai_task_settings    -- small key/value config (concept -> pipeline-list map, ...)
CREATE TABLE IF NOT EXISTS public.ai_recurring_tasks (
  id BIGSERIAL PRIMARY KEY,
  sensor TEXT NOT NULL,                       -- stale_requests | payment_requests | confirmation_pending | orphan_replies | unhandled_replies | custom
  title TEXT NOT NULL,
  description TEXT,
  instructions TEXT,                          -- Arabic playbook given to the model
  schedule_type TEXT NOT NULL DEFAULT 'interval',   -- interval | daily
  interval_minutes INTEGER NOT NULL DEFAULT 360,
  run_at_time TEXT,                           -- 'HH:MM' for daily
  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
  enabled BOOLEAN NOT NULL DEFAULT true,
  autonomy TEXT NOT NULL DEFAULT 'propose',   -- report_only | propose | auto_followup
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'idle',        -- idle | running
  running_since TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  baseline_done BOOLEAN NOT NULL DEFAULT false,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.ai_task_runs (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES public.ai_recurring_tasks(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL DEFAULT 'schedule',   -- schedule | manual
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',     -- running | ok | failed | skipped
  candidates_count INTEGER NOT NULL DEFAULT 0,
  findings_new INTEGER NOT NULL DEFAULT 0,
  findings_updated INTEGER NOT NULL DEFAULT 0,
  findings_resolved INTEGER NOT NULL DEFAULT 0,
  llm_calls INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  error TEXT,
  steps JSONB
);
CREATE INDEX IF NOT EXISTS idx_ai_task_runs_task ON public.ai_task_runs (task_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_task_findings (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES public.ai_recurring_tasks(id) ON DELETE CASCADE,
  run_id BIGINT REFERENCES public.ai_task_runs(id) ON DELETE SET NULL,
  dedupe_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',   -- info | warning | critical
  severity_rank SMALLINT GENERATED ALWAYS AS (CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END) STORED,
  title TEXT NOT NULL,
  details TEXT,
  case_id BIGINT,
  request_id BIGINT,
  communication_id BIGINT,
  agency_id BIGINT,
  evidence JSONB,
  proposed_action JSONB,
  status TEXT NOT NULL DEFAULT 'open',        -- open | executed | dismissed | resolved | failed
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  times_seen INTEGER NOT NULL DEFAULT 1,
  resolved_at TIMESTAMPTZ,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_reason TEXT,                       -- auto | manual | executed | dismissed
  notified_at TIMESTAMPTZ,
  baseline BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (task_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_ai_task_findings_open ON public.ai_task_findings (status, severity, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_task_findings_case ON public.ai_task_findings (case_id) WHERE case_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ai_task_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_recurring_tasks, public.ai_task_runs, public.ai_task_findings, public.ai_task_settings TO web_anon;
GRANT USAGE, SELECT ON SEQUENCE public.ai_recurring_tasks_id_seq, public.ai_task_runs_id_seq, public.ai_task_findings_id_seq TO web_anon;

-- Ready-made tasks (owner = the first admin). All start in 'propose' mode: nothing
-- external happens without management's one-click approval.
INSERT INTO public.ai_recurring_tasks (sensor, title, description, instructions, schedule_type, interval_minutes, run_at_time, autonomy, config, owner_user_id)
SELECT v.sensor, v.title, v.description, v.instructions, v.schedule_type, v.interval_minutes, v.run_at_time, 'propose', v.config::jsonb,
       (SELECT id FROM public.users WHERE role = 'admin' AND deleted_at IS NULL ORDER BY id LIMIT 1)
FROM (VALUES
  ('stale_requests', 'متابعة الطلبات القديمة بلا رد',
   'طلبات تجاوزت موعد الرد المتوقع ولم يصل عليها أي رد: يشخّص السبب ويجهّز إيميل متابعة.',
   'لكل طلب مرشّح: افحص الحقائق المرفقة (أيام الانتظار، الرسائل الصادرة، وجود ارتداد/undeliverable، وجود إيميل أو بوابة للجهة). شخّص السبب الأرجح: إيميل مرتد أو خاطئ، الجهة تستقبل عبر البوابة فقط، لا يوجد إيميل للجهة، لم يُرسل الطلب أصلًا، أو ببساطة لم ترد الجهة بعد. إن كان الإرسال بالإيميل ممكنًا فاقترح إيميل متابعة مهذبًا بالإنجليزية يشير للطلب الأصلي. وإن كانت المشكلة في العنوان أو القناة فاشرح ما يجب على الموظف فعله بالتحديد.',
   'daily', 1440, '09:00',
   '{"fallback_days":14,"followup_cooldown_days":7,"max_candidates":25,"batch_size":5}'),
  ('payment_requests', 'التحقق من طلبات الدفع قبل الدفع',
   'قبل أي دفع: عدد الفيديوهات، الدقائق، بودي كام / غرفة تحقيق، وطريقة الدفع والاستلام وموعده.',
   E'في طلبات الدفع لازم نكون متأكدين من شوية حاجات قبل ما ندفع:\n1) عدد الفيديوهات اللي عندهم\n2) عدد الدقايق اللي عندهم\n3) أي الفيديوهات اللي عندهم فيديوهات بودي كام وغرفة تحقيق\n4) هندفع ازاي ونستلم ازاي وهنستلم امتى\nاقرأ آخر رد من الجهة ومرفقاته (الفاتورة/الخطاب) واستخرج كل بند من هذه البنود بدقة. ما لم يذكره الرد صراحةً اعتبره ناقصًا ولا تخمّنه. إن كانت هناك بنود ناقصة فاقترح إيميل استيضاح للجهة يطلبها بالتحديد، وإن اكتملت فاعرض القائمة كاملة بصفتها «جاهزة للدفع بانتظار موافقة الإدارة».',
   'interval', 360, NULL,
   '{"max_candidates":15,"batch_size":3}'),
  ('confirmation_pending', 'ردود طلب تأكيد السجلات المنسيّة',
   'ردود تطلب منا تأكيد/تحديد السجلات المطلوبة ولم يُرَدّ عليها.',
   'تحقق أن الرد الوارد فعلًا يطلب من الفريق تأكيد أو تحديد السجلات المطلوبة (أو إثبات مواطنة أو توضيحًا مماثلًا). إن كان كذلك فاكتب ملخصًا بما تطلبه الجهة بالتحديد، واقترح ردًا قصيرًا بالإنجليزية يؤكد السجلات المطلوبة. وإن لم يكن طلب تأكيد فعلًا فعلّم أنه غير مطلوب.',
   'interval', 120, NULL,
   '{"grace_hours":24,"max_candidates":20,"batch_size":5}'),
  ('orphan_replies', 'ردود وصلت بلا قضية في النظام',
   'ردود واردة غير مرتبطة بأي قضية: يحدد هل لها قضية موجودة أم تحتاج قضية جديدة.',
   'لكل رد وارد غير مرتبط: استخرج اسم الجهة، اسم الشخص/المتهم، أي رقم مرجعي. ابحث عن قضية مطابقة بأداة البحث. إن وجدت قضية مطابقة بثقة فاقترح ربط الرد بها. وإن لم توجد وكان الرد من جهة حكومية على طلب سجلات فاقترح إنشاء قضية جديدة (العنوان = اسم الشخص إن وُجد، الجهة المصدر = الجهة). وإن كان الإيميل غير ذي صلة (نشرة/إعلان/نظام) فاقترح أرشفته.',
   'interval', 60, NULL,
   '{"min_age_hours":2,"max_candidates":15,"batch_size":3}'),
  ('unhandled_replies', 'التأكد من تعامل الموظفين مع كل رد',
   'ردود وصلت على قضايا ولم يتعامل معها أحد أو لم يُنقل الطلب للقائمة المناسبة.',
   'لكل رد وارد مرتبط بقضية ولم يتعامل معه الموظفون: صنّف محتواه (سجلات/تقارير وصلت، لا توجد سجلات، رفض، طلب دفع، جهة خاطئة، طلب تأكيد، غير ذلك) ثم قارن بحالة الطلب الحالية والمستندات. حدّد بدقة الإجراء الناقص: هل رُفعت المرفقات كمستندات؟ هل الطلب في القائمة المناسبة؟ هل ضُبطت نتيجة الرد؟ وفي حالة «جهة خاطئة» هل قُدّم للجهة الصحيحة؟ اكتب الإجراء المطلوب من الموظف في جملة واضحة.',
   'interval', 240, NULL,
   '{"grace_hours":24,"max_candidates":20,"batch_size":5}')
) AS v(sensor, title, description, instructions, schedule_type, interval_minutes, run_at_time, config)
WHERE NOT EXISTS (SELECT 1 FROM public.ai_recurring_tasks t WHERE t.sensor = v.sensor);

NOTIFY pgrst, 'reload schema';
