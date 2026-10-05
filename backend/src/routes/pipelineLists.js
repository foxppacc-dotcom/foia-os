const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, requirePermission } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const { logActivity } = require('../services/activityLogger');
const { canViewAllCases, getVisibleCaseIds } = require('../services/caseAccess');
const trash = require('../services/trash');
const { attachLabelsAndMilestones, getListMeta, getNotStartedListId, remapProductionLineVisibility } = require('../services/pipelineMeta');

// ==================== PIPELINE LIST MANAGEMENT ====================

// GET /api/pipeline-lists — جميع القوائم
router.get('/pipeline-lists', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data: lists } = await sup.from('pipeline_lists').select('*').is('deleted_at', null).order('list_number', { ascending: true });
  res.json({ success: true, data: lists || [] });
});

// POST /api/pipeline-lists — إضافة قائمة جديدة
router.post('/pipeline-lists', requireAuth, requireRole('admin'), async (req, res) => {
  const sup = getSupabase();
  const { name_ar, name_en, color, description, icon, sla_days, reminder_days, responsible_team_id } = req.body;
  if (!name_ar || !name_en) return res.status(400).json({ error: 'name_ar و name_en مطلوبان' });

  // Get next list_number
  const { data: maxData } = await sup
    .from('pipeline_lists')
    .select('list_number')
    .order('list_number', { ascending: false })
    .limit(1);

  const maxNum = maxData?.[0]?.list_number || 0;

  const { data: created, error } = await sup
    .from('pipeline_lists')
    .insert({ list_number: maxNum + 1, name_ar, name_en, color: color || '#6B7280', description, icon, sla_days, reminder_days, responsible_team_id })
    .select()
    .single();

  if (error) throw error;

  logActivity({
    action_type: 'create_pipeline_list',
    target_type: 'pipeline_list',
    target_id: created.id,
    target_title: name_ar,
    details: `تم إضافة قائمة جديدة: ${name_ar}`
  });

  res.status(201).json({ success: true, data: created });
});

// PUT /api/pipeline-lists/:id/reorder — تغيير ترتيب القائمة
router.put('/pipeline-lists/:id/reorder', requireAuth, requirePermission('pipeline', 'reorder_lists'), async (req, res) => {
  const sup = getSupabase();
  const id = parseInt(req.params.id);
  const { list_number } = req.body;
  if (!list_number) return res.status(400).json({ error: 'list_number مطلوب' });

  const { data: existing } = await sup.from('pipeline_lists').select('id').eq('id', id).is('deleted_at', null).single();
  if (!existing) return res.status(404).json({ error: 'قائمة غير موجودة' });

  // Trashed lists must stay out of this index-math entirely -- their
  // list_number is meant to stay frozen while trashed (see the DELETE route
  // above), and including them here would both inflate `all.length` and
  // overwrite their frozen number with a live one.
  const { data: allLists } = await sup
    .from('pipeline_lists')
    .select('id, list_number, name_ar, name_en, color')
    .is('deleted_at', null)
    .order('list_number', { ascending: true });

  const all = allLists || [];
  const oldNum = all.find(l => l.id === id)?.list_number || 1;
  const newNum = Math.max(1, Math.min(list_number, all.length));

  // Reorder by reassigning all numbers sequentially
  const idx = all.findIndex(l => l.id === id);
  if (idx === -1) return res.status(404).json({ error: 'قائمة غير موجودة' });
  // Remember every list's number BEFORE the move: per-role Production Line
  // visibility (role_permissions resource='production_line') is keyed by
  // list_number, so it has to be re-pointed afterwards or a hidden list
  // would silently swap places with whichever list lands on its old number.
  const oldNumberById = new Map(all.map(l => [l.id, l.list_number]));
  // The live lists' numbers are NOT necessarily 1..N: trashed lists keep their
  // frozen numbers (e.g. 18 and 20), leaving gaps. Renumbering the live lists
  // to a clean 1..N would collide with those frozen numbers (UNIQUE). So the
  // reorder only PERMUTES the numbers the live lists already occupy: the k-th
  // slot (ascending) goes to whichever list ends up k-th.
  const slots = all.map(l => l.list_number);
  const [target] = all.splice(idx, 1);
  const newIdx = Math.max(0, Math.min(newNum - 1, all.length));
  all.splice(newIdx, 0, target);

  // list_number is INTEGER NOT NULL UNIQUE (immediate, non-deferrable), and
  // writing each row's FINAL number one at a time -- while the rest of the
  // table still holds its OLD number -- collides on essentially every
  // reorder: e.g. swapping list #1 and #2 tries to set list B's number to 1
  // while list A (not yet updated) still holds 1, so Postgres rejects the
  // very first UPDATE and nothing moves. Two-phase update avoids any
  // collision: first push every affected row to a guaranteed-unique negative
  // placeholder (nothing else can ever hold a negative list_number), THEN
  // assign the real final numbers once no row holds a conflicting old value.
  // Not atomic (no multi-statement transaction through PostgREST): if any write
  // fails midway, put every list back on its ORIGINAL number so a failure never
  // leaves lists stranded on the negative placeholders.
  const rollback = async () => {
    for (const l of all) await sup.from('pipeline_lists').update({ list_number: -l.id }).eq('id', l.id);
    for (const l of all) await sup.from('pipeline_lists').update({ list_number: oldNumberById.get(l.id) }).eq('id', l.id);
  };
  for (let i = 0; i < all.length; i++) {
    const { error: tempErr } = await sup.from('pipeline_lists').update({ list_number: -(i + 1) }).eq('id', all[i].id);
    if (tempErr) { await rollback(); return res.status(400).json({ error: tempErr.message }); }
  }
  for (let i = 0; i < all.length; i++) {
    const { error: reorderErr } = await sup
      .from('pipeline_lists')
      .update({ list_number: slots[i] })
      .eq('id', all[i].id);
    if (reorderErr) { await rollback(); return res.status(400).json({ error: reorderErr.message }); }
  }

  const newNumberByOld = new Map();
  all.forEach((l, i) => { if (oldNumberById.get(l.id) !== slots[i]) newNumberByOld.set(String(oldNumberById.get(l.id)), String(slots[i])); });
  await remapProductionLineVisibility(sup, newNumberByOld);

  const { data: lists } = await sup
    .from('pipeline_lists')
    .select('*')
    .is('deleted_at', null)
    .order('list_number', { ascending: true });

  res.json({ success: true, data: lists || [] });
});

// PUT /api/pipeline-lists/:id — تحديث قائمة (اسم، لون، وصف، إعدادات)
router.put('/pipeline-lists/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const sup = getSupabase();
  const id = parseInt(req.params.id);
  const { name_ar, name_en, color, description, icon, sla_days, reminder_days, responsible_team_id } = req.body;

  const updates = {};
  if (name_ar !== undefined) updates.name_ar = name_ar;
  if (name_en !== undefined) updates.name_en = name_en;
  if (color !== undefined) updates.color = color;
  if (description !== undefined) updates.description = description;
  if (icon !== undefined) updates.icon = icon;
  if (sla_days !== undefined) updates.sla_days = sla_days;
  if (reminder_days !== undefined) updates.reminder_days = reminder_days;
  if (responsible_team_id !== undefined) updates.responsible_team_id = responsible_team_id;

  const { error: updateErr } = await sup.from('pipeline_lists').update(updates).eq('id', id);
  if (updateErr) return res.status(400).json({ error: updateErr.message });

  const { data: updated } = await sup.from('pipeline_lists').select('*').eq('id', id).single();
  res.json({ success: true, data: updated });
});

// DELETE /api/pipeline-lists/:id — حذف قائمة (ينقل كل الطلبات إلى null)
router.delete('/pipeline-lists/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const sup = getSupabase();
  const id = parseInt(req.params.id);

  const { data: list } = await sup.from('pipeline_lists').select('*').eq('id', id).single();
  if (!list) return res.status(404).json({ error: 'قائمة غير موجودة' });

  // Soft delete only -- the list is restorable from سلة المحذوفات, so its
  // requests stay linked (classification_id untouched) and list_number stays
  // as-is. Both the unlink and the renumbering only happen for real, on
  // trash.permanentlyDelete (see trash.js's pipeline_lists special-case).
  const { error: deleteErr } = await trash.softDelete(sup, { table: 'pipeline_lists', id, userId: req.user.id });
  if (deleteErr) return res.status(400).json({ error: deleteErr.message });

  logActivity({
    action_type: 'delete_pipeline_list',
    target_type: 'pipeline_list',
    target_id: id,
    target_title: list.name_ar,
    details: `تم حذف القائمة: ${list.name_ar} (ونقل ${list.count || 0} بطاقة)`
  });

  res.json({ success: true, message: `✅ تم حذف القائمة: ${list.name_ar}` });
});

// GET /api/pipeline/lists/:id — تفاصيل قائمة (بطاقاتها + فريقها + activity)
router.get('/pipeline/lists/:id', requireAuth, requirePermission('pipeline', 'view'), async (req, res) => {
  const sup = getSupabase();
  const listId = parseInt(req.params.id);

  const { data: list } = await sup.from('pipeline_lists').select('*').eq('id', listId).is('deleted_at', null).single();
  if (!list) return res.status(404).json({ error: 'قائمة غير موجودة' });

  // Same case-visibility rule the board itself (pipeline.js) already
  // enforces -- without this, a role restricted to its own assigned cases
  // could still see every OTHER case's title/uuid/priority by opening a
  // pipeline list's detail page directly.
  const restricted = !(await canViewAllCases(sup, req.user.role));
  const visibleCaseIds = restricted ? await getVisibleCaseIds(sup, req.user.id) : null;
  if (restricted && !visibleCaseIds.length) {
    const emptyMeta = await getListMeta(sup, listId);
    return res.json({ success: true, data: { ...list, requests: [], assignees: [], activity: [], count: 0, labels: emptyMeta.labels, milestones: emptyMeta.milestones } });
  }

  // Same fix as GET /pipeline's board grouping: a request with
  // classification_id === null (never explicitly classified) belongs in
  // "لم يبدأ بعد" (Not Started) too, not just requests literally carrying
  // this list's id -- otherwise this exact list's own detail page shows
  // empty despite the board correctly counting those same requests in it.
  let requestsQuery = sup
    .from('requests')
    .select(`*, cases!left(title, uuid, priority), agencies!left(name_ar, name_en)`)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  requestsQuery = list.name_en === 'Not Started'
    ? requestsQuery.or(`classification_id.eq.${listId},classification_id.is.null`)
    : requestsQuery.eq('classification_id', listId);
  if (restricted) requestsQuery = requestsQuery.in('case_id', visibleCaseIds);
  const { data: requests } = await requestsQuery;

  const requestsMapped = (requests || []).map(r => ({
    ...r,
    case_title: r.cases?.title || null,
    case_uuid: r.cases?.uuid || null,
    case_priority: r.cases?.priority || null,
    agency_name_ar: r.agencies?.name_ar || null,
    agency_name_en: r.agencies?.name_en || null,
    cases: undefined,
    agencies: undefined
  }));
  await attachLabelsAndMilestones(sup, requestsMapped, await getNotStartedListId(sup));
  const listMeta = await getListMeta(sup, listId);

  const { data: assignees } = await sup
    .from('list_assignees')
    .select(`users!inner(id, name, email, role)`)
    .eq('list_id', listId);

  const assigneesMapped = (assignees || []).map(a => a.users);

  // For activity, we need to query activity_logs — but this goes through the service
  // which still uses SQLite. We'll use the supabase directly here.
  const { data: activity } = await sup
    .from('activity_logs')
    .select('*')
    .or(`and(target_type.eq.pipeline_list,target_id.eq.${listId}),target_type.eq.request`)
    .order('created_at', { ascending: false })
    .limit(20);

  res.json({ success: true, data: { ...list, requests: requestsMapped, assignees: assigneesMapped || [], activity: activity || [], count: requestsMapped.length, labels: listMeta.labels, milestones: listMeta.milestones } });
});

module.exports = router;
