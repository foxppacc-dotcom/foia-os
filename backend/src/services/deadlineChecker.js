const { getSupabase } = require('../supabase');

// Scans requests whose expected_response_date has passed with no response
// yet, and creates one notification per case per day (deduped against
// existing notifications so re-running the cron doesn't spam users).
async function checkOverdueDeadlines() {
  const sup = getSupabase();
  const today = new Date().toISOString().split('T')[0];

  const { data: overdue, error } = await sup.from('requests')
    .select('id, case_id, agency_id, expected_response_date, agencies(name_ar, name_en)')
    .lt('expected_response_date', today)
    .is('response_date', null)
    .is('deleted_at', null)
    .is('overdue_ack_by', null)
    .neq('status', 'closed');
  if (error) throw error;
  if (!overdue || !overdue.length) return { checked: 0, notified: 0 };

  // One notification per case per day (not per overdue request) — a case
  // with 3 overdue requests shouldn't spam 3 separate alerts.
  const byCase = new Map();
  for (const req of overdue) {
    if (!byCase.has(req.case_id)) byCase.set(req.case_id, []);
    byCase.get(req.case_id).push(req);
  }

  // Batched once for every case in this run instead of 3 sequential queries
  // PER case (dedup check, assignees, case row) -- with hundreds of overdue
  // cases that was hundreds of extra round trips on every cron run.
  const caseIds = [...byCase.keys()];
  const [{ data: recentNotifs }, { data: allAssignees }, { data: allCaseRows }] = await Promise.all([
    sup.from('notifications').select('target_id').eq('target_type', 'case').eq('type', 'deadline_overdue')
      .in('target_id', caseIds).gte('created_at', new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()),
    sup.from('case_assignees').select('case_id, user_id').in('case_id', caseIds).is('deleted_at', null),
    sup.from('cases').select('id, created_by, title').in('id', caseIds),
  ]);
  const alreadyNotified = new Set((recentNotifs || []).map(n => n.target_id));
  const assigneesByCase = {};
  (allAssignees || []).forEach(a => { (assigneesByCase[a.case_id] ||= []).push(a.user_id); });
  const caseRowById = Object.fromEntries((allCaseRows || []).map(c => [c.id, c]));

  let notified = 0;
  for (const [caseId, reqs] of byCase) {
    try {
      if (alreadyNotified.has(caseId)) continue;

      const caseRow = caseRowById[caseId];
      const userIds = new Set(assigneesByCase[caseId] || []);
      if (caseRow?.created_by) userIds.add(caseRow.created_by);
      if (!userIds.size) continue;

      const agencyNames = reqs.map(r => r.agencies?.name_ar || r.agencies?.name_en || 'جهة').join('، ');
      const title = reqs.length > 1 ? `⏰ ${reqs.length} جهات تخطّت الموعد المتوقع للرد` : '⏰ تخطّى الموعد المتوقع للرد';
      const body = `القضية "${caseRow?.title || caseId}" — ${agencyNames}`;
      // One insert per assignee, one at a time -- batched into a single
      // array insert instead. The error was also never checked before: a
      // failed insert meant that assignee silently never got told their
      // case's deadline passed, with no sign anything went wrong until the
      // 20h dedup window (line 31) expired and the cron retried.
      const { error: notifyErr } = await sup.from('notifications').insert(
        [...userIds].map(userId => ({ user_id: userId, type: 'deadline_overdue', title, body, target_type: 'case', target_id: caseId }))
      );
      if (notifyErr) { console.error(`[deadlineChecker] notification insert failed for case ${caseId}:`, notifyErr.message); continue; }
      notified++;
    } catch (e) {
      console.error(`[deadlineChecker] failed for case ${caseId}:`, e.message);
    }
  }
  return { checked: overdue.length, notified };
}

// Scans case_tasks whose due_date has arrived (today or earlier) and isn't
// completed, notifying the case's activity recipients (team + view_all
// supervisors) once per case per day -- same dedup-within-the-last-20h
// pattern as checkOverdueDeadlines above. This is what actually makes a
// "remind me/the team about X on this date" reminder real -- case_tasks.due_date
// already existed, but nothing ever looked at it; it was purely decorative.
// Reused for the AI assistant's set_case_reminder/list_case_reminders tools
// (aiTools.js) -- a reminder IS just a case_tasks row, no new table needed.
async function checkDueCaseTasks() {
  const sup = getSupabase();
  const { getCaseActivityRecipients, notifyUsers } = require('./notificationService');
  const today = new Date().toISOString().split('T')[0];

  const { data: due, error } = await sup.from('case_tasks')
    .select('id, case_id, title, due_date')
    .lte('due_date', today)
    .neq('status', 'completed')
    .not('due_date', 'is', null);
  if (error) throw error;
  if (!due || !due.length) return { checked: 0, notified: 0 };

  const byCase = new Map();
  for (const t of due) { if (!byCase.has(t.case_id)) byCase.set(t.case_id, []); byCase.get(t.case_id).push(t); }
  const caseIds = [...byCase.keys()];

  const [{ data: recentNotifs }, { data: caseRows }] = await Promise.all([
    sup.from('notifications').select('target_id').eq('target_type', 'case').eq('type', 'task_due')
      .in('target_id', caseIds).gte('created_at', new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()),
    sup.from('cases').select('id, title').in('id', caseIds),
  ]);
  const alreadyNotified = new Set((recentNotifs || []).map(n => n.target_id));
  const caseTitleById = Object.fromEntries((caseRows || []).map(c => [c.id, c.title]));

  let notified = 0;
  for (const [caseId, tasks] of byCase) {
    if (alreadyNotified.has(caseId)) continue;
    try {
      const recipients = await getCaseActivityRecipients(sup, caseId);
      if (!recipients.length) continue;
      const title = tasks.length > 1 ? `🔔 ${tasks.length} تذكيرات مستحقة` : '🔔 تذكير مستحق';
      const body = `القضية "${caseTitleById[caseId] || caseId}" — ${tasks.map(t => t.title).join('، ')}`;
      await notifyUsers(sup, recipients, { type: 'task_due', title, body, target_type: 'case', target_id: caseId });
      // The "result" the person who set the reminder actually asked to see
      // (in the AI Assistant page's own "المهام" section, GET /ai/tasks) --
      // without this, a task that fired had no visible sign of it having
      // fired at all outside the notification bell itself.
      await sup.from('case_tasks').update({ notified_at: new Date().toISOString() }).in('id', tasks.map(t => t.id));
      notified++;
    } catch (e) { console.error(`[deadlineChecker] task-due notify failed for case ${caseId}:`, e.message); }
  }
  return { checked: due.length, notified };
}

// Scans ai_requested_tasks (aiTools.js's set_reminder/log_requested_task,
// the personal/minute-precision counterpart to checkDueCaseTasks above)
// whose remind_at has arrived and hasn't been notified yet, and notifies
// ONLY the requesting user (not a whole case team -- these are personal by
// design). Run every minute by its own cron (cron.js's
// /api/cron/personal-reminders), not folded into the existing daily
// deadline-check cron -- day-granularity case reminders don't need
// per-minute polling, but "ذكّرني بعد دقيقتين" does.
async function checkDuePersonalTasks() {
  const sup = getSupabase();
  const { notifyUsers } = require('./notificationService');
  const nowIso = new Date().toISOString();

  const { data: due, error } = await sup.from('ai_requested_tasks')
    .select('id, user_id, case_id, note')
    .lte('remind_at', nowIso).is('notified_at', null).not('remind_at', 'is', null);
  if (error) throw error;
  if (!due || !due.length) return { checked: 0, notified: 0 };

  let notified = 0;
  for (const row of due) {
    try {
      await notifyUsers(sup, [row.user_id], {
        type: 'personal_reminder', title: '🔔 تذكير', body: row.note,
        target_type: row.case_id ? 'case' : null, target_id: row.case_id || null,
      });
      await sup.from('ai_requested_tasks').update({ notified_at: new Date().toISOString() }).eq('id', row.id);
      notified++;
    } catch (e) { console.error(`[deadlineChecker] personal-task notify failed for task ${row.id}:`, e.message); }
  }
  return { checked: due.length, notified };
}

// Scans ai_scheduled_messages (aiTools.js's draft_message_to_employee, when
// confirmed via "جدولة" rather than "إرسال الآن") whose send_at has arrived
// and actually sends them -- creates/reuses the dm and inserts the real
// message (internalMessaging.js, the same small helper the immediate-send
// route's own logic mirrors), marks the row 'sent', and notifies the
// original requester the send actually happened. Same select-then-loop-
// then-mark pattern as checkDueCaseTasks/checkDuePersonalTasks above -- no
// atomic claim needed (single long-lived Node process, one cron tick at a
// time). A per-row failure is marked 'failed' (logged, never silently
// retried forever) rather than left 'pending' to be retried every minute.
async function sendDueScheduledMessages() {
  const sup = getSupabase();
  const { notifyUsers } = require('./notificationService');
  const { getOrCreateDm, insertMessage } = require('./internalMessaging');
  const nowIso = new Date().toISOString();

  const { data: due, error } = await sup.from('ai_scheduled_messages')
    .select('id, requested_by, recipient_id, content')
    .eq('status', 'pending').lte('send_at', nowIso);
  if (error) throw error;
  if (!due || !due.length) return { checked: 0, sent: 0 };

  let sent = 0;
  for (const row of due) {
    // Atomic claim: only the caller whose UPDATE flips pending -> sending proceeds,
    // so overlapping cron calls (or a cancel racing the send) can never double-send
    // or send something that was just cancelled.
    const { data: claimed } = await sup.from('ai_scheduled_messages')
      .update({ status: 'sending' }).eq('id', row.id).eq('status', 'pending').select('id');
    if (!claimed || !claimed.length) continue;
    let conversationId = null;
    try {
      conversationId = await getOrCreateDm(sup, row.requested_by, row.recipient_id);
      await insertMessage(sup, { conversationId, senderId: row.requested_by, content: row.content, viaAi: true });
      await sup.from('ai_scheduled_messages').update({ status: 'sent', sent_at: new Date().toISOString(), conversation_id: conversationId }).eq('id', row.id);
      sent++;
    } catch (e) {
      console.error(`[deadlineChecker] scheduled-message send failed for row ${row.id}:`, e.message);
      await sup.from('ai_scheduled_messages').update({ status: 'failed' }).eq('id', row.id);
      continue;
    }
    // The message is already delivered and recorded -- a notification hiccup must
    // not flip it to 'failed' (the user could then resend a duplicate).
    try {
      await notifyUsers(sup, [row.requested_by], {
        type: 'scheduled_message_sent', title: '📨 تم إرسال رسالتك المجدولة', body: row.content,
        target_type: 'conversation', target_id: conversationId,
      });
    } catch (e) { console.error('[deadlineChecker] scheduled-message notify failed:', e.message); }
  }
  return { checked: due.length, sent };
}

module.exports = { checkOverdueDeadlines, checkDueCaseTasks, checkDuePersonalTasks, sendDueScheduledMessages };
