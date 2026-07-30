const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const { logActivity } = require('../services/activityLogger');

// ==================== PIPELINE LIST MANAGEMENT ====================

// GET /api/pipeline-lists — جميع القوائم
router.get('/pipeline-lists', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data: lists } = await sup.from('pipeline_lists').select('*').order('list_number', { ascending: true });
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
router.put('/pipeline-lists/:id/reorder', requireAuth, requireRole('admin'), async (req, res) => {
  const sup = getSupabase();
  const id = parseInt(req.params.id);
  const { list_number } = req.body;
  if (!list_number) return res.status(400).json({ error: 'list_number مطلوب' });

  const { data: existing } = await sup.from('pipeline_lists').select('id').eq('id', id).single();
  if (!existing) return res.status(404).json({ error: 'قائمة غير موجودة' });

  const { data: allLists } = await sup
    .from('pipeline_lists')
    .select('id, list_number, name_ar, name_en, color')
    .order('list_number', { ascending: true });

  const all = allLists || [];
  const oldNum = all.find(l => l.id === id)?.list_number || 1;
  const newNum = Math.max(1, Math.min(list_number, all.length));

  // Reorder by reassigning all numbers sequentially
  const idx = all.findIndex(l => l.id === id);
  if (idx === -1) return res.status(404).json({ error: 'قائمة غير موجودة' });
  const [target] = all.splice(idx, 1);
  const newIdx = Math.max(0, Math.min(newNum - 1, all.length));
  all.splice(newIdx, 0, target);

  // Update each list's list_number
  for (let i = 0; i < all.length; i++) {
    await sup
      .from('pipeline_lists')
      .update({ list_number: i + 1 })
      .eq('id', all[i].id);
  }

  const { data: lists } = await sup
    .from('pipeline_lists')
    .select('*')
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

  await sup.from('pipeline_lists').update(updates).eq('id', id);

  const { data: updated } = await sup.from('pipeline_lists').select('*').eq('id', id).single();
  res.json({ success: true, data: updated });
});

// DELETE /api/pipeline-lists/:id — حذف قائمة (ينقل كل الطلبات إلى null)
router.delete('/pipeline-lists/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const sup = getSupabase();
  const id = parseInt(req.params.id);

  const { data: list } = await sup.from('pipeline_lists').select('*').eq('id', id).single();
  if (!list) return res.status(404).json({ error: 'قائمة غير موجودة' });

  // Unlink all requests in this list
  await sup.from('requests').update({ classification_id: null }).eq('classification_id', id);
  await sup.from('pipeline_lists').delete().eq('id', id);

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
router.get('/pipeline/lists/:id', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const listId = parseInt(req.params.id);

  const { data: list } = await sup.from('pipeline_lists').select('*').eq('id', listId).single();
  if (!list) return res.status(404).json({ error: 'قائمة غير موجودة' });

  const { data: requests } = await sup
    .from('requests')
    .select(`*, cases!left(title, uuid, priority), agencies!left(name_ar, name_en)`)
    .eq('classification_id', listId)
    .order('created_at', { ascending: false });

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

  res.json({ success: true, data: { ...list, requests: requestsMapped, assignees: assigneesMapped || [], activity: activity || [], count: requestsMapped.length } });
});

module.exports = router;
