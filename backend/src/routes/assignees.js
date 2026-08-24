const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, requirePermission } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const { logActivity } = require('../services/activityLogger');
const { notifyUsers } = require('../services/notificationService');
const { requireCaseAccess } = require('../services/caseAccess');
// The three /cases/:id/assignees routes below previously had no per-case
// access check -- a role restricted to its own assigned cases could
// read/replace/remove ANY case's team roster just by knowing its id.
const caseGate = requireCaseAccess('id');

// ==================== SPECIALTIES ====================

router.get('/specialties', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data: specialties } = await sup.from('specialties').select('*').order('id');
  res.json({ success: true, data: specialties || [] });
});

// ==================== CASE ASSIGNEES ====================

router.get('/cases/:id/assignees', requireAuth, caseGate, async (req, res) => {
  const sup = getSupabase();
  const { data: assignees } = await sup
    .from('case_assignees')
    .select(`*, users!inner(id, name, email, role), specialties!left(name_ar, name_en, icon)`)
    .eq('case_id', parseInt(req.params.id))
    .order('assigned_at');

  const mapped = (assignees || []).map(a => ({
    ...a,
    name: a.users?.name,
    email: a.users?.email,
    user_role: a.users?.role,
    specialty_name_ar: a.specialties?.name_ar || null,
    specialty_name_en: a.specialties?.name_en || null,
    specialty_icon: a.specialties?.icon || null,
    users: undefined,
    specialties: undefined
  }));

  res.json({ success: true, data: mapped });
});

router.post('/cases/:id/assignees', requireAuth, caseGate, async (req, res) => {
  const sup = getSupabase();
  const caseId = parseInt(req.params.id);
  const { user_ids, assignments } = req.body;

  if (assignments && Array.isArray(assignments)) {
    for (const a of assignments) {
      // Delete existing then insert/replace. Errors here were never
      // checked -- a failed insert (bad user_id, etc.) left that assignment
      // silently dropped, with the response still reporting success.
      const { error: delErr } = await sup.from('case_assignees').delete().eq('case_id', caseId).eq('user_id', a.user_id);
      if (delErr) console.error(`[assignees] delete failed for user ${a.user_id}:`, delErr.message);
      const { error: insErr } = await sup.from('case_assignees').insert({
        case_id: caseId,
        user_id: a.user_id,
        specialty_id: a.specialty_id || null,
        role: 'member',
        assigned_at: new Date().toISOString()
      });
      if (insErr) console.error(`[assignees] insert failed for user ${a.user_id}:`, insErr.message);
    }
  } else if (user_ids && Array.isArray(user_ids)) {
    // Get existing assignees
    const { data: existing } = await sup
      .from('case_assignees')
      .select('user_id')
      .eq('case_id', caseId);

    const existingIds = (existing || []).map(r => r.user_id);

    // Add new ones
    for (const uid of user_ids.filter(id => !existingIds.includes(id))) {
      const { error: insErr } = await sup.from('case_assignees').insert({ case_id: caseId, user_id: uid });
      if (insErr) console.error(`[assignees] insert failed for user ${uid}:`, insErr.message);
    }
    // Remove ones not in the list
    for (const uid of existingIds.filter(id => !user_ids.includes(id))) {
      const { error: delErr } = await sup.from('case_assignees').delete().eq('case_id', caseId).eq('user_id', uid);
      if (delErr) console.error(`[assignees] delete failed for user ${uid}:`, delErr.message);
    }
  } else {
    return res.status(400).json({ error: 'user_ids array or assignments array مطلوب' });
  }

  logActivity({
    user_id: req.user?.id, user_name: req.user?.name,
    action_type: 'assign', target_type: 'case', target_id: caseId,
    target_title: `القضية #${caseId}`, details: 'تم تحديث تعيينات الموظفين'
  });

  const { data: assignees } = await sup
    .from('case_assignees')
    .select(`*, users!inner(id, name, email, role), specialties!left(name_ar, name_en, icon)`)
    .eq('case_id', caseId);

  const mapped = (assignees || []).map(a => ({
    ...a,
    name: a.users?.name,
    email: a.users?.email,
    user_role: a.users?.role,
    specialty_name_ar: a.specialties?.name_ar || null,
    specialty_name_en: a.specialties?.name_en || null,
    specialty_icon: a.specialties?.icon || null,
    users: undefined,
    specialties: undefined
  }));

  res.json({ success: true, data: mapped });
});

router.delete('/cases/:id/assignees/:userId', requireAuth, caseGate, async (req, res) => {
  const sup = getSupabase();
  const caseId = parseInt(req.params.id);
  const userId = parseInt(req.params.userId);

  const { error } = await sup.from('case_assignees').delete().eq('case_id', caseId).eq('user_id', userId);
  if (error) return res.status(400).json({ error: error.message });

  logActivity({
    user_id: req.user?.id, user_name: req.user?.name,
    action_type: 'unassign', target_type: 'case', target_id: caseId,
    target_title: `القضية #${caseId}`, details: `تم إزالة الموظف #${userId}`
  });

  res.json({ success: true, message: 'تم إزالة الموظف' });
});

// ==================== LIST ASSIGNEES ====================

router.get('/pipeline/lists/:id/assignees', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data: assignees } = await sup
    .from('list_assignees')
    .select(`*, users!inner(id, name, email, role)`)
    .eq('list_id', parseInt(req.params.id));

  const mapped = (assignees || []).map(a => ({
    ...a,
    name: a.users?.name,
    email: a.users?.email,
    user_role: a.users?.role,
    users: undefined
  }));

  res.json({ success: true, data: mapped });
});

router.post('/pipeline/lists/:id/assignees', requireAuth, requirePermission('pipeline', 'edit'), async (req, res) => {
  const sup = getSupabase();
  const listId = parseInt(req.params.id);
  const { user_ids } = req.body;
  if (!user_ids || !Array.isArray(user_ids)) return res.status(400).json({ error: 'user_ids array مطلوب' });

  // Get existing assignees
  const { data: existing } = await sup
    .from('list_assignees')
    .select('user_id')
    .eq('list_id', listId);

  const existingIds = (existing || []).map(r => r.user_id);

  // Add new ones
  const newlyAdded = user_ids.filter(id => !existingIds.includes(id));
  for (const uid of newlyAdded) {
    const { error: insErr } = await sup.from('list_assignees').insert({ list_id: listId, user_id: uid });
    if (insErr) console.error(`[assignees] list_assignees insert failed for user ${uid}:`, insErr.message);
  }
  // Remove ones not in the list
  for (const uid of existingIds.filter(id => !user_ids.includes(id))) {
    const { error: delErr } = await sup.from('list_assignees').delete().eq('list_id', listId).eq('user_id', uid);
    if (delErr) console.error(`[assignees] list_assignees delete failed for user ${uid}:`, delErr.message);
  }

  if (newlyAdded.length) {
    try {
      const { data: list } = await sup.from('pipeline_lists').select('name_ar, name_en').eq('id', listId).maybeSingle();
      const listName = list?.name_ar || list?.name_en || `قائمة #${listId}`;
      await notifyUsers(sup, newlyAdded.filter(id => parseInt(id) !== req.user?.id), {
        type: 'list_assigned', title: '📋 تم تعيينك على قائمة إنتاج', body: `${req.user?.name || 'أحد الموظفين'} عيّنك على "${listName}"`,
        target_type: 'pipeline_list', target_id: listId,
      });
    } catch (e) { console.error('[assignees] list-assign notification failed:', e.message); }
  }

  const { data: assignees } = await sup
    .from('list_assignees')
    .select(`*, users!inner(id, name, email, role)`)
    .eq('list_id', listId);

  const mapped = (assignees || []).map(a => ({
    ...a,
    name: a.users?.name,
    email: a.users?.email,
    user_role: a.users?.role,
    users: undefined
  }));

  res.json({ success: true, data: mapped });
});

// ==================== USERS LIST ====================

router.get('/users/list', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data: users } = await sup.from('users').select('id, name, email, role').order('name');
  res.json({ success: true, data: users || [] });
});

// NOTE: GET /api/users/specialized used to be duplicated here. Both this
// file and users.js are mounted at '/api', and users.js loads first in
// index.js's routes array, so this copy never actually handled a request --
// removed rather than left as dead/diverging code (users.js has the
// maintained, N+1-free version).

module.exports = router;
