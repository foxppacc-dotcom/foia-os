// Lets the assistant organize ITSELF: when the user asks for standing / recurring work
// ("كل يوم راجع كذا"، "تابع لي كذا باستمرار"), it writes a plan and registers a recurring
// task of its own. The task appears (1) as its own card in "مهام المساعد الدورية" and (2)
// in "تنظيمه الداخلي" in the assistant's task panel, and from then on the scheduler runs it
// like any other task (see aiTaskRunner.js runCustom): read-only investigation, findings
// for whatever needs follow-up, and one-click proposals for management.
const { hasPermission } = require('../middleware/auth');
const { computeNextRunAt, clip, getLimits } = require('./aiTaskCommon');

// The caps (max custom tasks, shortest repeat interval) are set by management in
// "مهام المساعد" > "الحدود والميزانية".
const AUTONOMY = ['report_only', 'propose'];

function parseSchedule(input, limits) {
  const s = input.schedule || {};
  const type = s.type === 'daily' || (input.at_time && !input.every_minutes) ? 'daily' : 'interval';
  if (type === 'daily') {
    const at = String(s.at_time || input.at_time || '09:00');
    if (!/^\d{1,2}:\d{2}$/.test(at)) throw new Error('at_time يجب أن تكون بصيغة HH:MM (توقيت القاهرة)');
    return { schedule_type: 'daily', run_at_time: at, interval_minutes: 1440 };
  }
  const every = parseInt(s.every_minutes || input.every_minutes) || 360;
  const minInterval = limits.min_interval_minutes;
  if (every < minInterval) throw new Error(`أقل تكرار مسموح به حاليًا كل ${minInterval} دقيقة (تضبطه الإدارة من «الحدود والميزانية»)`);
  return { schedule_type: 'interval', run_at_time: null, interval_minutes: Math.min(10080, every) };
}

async function createRecurringTask(sup, input = {}, ctx) {
  if (!(await hasPermission(sup, ctx.user, 'ai_tasks', 'manage'))) throw new Error('Forbidden — لا تملك صلاحية إدارة مهام المساعد الدورية');
  const title = clip(input.title, 120);
  const instructions = String(input.instructions || '').trim().slice(0, 4000);
  if (!title) throw new Error('title مطلوب');
  if (instructions.length < 20) throw new Error('instructions مطلوبة: اشرح بدقة ماذا تفعل في كل تشغيل وما الذي يُعدّ مشكلة تستحق المتابعة');
  const limits = await getLimits(sup);
  const { count } = await sup.from('ai_recurring_tasks').select('id', { count: 'exact', head: true }).eq('sensor', 'custom').is('deleted_at', null);
  if ((count || 0) >= limits.max_custom_tasks) throw new Error(`وصلت للحد الأقصى (${limits.max_custom_tasks}) من المهام المخصّصة -- احذف مهمة قديمة، أو ارفع الحد من «الحدود والميزانية»`);
  const plan = (Array.isArray(input.plan) ? input.plan : []).map(s => clip(s, 200)).filter(Boolean).slice(0, 10);
  const sched = parseSchedule(input, limits);
  const autonomy = AUTONOMY.includes(input.autonomy) ? input.autonomy : 'propose';
  const row = {
    sensor: 'custom', title, description: clip(input.description || input.goal || title, 400), instructions,
    ...sched, autonomy, enabled: true,
    config: { plan, created_by_ai: true, origin_request: clip(input.origin_request, 500) || null, max_candidates: 20 },
    owner_user_id: ctx.user.id, created_by: ctx.user.id,
  };
  row.next_run_at = (input.run_now ? new Date() : computeNextRunAt(row)).toISOString();
  const { data, error } = await sup.from('ai_recurring_tasks').insert(row).select('id, title, schedule_type, interval_minutes, run_at_time, next_run_at').single();
  if (error) throw error;
  return {
    created: true, task_id: data.id, title: data.title,
    schedule: data.schedule_type === 'daily' ? `يوميًا ${data.run_at_time} (توقيت القاهرة)` : `كل ${data.interval_minutes} دقيقة`,
    first_run: input.run_now ? 'خلال دقيقة' : data.next_run_at,
    notice: 'ظهرت بطاقة المهمة في صفحة «مهام المساعد» وفي «تنظيمه الداخلي». ما تجده سيظهر هناك ليراجعه المدير، ولن ينفَّذ أي إجراء خارجي بدون موافقته.',
  };
}

async function manageRecurringTask(sup, input = {}, ctx) {
  const action = input.action;
  if (!['list', 'update', 'pause', 'resume', 'delete', 'run_now'].includes(action)) throw new Error('action: list|update|pause|resume|delete|run_now');
  if (action === 'list') {
    if (!(await hasPermission(sup, ctx.user, 'ai_tasks', 'view'))) throw new Error('Forbidden — لا تملك صلاحية عرض مهام المساعد الدورية');
    const { data: tasks } = await sup.from('ai_recurring_tasks').select('id, sensor, title, enabled, autonomy, schedule_type, interval_minutes, run_at_time, last_run_at, last_run_status, next_run_at, status, config').is('deleted_at', null).order('id');
    const { data: open } = await sup.from('ai_task_findings').select('task_id').in('status', ['open', 'failed']);
    const counts = {}; (open || []).forEach(f => { counts[f.task_id] = (counts[f.task_id] || 0) + 1; });
    return { tasks: (tasks || []).map(t => ({ id: t.id, title: t.title, type: t.sensor === 'custom' ? 'مخصّصة' : 'جاهزة', enabled: t.enabled, autonomy: t.autonomy, schedule: t.schedule_type === 'daily' ? `يوميًا ${t.run_at_time}` : `كل ${t.interval_minutes} دقيقة`, last_run: t.last_run_at, last_status: t.last_run_status, open_findings: counts[t.id] || 0, plan: t.config?.plan || undefined })) };
  }
  const id = parseInt(input.task_id);
  if (!id) throw new Error('task_id مطلوب (من action=list)');
  const { data: task } = await sup.from('ai_recurring_tasks').select('*').eq('id', id).is('deleted_at', null).maybeSingle();
  if (!task) throw new Error('المهمة غير موجودة');

  if (action === 'run_now') {
    if (!(await hasPermission(sup, ctx.user, 'ai_tasks', 'run'))) throw new Error('Forbidden — لا تملك صلاحية تشغيل المهام');
    require('./aiTaskRunner').runTask(id, { trigger: 'manual' }).catch(e => console.error('[aiTaskManageTools] run_now failed:', e.message));
    return { started: true, task_id: id, notice: 'بدأ التشغيل في الخلفية وستظهر النتيجة في سجل التشغيل خلال دقائق.' };
  }
  if (!(await hasPermission(sup, ctx.user, 'ai_tasks', 'manage'))) throw new Error('Forbidden — لا تملك صلاحية إدارة مهام المساعد الدورية');

  if (action === 'delete') {
    if (task.sensor !== 'custom') throw new Error('يمكن حذف المهام المخصّصة فقط؛ الجاهزة يمكن إيقافها (pause).');
    await sup.from('ai_recurring_tasks').update({ deleted_at: new Date().toISOString(), enabled: false }).eq('id', id);
    return { deleted: true, task_id: id };
  }
  const u = {};
  if (action === 'pause') u.enabled = false;
  if (action === 'resume') { u.enabled = true; u.next_run_at = computeNextRunAt(task).toISOString(); }
  if (action === 'update') {
    if (input.title) u.title = clip(input.title, 120);
    if (input.instructions && task.sensor === 'custom') u.instructions = String(input.instructions).trim().slice(0, 4000);
    if (input.schedule || input.every_minutes || input.at_time) Object.assign(u, parseSchedule(input, await getLimits(sup)));
    if (AUTONOMY.includes(input.autonomy)) u.autonomy = input.autonomy;
    if (Array.isArray(input.plan) && task.sensor === 'custom') u.config = { ...(task.config || {}), plan: input.plan.map(s => clip(s, 200)).filter(Boolean).slice(0, 10) };
    if (!Object.keys(u).length) throw new Error('لا توجد تعديلات');
    if (u.schedule_type) u.next_run_at = computeNextRunAt({ ...task, ...u }).toISOString();
  }
  const { error } = await sup.from('ai_recurring_tasks').update(u).eq('id', id);
  if (error) throw error;
  return { ok: true, task_id: id, action };
}

const MANAGE_TOOL_DEFS = [
  {
    name: 'create_recurring_task', permission: 'create_recurring_task',
    description: 'سجّل مهمة دورية لنفسك لتنفذها بانتظام نيابةً عن المدير. استخدمها عندما يطلب المستخدم عملًا مستمرًا أو متكررًا ("كل يوم راجع..."، "تابع لي باستمرار..."، "افتكر تفحص..."). أنت من يضع الخطة: اكتب plan من 3 إلى 7 خطوات قصيرة، وinstructions تشرح بدقة ماذا تفحص في كل تشغيل وتسمّي الأدوات التجميعية التي ستستخدمها (مثل find_cases_by_gap وlist_requests وget_system_overview وsearch_cases) بدل فحص القضايا واحدة واحدة وما الذي يُعدّ مشكلة تستحق المتابعة وكيف تُبلَّغ بها. الجدولة: every_minutes (بحد أدنى تضبطه الإدارة، افتراضيًا 30 دقيقة) أو at_time "HH:MM" لتشغيل يومي. ستظهر المهمة كبطاقة في «مهام المساعد» وفي «تنظيمه الداخلي» تلقائيًا، وما تكتشفه يظهر للمدير بزر موافقة. لو كان الطلب لمرة واحدة فقط (تقرير الآن) فلا تستخدمها بل أجب مباشرة. بعد التسجيل أكّد للمستخدم في جملتين: ما ستفعله ومتى.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, instructions: { type: 'string' }, plan: { type: 'array', items: { type: 'string' } }, every_minutes: { type: 'number' }, at_time: { type: 'string', description: 'HH:MM بتوقيت القاهرة لتشغيل يومي' }, autonomy: { type: 'string', enum: ['report_only', 'propose'] }, run_now: { type: 'boolean', description: 'ابدأ أول تشغيل فورًا' }, origin_request: { type: 'string', description: 'طلب المستخدم الأصلي بكلماته' } }, required: ['title', 'instructions', 'plan'] },
    run: (sup, input, ctx) => createRecurringTask(sup, input, ctx),
  },
  {
    name: 'manage_recurring_task', permission: 'manage_recurring_task',
    description: 'عرض مهامك الدورية (list)، أو تعديل (update: العنوان/التعليمات/الجدولة/الخطة)، إيقاف (pause)، استئناف (resume)، حذف مهمة مخصّصة (delete)، أو تشغيل مهمة فورًا (run_now). استخدمها عندما يسأل المستخدم عن مهامك الدورية أو يطلب تغييرها أو إيقافها.',
    input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'update', 'pause', 'resume', 'delete', 'run_now'] }, task_id: { type: 'number' }, title: { type: 'string' }, instructions: { type: 'string' }, plan: { type: 'array', items: { type: 'string' } }, every_minutes: { type: 'number' }, at_time: { type: 'string' }, autonomy: { type: 'string', enum: ['report_only', 'propose'] } }, required: ['action'] },
    run: (sup, input, ctx) => manageRecurringTask(sup, input, ctx),
  },
];

module.exports = { MANAGE_TOOL_DEFS };
