const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const { logActivity } = require('../services/activityLogger');
const { canAccessCase } = require('../services/caseAccess');
const { getNotStartedListId, effectiveListId, getListMeta } = require('../services/pipelineMeta');

// Per-list labels and milestones for the production pipeline. Everything is
// scoped to ONE list (list_id): the settings live inside the list, and a new
// list simply starts with empty sets. Managing them (create/rename/recolor/
// reorder/delete) needs pipeline:manage_labels; putting them on a card needs
// the ordinary pipeline:edit.

const KINDS = {
  labels: { table: 'pipeline_list_labels', singular: 'label', ar: 'Label' },
  milestones: { table: 'pipeline_list_milestones', singular: 'milestone', ar: 'Milestone' },
};
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_PER_LIST = 50;

function cleanName(v) {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
}

async function getLiveList(sup, listId) {
  if (!Number.isInteger(listId) || listId <= 0) return null;
  const { data } = await sup.from('pipeline_lists').select('id, name_ar, name_en').eq('id', listId).is('deleted_at', null).maybeSingle();
  return data || null;
}

function registerManagement(kindKey) {
  const { table, singular, ar } = KINDS[kindKey];

  // GET /pipeline/lists/:id/labels | milestones
  router.get(`/pipeline/lists/:id/${kindKey}`, requireAuth, requirePermission('pipeline', 'view'), async (req, res) => {
    try {
      const sup = getSupabase();
      const listId = parseInt(req.params.id);
      if (!(await getLiveList(sup, listId))) return res.status(404).json({ error: 'قائمة غير موجودة' });
      const meta = await getListMeta(sup, listId);
      res.json({ success: true, data: meta[kindKey] });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /pipeline/lists/:id/labels | milestones
  router.post(`/pipeline/lists/:id/${kindKey}`, requireAuth, requirePermission('pipeline', 'manage_labels'), async (req, res) => {
    try {
      const sup = getSupabase();
      const listId = parseInt(req.params.id);
      const list = await getLiveList(sup, listId);
      if (!list) return res.status(404).json({ error: 'قائمة غير موجودة' });

      const name = cleanName(req.body.name);
      const color = req.body.color || '#6B7280';
      if (!name || name.length > 40) return res.status(400).json({ error: 'الاسم مطلوب (حتى 40 حرفاً)' });
      if (!COLOR_RE.test(color)) return res.status(400).json({ error: 'اللون غير صالح (مثال: #3B82F6)' });

      const { data: existing } = await sup.from(table).select('id, name, sort_order').eq('list_id', listId).is('deleted_at', null);
      if ((existing || []).length >= MAX_PER_LIST) return res.status(400).json({ error: `الحد الأقصى ${MAX_PER_LIST} في القائمة الواحدة` });
      if ((existing || []).some(e => e.name.toLowerCase() === name.toLowerCase())) {
        return res.status(409).json({ error: 'يوجد عنصر بنفس الاسم في هذه القائمة' });
      }
      const nextOrder = (existing || []).reduce((m, e) => Math.max(m, e.sort_order || 0), 0) + 1;

      const { data: created, error } = await sup.from(table)
        .insert({ list_id: listId, name, color, sort_order: nextOrder })
        .select('id, list_id, name, color, sort_order').single();
      if (error) return res.status(400).json({ error: error.message });

      logActivity({
        user_id: req.user?.id, user_name: req.user?.name,
        action_type: `pipeline_${singular}_created`, target_type: 'pipeline_list', target_id: listId,
        target_title: list.name_ar, details: `إضافة ${ar} "${name}" في القائمة ${list.name_ar}`,
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // PUT /pipeline/lists/:id/labels/reorder | milestones/reorder  { ids: [...] }
  router.put(`/pipeline/lists/:id/${kindKey}/reorder`, requireAuth, requirePermission('pipeline', 'manage_labels'), async (req, res) => {
    try {
      const sup = getSupabase();
      const listId = parseInt(req.params.id);
      if (!(await getLiveList(sup, listId))) return res.status(404).json({ error: 'قائمة غير موجودة' });
      const ids = Array.isArray(req.body.ids) ? req.body.ids.map(n => parseInt(n)) : null;
      if (!ids || !ids.length || ids.some(n => !Number.isInteger(n))) return res.status(400).json({ error: 'ids مطلوبة' });

      const { data: current } = await sup.from(table).select('id').eq('list_id', listId).is('deleted_at', null);
      const currentIds = new Set((current || []).map(c => c.id));
      if (ids.some(id => !currentIds.has(id)) || new Set(ids).size !== ids.length) {
        return res.status(400).json({ error: 'قائمة ids تحتوي عناصر لا تنتمي لهذه القائمة' });
      }
      // Any live items not mentioned keep their relative order after the listed ones.
      const rest = [...currentIds].filter(id => !ids.includes(id));
      const finalOrder = [...ids, ...rest];
      for (let i = 0; i < finalOrder.length; i++) {
        const { error } = await sup.from(table).update({ sort_order: i + 1 }).eq('id', finalOrder[i]).eq('list_id', listId);
        if (error) return res.status(400).json({ error: error.message });
      }
      const meta = await getListMeta(sup, listId);
      res.json({ success: true, data: meta[kindKey] });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // PUT /pipeline/labels/:itemId | /pipeline/milestones/:itemId  { name?, color? }
  router.put(`/pipeline/${kindKey}/:itemId`, requireAuth, requirePermission('pipeline', 'manage_labels'), async (req, res) => {
    try {
      const sup = getSupabase();
      const itemId = parseInt(req.params.itemId);
      const { data: item } = await sup.from(table).select('id, list_id, name').eq('id', itemId).is('deleted_at', null).maybeSingle();
      if (!item) return res.status(404).json({ error: `${ar} غير موجود` });

      const updates = {};
      if (req.body.name !== undefined) {
        const name = cleanName(req.body.name);
        if (!name || name.length > 40) return res.status(400).json({ error: 'الاسم مطلوب (حتى 40 حرفاً)' });
        const { data: siblings } = await sup.from(table).select('id, name').eq('list_id', item.list_id).is('deleted_at', null);
        if ((siblings || []).some(s => s.id !== itemId && s.name.toLowerCase() === name.toLowerCase())) {
          return res.status(409).json({ error: 'يوجد عنصر بنفس الاسم في هذه القائمة' });
        }
        updates.name = name;
      }
      if (req.body.color !== undefined) {
        if (!COLOR_RE.test(req.body.color)) return res.status(400).json({ error: 'اللون غير صالح (مثال: #3B82F6)' });
        updates.color = req.body.color;
      }
      if (!Object.keys(updates).length) return res.status(400).json({ error: 'لا توجد تعديلات' });

      const { data: updated, error } = await sup.from(table).update(updates).eq('id', itemId)
        .select('id, list_id, name, color, sort_order').single();
      if (error) return res.status(400).json({ error: error.message });
      logActivity({
        user_id: req.user?.id, user_name: req.user?.name,
        action_type: `pipeline_${singular}_updated`, target_type: 'pipeline_list', target_id: item.list_id,
        details: `تعديل ${ar} "${item.name}"${updates.name ? ` → "${updates.name}"` : ''}`,
      });
      res.json({ success: true, data: updated });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // DELETE /pipeline/labels/:itemId | /pipeline/milestones/:itemId  (soft)
  router.delete(`/pipeline/${kindKey}/:itemId`, requireAuth, requirePermission('pipeline', 'manage_labels'), async (req, res) => {
    try {
      const sup = getSupabase();
      const itemId = parseInt(req.params.itemId);
      const { data: item } = await sup.from(table).select('id, list_id, name').eq('id', itemId).is('deleted_at', null).maybeSingle();
      if (!item) return res.status(404).json({ error: `${ar} غير موجود` });

      const { error } = await sup.from(table).update({ deleted_at: new Date().toISOString() }).eq('id', itemId);
      if (error) return res.status(400).json({ error: error.message });
      // Detach from cards right away so nothing dangles (read side filters on
      // deleted_at too, this just keeps the data tidy).
      if (kindKey === 'labels') await sup.from('request_labels').delete().eq('label_id', itemId);
      else await sup.from('requests').update({ milestone_id: null }).eq('milestone_id', itemId);

      logActivity({
        user_id: req.user?.id, user_name: req.user?.name,
        action_type: `pipeline_${singular}_deleted`, target_type: 'pipeline_list', target_id: item.list_id,
        details: `حذف ${ar} "${item.name}"`,
      });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
}

registerManagement('labels');
registerManagement('milestones');

// ---- card assignment ----

async function loadRequestForTagging(req, res) {
  const sup = getSupabase();
  const requestId = parseInt(req.params.id);
  const { data: request } = await sup.from('requests').select('id, case_id, classification_id, milestone_id').eq('id', requestId).is('deleted_at', null).maybeSingle();
  if (!request) { res.status(404).json({ error: 'Request not found' }); return null; }
  if (!(await canAccessCase(sup, req.user, request.case_id))) {
    res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    return null;
  }
  const listId = effectiveListId(request, await getNotStartedListId(sup));
  return { sup, request, listId };
}

// PUT /requests/:id/labels  { label_ids: [...] }  -- replaces the card's label set
router.put('/requests/:id/labels', requireAuth, requirePermission('pipeline', 'edit'), async (req, res) => {
  try {
    const ctx = await loadRequestForTagging(req, res);
    if (!ctx) return;
    const { sup, request, listId } = ctx;
    const raw = req.body.label_ids;
    if (!Array.isArray(raw)) return res.status(400).json({ error: 'label_ids مطلوبة' });
    const labelIds = [...new Set(raw.map(n => parseInt(n)))];
    if (labelIds.some(n => !Number.isInteger(n))) return res.status(400).json({ error: 'label_ids غير صالحة' });

    if (labelIds.length) {
      const { data: valid } = await sup.from('pipeline_list_labels').select('id').eq('list_id', listId).is('deleted_at', null).in('id', labelIds);
      if ((valid || []).length !== labelIds.length) return res.status(400).json({ error: 'بعض Labels لا تنتمي لقائمة هذه البطاقة' });
    }

    const { error: delErr } = await sup.from('request_labels').delete().eq('request_id', request.id);
    if (delErr) return res.status(400).json({ error: delErr.message });
    if (labelIds.length) {
      const { error: insErr } = await sup.from('request_labels').insert(labelIds.map(label_id => ({ request_id: request.id, label_id })));
      if (insErr) return res.status(400).json({ error: insErr.message });
    }
    const { data: labels } = labelIds.length
      ? await sup.from('pipeline_list_labels').select('id, name, color, sort_order').in('id', labelIds).order('sort_order').order('id')
      : { data: [] };

    logActivity({
      user_id: req.user?.id, user_name: req.user?.name,
      action_type: 'pipeline_card_labels', target_type: 'case', target_id: request.case_id,
      details: `تحديث Labels البطاقة: ${(labels || []).map(l => l.name).join('، ') || 'بدون'}`,
    });
    res.json({ success: true, data: (labels || []).map(l => ({ id: l.id, name: l.name, color: l.color })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /requests/:id/milestone  { milestone_id: id | null }
router.put('/requests/:id/milestone', requireAuth, requirePermission('pipeline', 'edit'), async (req, res) => {
  try {
    const ctx = await loadRequestForTagging(req, res);
    if (!ctx) return;
    const { sup, request, listId } = ctx;
    const raw = req.body.milestone_id;
    let milestone = null;
    if (raw !== null && raw !== undefined) {
      const mid = parseInt(raw);
      if (!Number.isInteger(mid)) return res.status(400).json({ error: 'milestone_id غير صالح' });
      const { data } = await sup.from('pipeline_list_milestones').select('id, name, color').eq('id', mid).eq('list_id', listId).is('deleted_at', null).maybeSingle();
      if (!data) return res.status(400).json({ error: 'Milestones لا تنتمي لقائمة هذه البطاقة' });
      milestone = data;
    }
    const { error } = await sup.from('requests').update({ milestone_id: milestone ? milestone.id : null }).eq('id', request.id);
    if (error) return res.status(400).json({ error: error.message });

    logActivity({
      user_id: req.user?.id, user_name: req.user?.name,
      action_type: 'pipeline_card_milestone', target_type: 'case', target_id: request.case_id,
      details: milestone ? `تحديد Milestone البطاقة: ${milestone.name}` : 'إزالة Milestone البطاقة',
    });
    res.json({ success: true, data: milestone });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
