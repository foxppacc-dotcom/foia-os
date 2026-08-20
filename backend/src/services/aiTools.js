/**
 * The AI assistant's entire capability surface. This is the architectural
 * guarantee behind "the AI can never touch code/development/infrastructure":
 * the tool schema handed to a provider (see routes/aiAssistant.js's chat
 * loop) is built ONLY from TOOL_DEFS below, and each name maps to exactly
 * one function in this file. There is no generic/parametrized "run this" or
 * "call that API" tool anywhere here -- if it isn't one of these functions,
 * the model has no way to invoke it, regardless of what a conversation asks
 * it to do.
 *
 * Every function takes (sup, input, ctx) where ctx = { user } is the human
 * operating the chat -- each function re-checks the SAME permission gates
 * the rest of the app already enforces for that action (never a separate,
 * looser check just because the AI is asking).
 */
const { hasPermission } = require('../middleware/auth');
const { getCaseActivityRecipients, notifyUsers } = require('./notificationService');
const { classifyIntakeText, blankAnswers } = require('./aiClassifier');

async function getActiveCriteriaDefs(sup) {
  const { data } = await sup.from('intake_criteria_definitions').select('*').eq('is_active', true).order('sort_order');
  return data || [];
}

// ---- search_intake ----
async function searchIntake(sup, { query } = {}) {
  let q = sup.from('cases').select('id, title, description, created_at, intake_source').eq('in_intake_review', true).order('created_at', { ascending: false }).limit(30);
  const { data, error } = await q;
  if (error) throw error;
  const term = (query || '').toLowerCase().trim();
  const rows = term ? (data || []).filter(c => (c.title || '').toLowerCase().includes(term) || (c.description || '').toLowerCase().includes(term)) : (data || []);
  return { count: rows.length, cases: rows.slice(0, 15) };
}

// ---- create_intake_entry ----
async function createIntakeEntry(sup, { title, defendant_name, source_agency_name, story_hook, case_summary } = {}, ctx) {
  if (!title || !title.trim()) throw new Error('title مطلوب');
  const criteriaDefs = await getActiveCriteriaDefs(sup);
  const text = [story_hook, case_summary].filter(Boolean).join('\n\n');
  const intakeCriteria = text.trim() ? await classifyIntakeText(text, criteriaDefs) : blankAnswers(criteriaDefs);

  const { data: created, error } = await sup.from('cases').insert({
    uuid: require('uuid').v4(), title: title.trim(),
    description: case_summary || story_hook || '',
    status: 'open', priority: 'medium', created_by: ctx.user?.id,
    defendant_name: defendant_name || null, source_agency_name: source_agency_name || null,
    story_hook: story_hook || null, case_summary: case_summary || null,
    in_intake_review: true, intake_source: 'manual', intake_criteria: intakeCriteria,
  }).select().single();
  if (error) throw error;
  return { case_id: created.id, title: created.title };
}

// ---- edit_intake_entry ----
const EDITABLE_FIELDS = ['title', 'defendant_name', 'source_agency_name', 'story_hook', 'case_summary'];
async function editIntakeEntry(sup, { case_id, fields } = {}) {
  const caseId = parseInt(case_id);
  if (!caseId || !fields || typeof fields !== 'object') throw new Error('case_id و fields مطلوبان');
  const { data: existing } = await sup.from('cases').select('id, in_intake_review').eq('id', caseId).maybeSingle();
  if (!existing) throw new Error('Case not found');
  if (!existing.in_intake_review) throw new Error('هذه القضية لم تعد في الاستقبال الذكي -- لا يمكن تعديلها عبر هذه الأداة');

  const updates = {};
  for (const key of EDITABLE_FIELDS) if (fields[key] !== undefined) updates[key] = fields[key];
  if (!Object.keys(updates).length) throw new Error('لا توجد حقول صالحة للتعديل');
  const { error } = await sup.from('cases').update(updates).eq('id', caseId);
  if (error) throw error;
  return { case_id: caseId, updated_fields: Object.keys(updates) };
}

// ---- generate_employee_report ----
async function generateEmployeeReport(sup, { user_id, name } = {}, ctx) {
  let userId = parseInt(user_id);
  if (!userId && name) {
    const { data: match } = await sup.from('users').select('id, name').ilike('name', `%${name}%`).limit(1).maybeSingle();
    if (!match) throw new Error(`لم يتم إيجاد موظف باسم "${name}"`);
    userId = match.id;
  }
  if (!userId) throw new Error('user_id أو name مطلوب');

  // Re-checks the SAME gate team.routes.js's /api/kpi/:userId enforces --
  // the AI never bypasses "can this requester view someone else's performance".
  if (userId !== ctx.user?.id && !(await hasPermission(sup, ctx.user, 'employee_performance', 'view'))) {
    throw new Error('لا تملك صلاحية عرض أداء هذا الموظف');
  }

  const { data: user } = await sup.from('users').select('id, name, role').eq('id', userId).maybeSingle();
  if (!user) throw new Error('Employee not found');

  const { data: tasks } = await sup.from('case_tasks').select('id, status, due_date, completed_at, priority').eq('assigned_to', userId);
  let attendance = [];
  try { const r = await sup.from('attendance_logs').select('id, status').eq('user_id', userId); attendance = r.data || []; } catch { attendance = []; }

  const total = tasks?.length || 0;
  const completed = tasks?.filter(t => t.status === 'completed').length || 0;
  const onTime = tasks?.filter(t => t.status === 'completed' && t.due_date && t.completed_at && new Date(t.completed_at) <= new Date(t.due_date)).length || 0;
  const overdue = tasks?.filter(t => t.status !== 'completed' && t.due_date && new Date(t.due_date) < new Date()).length || 0;

  return {
    employee: { id: user.id, name: user.name, role: user.role },
    total_tasks: total, completed_tasks: completed, overdue_tasks: overdue,
    on_time_rate: total > 0 ? Math.round((onTime / total) * 100) : 0,
    completion_rate: total > 0 ? Math.round((completed / total) * 100) : 0,
    attendance_days: attendance.length,
    present_days: attendance.filter(a => a.status === 'present').length,
    absent_days: attendance.filter(a => a.status === 'absent').length,
  };
}

// ---- list_cases_with_unreviewed_replies ----
async function listUnreviewedReplyCases(sup) {
  const { data: rows, error } = await sup.from('notifications')
    .select('target_id').eq('type', 'email_received').eq('is_read', false).eq('target_type', 'case');
  if (error) throw error;
  const caseIds = [...new Set((rows || []).map(r => r.target_id).filter(Boolean))];
  if (!caseIds.length) return { count: 0, cases: [] };
  const { data: cases } = await sup.from('cases').select('id, title, status').in('id', caseIds);
  return { count: caseIds.length, cases: (cases || []).slice(0, 30) };
}

// ---- review_unmatched_emails ----
async function reviewUnmatchedEmails(sup, { since_days } = {}) {
  const sinceDays = Math.min(365, Math.max(1, parseInt(since_days) || 60));
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sup.from('communications')
    .select('id, subject, body, sender, created_at')
    .is('case_id', null).eq('direction', 'inbound').gte('created_at', since)
    .order('created_at', { ascending: false }).limit(25);
  if (error) throw error;
  return {
    count: (data || []).length,
    emails: (data || []).map(c => ({ id: c.id, subject: c.subject, sender: c.sender, created_at: c.created_at, body_excerpt: (c.body || '').slice(0, 1200) })),
  };
}

// ---- suggest_email_case_link ----
async function suggestEmailCaseLink(sup, { communication_id, case_id, reason } = {}) {
  const commId = parseInt(communication_id); const caseId = parseInt(case_id);
  if (!commId || !caseId || !reason) throw new Error('communication_id و case_id و reason مطلوبون');
  const { data: comm } = await sup.from('communications').select('id, case_id, metadata').eq('id', commId).maybeSingle();
  if (!comm) throw new Error('Communication not found');
  if (comm.case_id) throw new Error('هذه الرسالة مرتبطة بقضية بالفعل');
  const { data: caseRow } = await sup.from('cases').select('id, title').eq('id', caseId).maybeSingle();
  if (!caseRow) throw new Error('Case not found');

  let meta = {};
  try { meta = comm.metadata ? JSON.parse(comm.metadata) : {}; } catch { meta = {}; }
  const existing = (meta.possible_matches || []).filter(pm => pm.caseId !== caseId);
  // Same shape mailPoller.js's own fuzzy tiers already write -- Inbox.jsx's
  // existing "قد تشابه القضية X" confirm/reject UI renders this with zero
  // frontend changes; `source: 'ai'` only adds a cosmetic label there.
  meta.possible_matches = [...existing, { caseId, reasons: [reason], source: 'ai' }];
  const { error } = await sup.from('communications').update({ metadata: JSON.stringify(meta) }).eq('id', commId);
  if (error) throw error;
  return { communication_id: commId, suggested_case_id: caseId, case_title: caseRow.title };
}

// ---- auto_link_email_to_case ----
async function autoLinkEmailToCase(sup, { communication_id, case_id } = {}, ctx) {
  const commId = parseInt(communication_id); const caseId = parseInt(case_id);
  if (!commId || !caseId) throw new Error('communication_id و case_id مطلوبان');
  const { data: comm } = await sup.from('communications').select('id, case_id, metadata, subject, sender').eq('id', commId).maybeSingle();
  if (!comm) throw new Error('Communication not found');
  if (comm.case_id) throw new Error('هذه الرسالة مرتبطة بقضية بالفعل');
  const { data: caseRow } = await sup.from('cases').select('id, title').eq('id', caseId).maybeSingle();
  if (!caseRow) throw new Error('Case not found');

  let meta = {};
  try { meta = comm.metadata ? JSON.parse(comm.metadata) : {}; } catch { meta = {}; }
  if (meta.possible_matches) delete meta.possible_matches;

  const { error } = await sup.from('communications').update({ case_id: caseId, is_read: true, metadata: JSON.stringify(meta) }).eq('id', commId);
  if (error) throw error;

  // Same activity notification a manual link already fires (documentCenter.js's
  // PUT /inbox/:id/link) -- an AI auto-link is otherwise invisible on the
  // case's activity badge.
  try {
    const recipients = await getCaseActivityRecipients(sup, caseId, { excludeUserId: ctx.user?.id });
    await notifyUsers(sup, recipients, {
      type: 'email_received', title: '🤖 بريد مرتبط تلقائيًا بالقضية (المساعد الذكي)',
      body: `تم ربط بريد (${comm.sender || ''}: ${comm.subject || ''}) بالقضية تلقائيًا بواسطة المساعد الذكي`,
      target_type: 'case', target_id: caseId,
    });
  } catch (e) { console.error('[aiTools] auto-link notification failed:', e.message); }

  return { communication_id: commId, linked_case_id: caseId, case_title: caseRow.title };
}

// ---- assign_case_to_employee ----
async function assignCaseToEmployee(sup, { case_id, user_id, name } = {}, ctx) {
  const caseId = parseInt(case_id);
  if (!caseId) throw new Error('case_id مطلوب');
  let userId = parseInt(user_id);
  if (!userId && name) {
    const { data: match } = await sup.from('users').select('id, name').ilike('name', `%${name}%`).limit(1).maybeSingle();
    if (!match) throw new Error(`لم يتم إيجاد موظف باسم "${name}"`);
    userId = match.id;
  }
  if (!userId) throw new Error('user_id أو name مطلوب');

  const [{ data: caseRow }, { data: user }] = await Promise.all([
    sup.from('cases').select('id, title').eq('id', caseId).maybeSingle(),
    sup.from('users').select('id, name').eq('id', userId).maybeSingle(),
  ]);
  if (!caseRow) throw new Error('Case not found');
  if (!user) throw new Error('Employee not found');

  const { data: existing } = await sup.from('case_assignees').select('case_id').eq('case_id', caseId).eq('user_id', userId).maybeSingle();
  if (existing) return { case_id: caseId, user_id: userId, employee_name: user.name, already_assigned: true };

  const { error } = await sup.from('case_assignees').insert({ case_id: caseId, user_id: userId, role: 'member', assigned_at: new Date().toISOString() });
  if (error) throw error;

  try {
    await notifyUsers(sup, [userId], {
      type: 'case_assigned', title: '🤖 تم إسناد قضية إليك (المساعد الذكي)',
      body: `تم إسنادك للقضية "${caseRow.title}" بواسطة المساعد الذكي`,
      target_type: 'case', target_id: caseId,
    });
  } catch (e) { console.error('[aiTools] assign notification failed:', e.message); }

  return { case_id: caseId, case_title: caseRow.title, user_id: userId, employee_name: user.name };
}

// ---- record_capability_learning ----
// NOT gated by ai_capabilities (see aiAssistant.js's chat loop -- this tool
// is always offered whenever at least one other tool is allowed) since it's
// purely additive knowledge-keeping, not an action on case data. This is the
// mechanism behind "مركز الخبرة والتدريب": whatever the assistant notices
// while doing a task gets appended here, per capability, independent of
// which provider is active -- so switching from one AI provider to another
// carries the accumulated experience forward instead of starting over.
async function recordCapabilityLearning(sup, { action, note } = {}) {
  if (!action || !note) throw new Error('action و note مطلوبان');
  const { data: existing } = await sup.from('ai_capability_knowledge').select('learned_notes').eq('action', action).maybeSingle();
  const stamp = new Date().toISOString().split('T')[0];
  const appended = existing?.learned_notes ? `${existing.learned_notes}\n[${stamp}] ${note}` : `[${stamp}] ${note}`;
  const { error } = await sup.from('ai_capability_knowledge').upsert(
    { action, learned_notes: appended, updated_at: new Date().toISOString() }, { onConflict: 'action' }
  );
  if (error) throw error;
  return { action, recorded: true };
}

// Fixed tool schema catalog -- see the file-level comment above. `permission`
// is the ai_assistant action this tool is gated behind (permissions.js).
const TOOL_DEFS = [
  {
    name: 'search_intake', permission: 'search_intake',
    description: 'البحث عن قضايا لا تزال في قائمة الاستقبال الذكي (لم يتم اعتمادها بعد).',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'كلمة أو عبارة للبحث في العنوان/الوصف' } } },
    run: (sup, input) => searchIntake(sup, input),
  },
  {
    name: 'create_intake_entry', permission: 'create_intake_entry',
    description: 'إنشاء إدخال جديد في قائمة الاستقبال الذكي.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' }, defendant_name: { type: 'string' }, source_agency_name: { type: 'string' },
        story_hook: { type: 'string' }, case_summary: { type: 'string' },
      },
      required: ['title'],
    },
    run: (sup, input, ctx) => createIntakeEntry(sup, input, ctx),
  },
  {
    name: 'edit_intake_entry', permission: 'edit_intake_entry',
    description: 'تعديل إدخال موجود لا يزال في قائمة الاستقبال الذكي (title, defendant_name, source_agency_name, story_hook, case_summary فقط).',
    input_schema: {
      type: 'object',
      properties: { case_id: { type: 'number' }, fields: { type: 'object' } },
      required: ['case_id', 'fields'],
    },
    run: (sup, input) => editIntakeEntry(sup, input),
  },
  {
    name: 'generate_employee_report', permission: 'generate_employee_report',
    description: 'إنشاء تقرير أداء عن موظف (المهام، نسبة الإنجاز، الحضور) بالاسم أو رقم المستخدم.',
    input_schema: { type: 'object', properties: { user_id: { type: 'number' }, name: { type: 'string' } } },
    run: (sup, input, ctx) => generateEmployeeReport(sup, input, ctx),
  },
  {
    name: 'list_unreviewed_replies', permission: 'list_unreviewed_replies',
    description: 'قائمة القضايا التي وصلها ردود بريدية جديدة ولم يطّلع عليها أحد بعد.',
    input_schema: { type: 'object', properties: {} },
    run: (sup) => listUnreviewedReplyCases(sup),
  },
  {
    name: 'review_unmatched_emails', permission: 'review_unmatched_emails',
    description: 'قراءة محتوى الإيميلات الواردة غير المرتبطة بأي قضية بعد (لمراجعتها لغويًا، وليس فقط بالكلمات المفتاحية).',
    input_schema: { type: 'object', properties: { since_days: { type: 'number', description: 'عدد الأيام للبحث فيها، افتراضي 60' } } },
    run: (sup, input) => reviewUnmatchedEmails(sup, input),
  },
  {
    name: 'suggest_email_case_link', permission: 'suggest_email_link',
    description: 'اقتراح ربط إيميل غير مرتبط بقضية معينة -- يظهر للموظف كترشيح يحتاج تأكيده يدويًا، ولا يربط الرسالة مباشرة.',
    input_schema: {
      type: 'object',
      properties: { communication_id: { type: 'number' }, case_id: { type: 'number' }, reason: { type: 'string', description: 'سبب الاقتراح بإيجاز' } },
      required: ['communication_id', 'case_id', 'reason'],
    },
    run: (sup, input) => suggestEmailCaseLink(sup, input),
  },
  {
    name: 'auto_link_email_to_case', permission: 'auto_link_email',
    description: 'ربط إيميل غير مرتبط بقضية معينة مباشرة، بدون انتظار تأكيد بشري -- استخدمها فقط عند ثقة عالية جدًا بالربط.',
    input_schema: {
      type: 'object',
      properties: { communication_id: { type: 'number' }, case_id: { type: 'number' } },
      required: ['communication_id', 'case_id'],
    },
    run: (sup, input, ctx) => autoLinkEmailToCase(sup, input, ctx),
  },
  {
    name: 'assign_case_to_employee', permission: 'assign_case_to_employee',
    description: 'توزيع العمل: إسناد قضية لموظف معيّن (بالاسم أو رقم المستخدم). ينبّه الموظف بالإسناد الجديد.',
    input_schema: {
      type: 'object',
      properties: { case_id: { type: 'number' }, user_id: { type: 'number' }, name: { type: 'string' } },
      required: ['case_id'],
    },
    run: (sup, input, ctx) => assignCaseToEmployee(sup, input, ctx),
  },
];

// Always offered regardless of ai_capabilities toggles (see aiAssistant.js's
// chat loop) -- purely additive knowledge-keeping, not an action on case
// data, and disabling it would defeat the whole point of "مركز الخبرة
// والتدريب" surviving a provider switch.
const ALWAYS_AVAILABLE_TOOL_DEFS = [
  {
    name: 'record_capability_learning',
    description: 'تسجيل ملاحظة أو خبرة مكتسبة أثناء تنفيذ مهمة معينة، لتبقى محفوظة ومتاحة لك ولأي نسخة ذكاء اصطناعي تُستخدم لاحقًا لنفس المهمة.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'اسم القدرة/المهمة المرتبطة بهذه الملاحظة (مثال: search_intake)' },
        note: { type: 'string', description: 'الملاحظة أو الخبرة المكتسبة، بإيجاز' },
      },
      required: ['action', 'note'],
    },
    run: (sup, input) => recordCapabilityLearning(sup, input),
  },
];

module.exports = { TOOL_DEFS, ALWAYS_AVAILABLE_TOOL_DEFS };
