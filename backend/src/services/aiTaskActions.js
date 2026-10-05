// Executes the actions the recurring AI tasks PROPOSE (stored on a finding as
// proposed_action). Runs only when management approves a finding -- or
// automatically for the one action type the task's autonomy level allows
// (send_followup under 'auto_followup'). Every action re-checks the ACTOR's own
// permissions (the approver, or the task owner for automatic runs) exactly like the
// matching human route would, and writes an activity_logs row tagged via 'ai_task'.
const { hasPermission } = require('../middleware/auth');
const { canAccessCase } = require('./caseAccess');
const { canAccessEmailAccount } = require('./emailAccountAccess');
const { checkLock } = require('./emailAccountLock');
const { notifyUsers, getCaseRecipients } = require('./notificationService');
const { logActivity } = require('./activityLogger');
const { todayStr, clip } = require('./aiTaskCommon');

const OUTCOMES = ['pending', 'records_received', 'no_records', 'rejected', 'payment_requested'];
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

const parseMeta = (m) => { if (!m) return {}; if (typeof m !== 'string') return m; try { return JSON.parse(m); } catch { return {}; } };
const fileTypeOf = (name = '') => {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) return 'image';
  if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.ogg', '.flac'].includes(ext)) return 'audio';
  return 'document';
};

async function need(sup, actor, resource, action, msg) {
  if (!(await hasPermission(sup, actor, resource, action))) throw new Error(msg || `Forbidden — لا تملك صلاحية ${resource}:${action}`);
}
async function needCase(sup, actor, caseId) {
  if (!caseId || !(await canAccessCase(sup, actor, caseId))) throw new Error('Forbidden — هذه القضية غير مسندة إليك');
}
const log = (actor, action_type, target_type, target_id, title, details) => logActivity({
  user_id: actor?.id, user_name: actor?.name, action_type, target_type, target_id, target_title: title,
  details: `${details} (بواسطة مهام المساعد الذكي)`,
});

async function loadComm(sup, id) {
  const { data } = await sup.from('communications').select('*').eq('id', parseInt(id)).is('deleted_at', null).maybeSingle();
  if (!data) throw new Error('الرسالة غير موجودة');
  return data;
}

// ---------------- send_followup ----------------
async function sendFollowup(sup, actor, p, draft) {
  await need(sup, actor, 'cases', 'edit');
  let requestId = parseInt(p.request_id);
  if (!requestId && p.case_id) {
    // e.g. a confirmation reply that wasn't tied to a request: take the case's request for that agency
    let q = sup.from('requests').select('id').eq('case_id', parseInt(p.case_id)).is('deleted_at', null).order('created_at', { ascending: false }).limit(1);
    if (p.agency_id) q = q.eq('agency_id', parseInt(p.agency_id));
    const { data: guess } = await q.maybeSingle();
    requestId = guess?.id;
  }
  const { data: req } = await sup.from('requests').select('*').eq('id', requestId || -1).is('deleted_at', null).maybeSingle();
  if (!req) throw new Error('الطلب غير موجود');
  await needCase(sup, actor, req.case_id);
  const { data: agency } = req.agency_id ? await sup.from('agencies').select('id, name_en, name_ar, email').eq('id', req.agency_id).maybeSingle() : { data: null };

  const to = String(p.to || String(agency?.email || '').split(/[;,\s]+/)[0] || '').trim();
  if (!EMAIL_RE.test(to)) throw new Error('لا يوجد عنوان إيميل صالح للجهة — حدّد المستلم يدويًا');
  if (!draft?.body?.trim()) throw new Error('نص الإيميل مطلوب');

  const { data: outs } = await sup.from('communications').select('id, email_account_id, message_id, thread_id, subject, agency_id')
    .eq('case_id', req.case_id).eq('direction', 'outbound').is('deleted_at', null).order('created_at', { ascending: false }).limit(10);
  const lastOut = (outs || []).find(o => o.message_id && (o.agency_id == null || o.agency_id === req.agency_id));
  const { data: cs } = await sup.from('cases').select('id, title, default_email_account_id').eq('id', req.case_id).maybeSingle();
  const accountId = parseInt(p.account_id) || req.email_account_id || lastOut?.email_account_id || cs?.default_email_account_id;
  if (!accountId) throw new Error('لا يوجد حساب بريد مرتبط بهذا الطلب — اختر حسابًا');
  if (!(await canAccessEmailAccount(sup, actor, accountId))) throw new Error('Forbidden — لا تملك صلاحية استخدام حساب البريد هذا');
  if (req.agency_id) {
    const lock = await checkLock(sup, accountId, req.agency_id, req.case_id);
    if (lock.locked) throw new Error(`حساب البريد مستخدم مع هذه الجهة في قضية أخرى («${lock.lockedByCase?.title || '#' + lock.lockedByCase?.id}»)`);
  }
  const { data: account } = await sup.from('email_accounts').select('email').eq('id', accountId).maybeSingle();
  if (!account) throw new Error('حساب البريد غير موجود');

  const subject = (draft.subject || (lastOut?.subject ? `Re: ${lastOut.subject.replace(/^re:\s*/i, '')}` : 'Follow-up on our records request')).slice(0, 200);
  let messageId;
  if (process.env.AI_TASKS_DRY_RUN === '1') {
    messageId = `<dry-run-${Date.now()}@foia-os.local>`;
  } else {
    const emailService = require('./emailService');
    const info = await emailService.sendEmail(accountId, { to, subject, text: draft.body, inReplyTo: lastOut?.message_id || undefined, references: lastOut?.message_id ? [lastOut.message_id] : undefined });
    messageId = info.messageId;
  }
  const { error: commErr } = await sup.from('communications').insert({
    case_id: req.case_id, type: 'email', direction: 'outbound', subject, body: draft.body, sender: account.email, recipient: to,
    message_id: messageId, thread_id: lastOut?.thread_id || lastOut?.message_id || messageId, created_at: new Date().toISOString(),
    email_account_id: accountId, agency_id: req.agency_id || null, request_id: req.id, is_read: true,
    metadata: JSON.stringify({ via: 'ai_task', finding: p.finding_id || null, dry_run: process.env.AI_TASKS_DRY_RUN === '1' || undefined }),
  });
  if (commErr) console.error('[aiTaskActions] follow-up sent but communications insert failed:', commErr.message);
  // restart the clock so the overdue alarms don't fire again the next day
  const days = Math.min(30, Math.max(3, parseInt(p.expected_response_days) || 7));
  await sup.from('requests').update({ expected_response_date: new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) }).eq('id', req.id);
  log(actor, 'ai_followup_sent', 'case', req.case_id, `📧 متابعة: ${agency?.name_en || agency?.name_ar || ''}`, `إرسال إيميل متابعة للطلب #${req.id} إلى ${to}`);
  return { message_id: messageId, to, account_id: accountId, dry_run: process.env.AI_TASKS_DRY_RUN === '1' || undefined };
}

// ---------------- link_email_to_case (full: request + documents + team notice) ----------------
async function linkEmailToCase(sup, actor, p) {
  const comm = await loadComm(sup, p.communication_id);
  const caseId = parseInt(p.case_id);
  await needCase(sup, actor, caseId);
  if (comm.email_account_id && !(await canAccessEmailAccount(sup, actor, comm.email_account_id))) throw new Error('Forbidden — الرسالة في صندوق بريد غير مسموح لك');
  const { data: cs } = await sup.from('cases').select('id, title').eq('id', caseId).is('deleted_at', null).maybeSingle();
  if (!cs) throw new Error('القضية غير موجودة');

  const { data: reqs } = await sup.from('requests').select('id, agency_id, created_at').eq('case_id', caseId).is('deleted_at', null).order('created_at', { ascending: false });
  let agencyId = parseInt(p.agency_id) || comm.agency_id || null;
  let request = p.request_id ? (reqs || []).find(r => r.id === parseInt(p.request_id)) : null;
  if (!request && agencyId) request = (reqs || []).find(r => r.agency_id === agencyId);
  if (!request && (reqs || []).length === 1) request = reqs[0];
  if (request && !agencyId) agencyId = request.agency_id;

  const updates = { case_id: caseId, agency_id: agencyId, request_id: request?.id || null, match_reason: { tier_key: 'manual', label_ar: 'ربط بواسطة مهام المساعد الذكي' } };
  let { error } = await sup.from('communications').update(updates).eq('id', comm.id);
  if (error && /match_reason/.test(error.message)) { delete updates.match_reason; ({ error } = await sup.from('communications').update(updates).eq('id', comm.id)); }
  if (error) throw error;

  // Attachments of an unmatched email only live in the shared "Unmatched Emails" Drive
  // folder -- register them as the case's own documents so they show in its Files tab.
  let docs = 0;
  for (const a of parseMeta(comm.metadata).attachments || []) {
    if (!a.driveFileId) continue;
    const { data: exists } = await sup.from('case_documents').select('id').eq('case_id', caseId).eq('drive_file_id', a.driveFileId).is('deleted_at', null).maybeSingle();
    if (exists) continue;
    const { error: dErr } = await sup.from('case_documents').insert({
      case_id: caseId, filename: a.filename, original_name: a.filename, mime_type: a.mimeType || null, size: a.size || null,
      file_type: fileTypeOf(a.filename), source: 'email', drive_file_id: a.driveFileId, storage_provider: 'google_drive',
      file_path: a.viewUrl || null, url: a.viewUrl || null,
    });
    if (!dErr) docs++;
  }
  try {
    const recipients = await getCaseRecipients(sup, caseId, { excludeUserId: actor?.id });
    await notifyUsers(sup, recipients, { type: 'email_received', title: '📩 رد مرتبط بقضيتك', body: `ربط المساعد ردًا (${clip(comm.sender, 50)}: ${clip(comm.subject, 60)}) بالقضية`, target_type: 'case', target_id: caseId });
  } catch (e) { console.error('[aiTaskActions] link notify failed:', e.message); }
  log(actor, 'email_linked', 'case', caseId, cs.title, `ربط رسالة وارد #${comm.id} بالقضية${docs ? ` وتسجيل ${docs} مستند` : ''}`);
  return { case_id: caseId, request_id: request?.id || null, documents_added: docs };
}

// ---------------- create_case_from_email ----------------
async function createCaseFromEmail(sup, actor, p) {
  await need(sup, actor, 'cases', 'create');
  const comm = await loadComm(sup, p.communication_id);
  if (comm.case_id) throw new Error('الرسالة مرتبطة بقضية بالفعل');
  const title = clip(p.title, 200);
  if (!title) throw new Error('عنوان القضية مطلوب');
  const { v4: uuidv4 } = require('uuid');
  const now = new Date().toISOString();
  const agencyId = parseInt(p.agency_id) || comm.agency_id || null;
  const { data: created, error } = await sup.from('cases').insert({
    uuid: uuidv4(), title, description: clip(p.description || comm.body, 1200), status: 'open', priority: 'medium',
    created_by: actor?.id || null, defendant_name: p.defendant_name ? clip(p.defendant_name, 200) : null,
    source_agency_name: p.source_agency_name ? clip(p.source_agency_name, 200) : null, created_at: now, updated_at: now,
  }).select().single();
  if (error) throw error;
  await require('./caseTeam').addCreatorToTeam(sup, created.id, actor?.id);
  if (agencyId) {
    const { data: ns } = await sup.from('pipeline_lists').select('id').eq('name_en', 'Not Started').is('deleted_at', null).maybeSingle();
    const { error: rErr } = await sup.from('requests').insert({ case_id: created.id, agency_id: agencyId, status: 'pending', channel_method: 'email', classification_id: ns?.id || null, created_at: now });
    if (rErr) console.error('[aiTaskActions] request insert failed for new case:', rErr.message);
  }
  log(actor, 'create', 'case', created.id, title, `إنشاء قضية من رد وارد #${comm.id}`);
  const link = await linkEmailToCase(sup, actor, { communication_id: comm.id, case_id: created.id, agency_id: agencyId });
  return { case_id: created.id, ...link };
}

// ---------------- the small ones ----------------
async function archiveCommunication(sup, actor, p) {
  const comm = await loadComm(sup, p.communication_id);
  if (comm.email_account_id && !(await canAccessEmailAccount(sup, actor, comm.email_account_id))) throw new Error('Forbidden — الرسالة في صندوق بريد غير مسموح لك');
  if (comm.case_id) await needCase(sup, actor, comm.case_id);
  const { error } = await sup.from('communications').update({ is_archived: true, archived_at: new Date().toISOString() }).eq('id', comm.id);
  if (error) throw error;
  return { archived: comm.id };
}

async function loadRequestForActor(sup, actor, requestId) {
  const { data: r } = await sup.from('requests').select('*').eq('id', parseInt(requestId)).is('deleted_at', null).maybeSingle();
  if (!r) throw new Error('الطلب غير موجود');
  await needCase(sup, actor, r.case_id);
  return r;
}

async function setReplyOutcome(sup, actor, p) {
  await need(sup, actor, 'cases', 'edit');
  if (!OUTCOMES.includes(p.reply_outcome)) throw new Error('نتيجة الرد غير صالحة');
  const r = await loadRequestForActor(sup, actor, p.request_id);
  const { error } = await sup.from('requests').update({ reply_outcome: p.reply_outcome }).eq('id', r.id);
  if (error) throw error;
  log(actor, 'update', 'case', r.case_id, `نتيجة الرد: ${p.reply_outcome}`, `ضبط نتيجة رد الطلب #${r.id}`);
  return { request_id: r.id, reply_outcome: p.reply_outcome };
}

async function moveRequestList(sup, actor, p) {
  await need(sup, actor, 'pipeline', 'move');
  const r = await loadRequestForActor(sup, actor, p.request_id);
  const { data: list } = await sup.from('pipeline_lists').select('id, name_ar, name_en').eq('id', parseInt(p.list_id)).is('deleted_at', null).maybeSingle();
  if (!list) throw new Error('القائمة غير موجودة');
  const { getNotStartedListId, effectiveListId } = require('./pipelineMeta');
  const from = effectiveListId(r, await getNotStartedListId(sup));
  const changes = String(from) !== String(list.id);
  const { error } = await sup.from('requests').update(changes ? { classification_id: list.id, status: 'classified', milestone_id: null } : { classification_id: list.id, status: 'classified' }).eq('id', r.id);
  if (error) throw error;
  if (changes) await sup.from('request_labels').delete().eq('request_id', r.id);
  log(actor, 'classify', 'case', r.case_id, `📌 تم تصنيف الرد: "${list.name_ar || list.name_en}"`, `نقل الطلب #${r.id} للقائمة ${list.name_ar || list.name_en}`);
  return { request_id: r.id, list: list.name_ar || list.name_en };
}

async function createRequest(sup, actor, p) {
  await need(sup, actor, 'cases', 'edit');
  const caseId = parseInt(p.case_id); const agencyId = parseInt(p.agency_id);
  await needCase(sup, actor, caseId);
  const { data: ag } = await sup.from('agencies').select('id').eq('id', agencyId).is('deleted_at', null).maybeSingle();
  if (!ag) throw new Error('الجهة غير موجودة');
  const { data: ns } = await sup.from('pipeline_lists').select('id').eq('name_en', 'Not Started').is('deleted_at', null).maybeSingle();
  const { data, error } = await sup.from('requests').insert({ case_id: caseId, agency_id: agencyId, status: 'pending', channel_method: 'email', classification_id: ns?.id || null, created_at: new Date().toISOString() }).select().single();
  if (error) throw error;
  log(actor, 'create', 'case', caseId, 'طلب جديد', `إنشاء طلب #${data.id} للجهة الصحيحة`);
  return { request_id: data.id };
}

async function notifyEmployee(sup, actor, p) {
  const ids = (Array.isArray(p.user_ids) ? p.user_ids : []).map(Number).filter(Number.isFinite);
  let recipients = ids;
  if (!recipients.length && p.case_id) recipients = await getCaseRecipients(sup, parseInt(p.case_id));
  if (!recipients.length) throw new Error('لا يوجد مستلمون');
  await notifyUsers(sup, recipients, { type: 'ai_task_finding', title: clip(p.title || '🤖 تنبيه من المساعد', 120), body: clip(p.body, 300), target_type: p.case_id ? 'case' : null, target_id: p.case_id ? parseInt(p.case_id) : null });
  return { notified: recipients.length };
}

const EXECUTORS = {
  send_followup: (sup, actor, p, draft) => sendFollowup(sup, actor, p, draft),
  link_email_to_case: (sup, actor, p) => linkEmailToCase(sup, actor, p),
  create_case_from_email: (sup, actor, p) => createCaseFromEmail(sup, actor, p),
  archive_communication: (sup, actor, p) => archiveCommunication(sup, actor, p),
  set_reply_outcome: (sup, actor, p) => setReplyOutcome(sup, actor, p),
  move_request_list: (sup, actor, p) => moveRequestList(sup, actor, p),
  create_request: (sup, actor, p) => createRequest(sup, actor, p),
  notify_employee: (sup, actor, p) => notifyEmployee(sup, actor, p),
};

/**
 * Executes a finding's proposed action as `actor`. `edits` can override the draft
 * (management edited the email before approving). Updates the finding.
 */
async function executeFinding(sup, finding, actor, { edits = null, auto = false } = {}) {
  const action = finding.proposed_action;
  if (!action || !action.type || action.type === 'none') throw new Error('لا يوجد إجراء مقترح على هذا البند');
  const exec = EXECUTORS[action.type];
  if (!exec) throw new Error(`نوع الإجراء غير مدعوم: ${action.type}`);
  const params = { ...(action.params || {}), finding_id: finding.id };
  const draft = { ...(action.draft || {}), ...(edits?.draft || {}) };
  if (edits?.params) Object.assign(params, edits.params);
  let result;
  try {
    result = await exec(sup, actor, params, draft);
  } catch (e) {
    await sup.from('ai_task_findings').update({ status: 'failed', evidence: { ...(finding.evidence || {}), last_error: e.message } }).eq('id', finding.id);
    throw e;
  }
  await sup.from('ai_task_findings').update({
    status: 'executed', resolved_at: new Date().toISOString(), resolved_by: auto ? null : actor?.id || null, resolved_reason: auto ? 'executed_auto' : 'executed',
    evidence: { ...(finding.evidence || {}), execution: { at: new Date().toISOString(), by: actor?.name || null, auto, result } },
  }).eq('id', finding.id);
  return result;
}

module.exports = { executeFinding, EXECUTORS };
