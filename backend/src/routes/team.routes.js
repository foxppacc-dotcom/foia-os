const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, hasPermission } = require('../middleware/auth');
router.use(requireAuth);
const { getSupabase } = require('../supabase');
const { notifyUsers, getCaseActivityRecipients } = require('../services/notificationService');

// /profile/:id and /kpi/:userId return someone else's private data --
// notifications, tasks, attendance -- readable before this by ANY logged-in
// user just by guessing an id in the URL, since this router only required
// requireAuth. Always allow viewing your OWN profile; viewing anyone else's
// (a manager assessing performance) requires the same permission the
// Permissions matrix already exposes.
async function canViewOtherProfile(req, res, targetId) {
  if (targetId === req.user?.id) return true;
  const sup = getSupabase();
  if (!(await hasPermission(sup, req.user, 'employee_performance', 'view'))) {
    res.status(403).json({ error: 'Forbidden — لا تملك صلاحية عرض ملف موظف آخر' });
    return false;
  }
  return true;
}

// GET /api/profile/:id
router.get('/profile/:id', async (req, res) => {
  try {
    const sup = getSupabase();
    const id = parseInt(req.params.id);
    if (!(await canViewOtherProfile(req, res, id))) return;
    const { data: user } = await sup.from('users').select('id, name, email, role, team_id, created_at').eq('id', id).single();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { data: tasks } = await sup.from('case_tasks').select('id, title, status, priority, due_date, created_at').eq('assigned_to', id).order('created_at', { ascending: false }).limit(20);

    // Every case this person is actually involved in -- case_tasks alone (the
    // "tasks" tab above) misses case-TEAM membership entirely, which is the
    // more common way people are attached to a case in this app. Union
    // case_assignees (modern, multi-person) with the legacy single
    // cases.assigned_to column, dedup by case id, so a manager reviewing
    // performance sees the full caseload, not just ad-hoc checklist tasks.
    let cases = [];
    try {
      // No FK-embed relied on here (`cases(...)` via case_assignees) --
      // PostgREST's schema-cache-based embeds have been unreliable elsewhere
      // in this codebase (see portals.js); batch-fetch by id instead, same
      // defensive pattern used throughout case_detail.routes.js.
      const [{ data: viaTeam }, { data: viaLegacy }] = await Promise.all([
        sup.from('case_assignees').select('case_id, role').eq('user_id', id),
        sup.from('cases').select('id, title, status').eq('assigned_to', id),
      ]);
      const teamCaseIds = [...new Set((viaTeam || []).map(r => r.case_id))];
      const { data: teamCases } = teamCaseIds.length
        ? await sup.from('cases').select('id, title, status').in('id', teamCaseIds)
        : { data: [] };
      const roleByCaseId = Object.fromEntries((viaTeam || []).map(r => [r.case_id, r.role]));

      const byId = {};
      for (const c of teamCases || []) byId[c.id] = { id: c.id, title: c.title, status: c.status, role: roleByCaseId[c.id] || null };
      for (const c of viaLegacy || []) if (!byId[c.id]) byId[c.id] = { id: c.id, title: c.title, status: c.status, role: null };
      cases = Object.values(byId);
    } catch (e) { cases = []; }

    // attendance_logs and notifications may not exist — wrap each independently
    let attendance = [];
    try { const r = await sup.from('attendance_logs').select('*').eq('user_id', id).order('date', { ascending: false }).limit(30); attendance = r.data || []; } catch(e) {}
    let notifications = [];
    try { const r = await sup.from('notifications').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(20); notifications = r.data || []; } catch(e) {}
    let unreadCount = { count: 0 };
    try { unreadCount = await sup.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', id).eq('is_read', false); } catch(e) {}

    const tasksCompleted = tasks?.filter(t => t.status === 'completed').length || 0;
    const tasksOnTime = tasks?.filter(t => t.status === 'completed' && (!t.due_date || new Date(t.completed_at) <= new Date(t.due_date))).length || 0;
    const overdue = tasks?.filter(t => t.status !== 'completed' && t.due_date && new Date(t.due_date) < new Date()).length || 0;

    res.json({
      user,
      tasks: tasks || [],
      cases,
      attendance: attendance || [],
      notifications: notifications || [],
      unreadCount: unreadCount.count || 0,
      kpi: { tasks_total: tasks?.length || 0, tasks_completed: tasksCompleted, tasks_on_time: tasksOnTime, tasks_overdue: overdue }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/profile/:id
router.put('/profile/:id', async (req, res) => {
  try {
    const sup = getSupabase();
    if (!(await canViewOtherProfile(req, res, parseInt(req.params.id)))) return;
    const { name } = req.body;
    // Only update columns that exist in the table
    const updates = {};
    if (name !== undefined) updates.name = name;
    const { error } = await sup.from('users').update(updates).eq('id', parseInt(req.params.id));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/notifications
router.get('/notifications', async (req, res) => {
  try {
    const sup = getSupabase();
    let { data, error } = await sup.from('notifications').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(50);
    if (error && error.message.includes('Could not find')) {
      return res.json({ data: [], unreadCount: 0 });
    }
    if (error) throw error;
    let unreadCount = { count: 0 };
    try { unreadCount = await sup.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', req.user.id).eq('is_read', false); } catch(e) {}
    res.json({ data: data || [], unreadCount: unreadCount.count || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/notifications/read-all
router.put('/notifications/read-all', async (req, res) => {
  try {
    const sup = getSupabase();
    try { await sup.from('notifications').update({ is_read: true }).eq('user_id', req.user.id).eq('is_read', false); } catch(e) {}
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/notifications/:id/read
router.put('/notifications/:id/read', async (req, res) => {
  try {
    const sup = getSupabase();
    await sup.from('notifications').update({ is_read: true }).eq('id', parseInt(req.params.id)).eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/attendance/check-in
router.post('/attendance/check-in', async (req, res) => {
  try {
    const sup = getSupabase();
    const today = new Date().toISOString().split('T')[0];
    const { data: existing } = await sup.from('attendance_logs').select('*').eq('user_id', req.user.id).eq('date', today).maybeSingle();
    if (existing) return res.json({ success: true, message: 'Already checked in', data: existing });
    const { data, error } = await sup.from('attendance_logs').insert({ user_id: req.user.id, date: today, check_in: new Date().toISOString(), status: 'present' }).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/attendance/check-out
router.put('/attendance/check-out', async (req, res) => {
  try {
    const sup = getSupabase();
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await sup.from('attendance_logs').update({ check_out: new Date().toISOString() }).eq('user_id', req.user.id).eq('date', today).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/attendance?user_id=&month=&year=
router.get('/attendance', async (req, res) => {
  try {
    const sup = getSupabase();
    const userId = parseInt(req.query.user_id) || req.user.id;
    let query = sup.from('attendance_logs').select('*').eq('user_id', userId).order('date', { ascending: false });
    if (req.query.month && req.query.year) {
      const start = `${req.query.year}-${String(req.query.month).padStart(2, '0')}-01`;
      const end = `${req.query.year}-${String(req.query.month).padStart(2, '0')}-31`;
      query = sup.from('attendance_logs').select('*').eq('user_id', userId).gte('date', start).lte('date', end).order('date', { ascending: false });
    }
    let { data, error } = await query;
    if (error && error.message.includes('Could not find')) {
      return res.json({ data: [] });
    }
    if (error) throw error;
    res.json({ data: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/tasks/mine
router.get('/tasks/mine', async (req, res) => {
  try {
    const sup = getSupabase();
    const { status, priority } = req.query;
    let query = sup.from('case_tasks').select('*').eq('assigned_to', req.user.id);
    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    
    // Batch fetch case titles separately (no FK join)
    let result = data || [];
    if (result.length > 0) {
      const caseIds = [...new Set(result.map(t => t.case_id).filter(Boolean))];
      if (caseIds.length) {
        const { data: cases } = await sup.from('cases').select('id, title').in('id', caseIds);
        const caseMap = {};
        (cases || []).forEach(c => caseMap[c.id] = c);
        result = result.map(t => ({ ...t, cases: caseMap[t.case_id] || null }));
      }
    }

    const now = new Date();
    const withMeta = result.map(t => ({
      ...t, overdue: t.due_date && t.status !== 'completed' && new Date(t.due_date) < now
    }));
    res.json({ data: withMeta });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/tasks/:id/status
router.put('/tasks/:id/status', async (req, res) => {
  try {
    const sup = getSupabase();
    const { status } = req.body;
    const updates = { status };
    if (status === 'completed') updates.completed_at = new Date().toISOString();
    const { error } = await sup.from('case_tasks').update(updates).eq('id', parseInt(req.params.id));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/kpi/:userId
router.get('/kpi/:userId', async (req, res) => {
  try {
    const sup = getSupabase();
    const userId = parseInt(req.params.userId);
    if (!(await canViewOtherProfile(req, res, userId))) return;
    const { data: tasks } = await sup.from('case_tasks').select('id, status, due_date, completed_at, priority').eq('assigned_to', userId);
    let { data: attendance, error: attErr } = await sup.from('attendance_logs').select('id, date, status').eq('user_id', userId);
    if (attErr) attendance = [];
    
    const total = tasks?.length || 0;
    const completed = tasks?.filter(t => t.status === 'completed').length || 0;
    const onTime = tasks?.filter(t => t.status === 'completed' && t.due_date && t.completed_at && new Date(t.completed_at) <= new Date(t.due_date)).length || 0;
    const overdue = tasks?.filter(t => t.status !== 'completed' && t.due_date && new Date(t.due_date) < new Date()).length || 0;
    const urgent = tasks?.filter(t => t.priority === 'urgent').length || 0;
    const present = attendance?.filter(a => a.status === 'present').length || 0;
    const absent = attendance?.filter(a => a.status === 'absent').length || 0;

    res.json({
      user_id: userId, total_tasks: total, completed_tasks: completed, overdue_tasks: overdue,
      urgent_tasks: urgent, on_time_rate: total > 0 ? Math.round((onTime / total) * 100) : 0,
      completion_rate: total > 0 ? Math.round((completed / total) * 100) : 0,
      attendance_days: attendance?.length || 0, present_days: present, absent_days: absent,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/notifications/backfill-case-activity — one-time, admin-triggered
// catch-up: the case-activity badge/notification system only started firing
// going forward from when it was built, so genuinely recent activity that
// happened just before that (a comment, an uploaded file, an email linked
// to a case) never got a notification at all and the badge stayed silent
// for it. This creates AT MOST ONE notification per (recipient, case, type)
// for real activity inside the given window -- never per individual old
// comment/document, so it can't flood anyone with dozens of historical
// entries, and it's safe to re-run (skips a case+type+recipient that
// already has a notification, from a prior run or from live firing).
router.post('/notifications/backfill-case-activity', requireRole('admin'), async (req, res) => {
  try {
    const sup = getSupabase();
    const days = Math.max(1, Math.min(90, parseInt(req.body?.days) || 7));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    let created = 0;

    const alreadyNotified = async (userId, type, caseId) => {
      const { data } = await sup.from('notifications').select('id')
        .eq('user_id', userId).eq('type', type).eq('target_type', 'case').eq('target_id', caseId).limit(1).maybeSingle();
      return !!data;
    };

    // 1. Mentions + general comments (both scopes: نقاش الفريق and قائمة التدقيق)
    // Excludes auto-generated system log rows that several routes insert
    // DIRECTLY into case_comments (never through the real POST /comments
    // route, so they never fire a live notification either): case
    // creation/Excel-import ('📋', cases.js), manual email send ('📧',
    // email.js), simulated email receipt ('📩', email.js), and the legacy
    // URL-registration upload route ('📄', documentCenter.js). None of these
    // are real team discussion and shouldn't count as "recent activity" any
    // more than case_created itself does (deliberately excluded from this
    // badge) -- first found for '📋' only, then found to recur for every
    // other direct-insert call site using the same emoji-prefix pattern.
    const SYSTEM_COMMENT_PREFIX = /^(📋|📧|📩|📄)/;
    const { data: rawComments } = await sup.from('case_comments').select('case_id, user_id, content, mentioned_user_ids').gte('created_at', since);
    const comments = (rawComments || []).filter(c => !SYSTEM_COMMENT_PREFIX.test(c.content || ''));
    const mentionedByCase = {}; // caseId -> Set(userId) already covered by a direct mention
    for (const c of comments || []) {
      const caseId = c.case_id;
      for (const uid of c.mentioned_user_ids || []) {
        if (uid === c.user_id) continue;
        if (!(await alreadyNotified(uid, 'case_comment_mention', caseId))) {
          await notifyUsers(sup, [uid], {
            type: 'case_comment_mention', title: '📣 تم توجيه ملاحظة إليك (نشاط سابق)',
            body: 'كانت هناك ملاحظة موجهة إليك خلال الفترة الماضية لم يصلك إشعار بها.',
            target_type: 'case', target_id: caseId,
          });
          created++;
        }
        (mentionedByCase[caseId] ||= new Set()).add(uid);
      }
    }
    const casesWithComments = [...new Set((comments || []).map(c => c.case_id))];
    for (const caseId of casesWithComments) {
      const recipients = (await getCaseActivityRecipients(sup, caseId)).filter(uid => !(mentionedByCase[caseId]?.has(uid)));
      for (const uid of recipients) {
        if (await alreadyNotified(uid, 'case_comment', caseId)) continue;
        await notifyUsers(sup, [uid], {
          type: 'case_comment', title: '💬 تعليقات جديدة (نشاط سابق)',
          body: 'تمت إضافة تعليقات على هذه القضية خلال الفترة الماضية.',
          target_type: 'case', target_id: caseId,
        });
        created++;
      }
    }

    // 2. Uploaded documents
    const { data: docs } = await sup.from('case_documents').select('case_id').gte('created_at', since);
    for (const caseId of [...new Set((docs || []).map(d => d.case_id))]) {
      const recipients = await getCaseActivityRecipients(sup, caseId);
      for (const uid of recipients) {
        if (await alreadyNotified(uid, 'document_uploaded', caseId)) continue;
        await notifyUsers(sup, [uid], {
          type: 'document_uploaded', title: '📎 ملفات جديدة (نشاط سابق)',
          body: 'تم رفع ملف على هذه القضية خلال الفترة الماضية.',
          target_type: 'case', target_id: caseId,
        });
        created++;
      }
    }

    // 3. Emails linked to a case (automatic match OR manual link -- both
    // just set communications.case_id, no separate "linked_at" column exists,
    // so created_at is the closest available signal for "recent").
    const { data: comms } = await sup.from('communications').select('case_id').not('case_id', 'is', null).gte('created_at', since);
    for (const caseId of [...new Set((comms || []).map(c => c.case_id))]) {
      const recipients = await getCaseActivityRecipients(sup, caseId);
      for (const uid of recipients) {
        if (await alreadyNotified(uid, 'email_received', caseId)) continue;
        await notifyUsers(sup, [uid], {
          type: 'email_received', title: '📩 بريد مرتبط بالقضية (نشاط سابق)',
          body: 'وصل أو تم ربط بريد إلكتروني بهذه القضية خلال الفترة الماضية.',
          target_type: 'case', target_id: caseId,
        });
        created++;
      }
    }

    res.json({ success: true, days, notifications_created: created });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
