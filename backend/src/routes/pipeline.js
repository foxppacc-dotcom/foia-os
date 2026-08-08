const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require("../middleware/auth");
router.use(requireAuth);
const { getSupabase } = require('../supabase');

// GET /api/pipeline — returns all 7 lists with their tasks grouped
router.get('/pipeline', requirePermission('pipeline', 'view'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { caseId, sort_by } = req.query;
    const sortOrder = sort_by === 'oldest' ? { ascending: true } : { ascending: false };

    const { data: lists } = await sup
      .from('pipeline_lists')
      .select('*')
      .order('list_number', { ascending: true });

    let tasksQuery = sup
      .from('case_tasks')
      .select(`*, pipeline_lists!left(name_ar, name_en, color), users!left(name)`)
      .order('created_at', { ascending: false });

    if (caseId) {
      tasksQuery = tasksQuery.eq('case_id', parseInt(caseId));
    }

    const { data: allTasks } = await tasksQuery;

    // Normalize joined fields
    const tasksMapped = (allTasks || []).map(t => ({
      ...t,
      list_name_ar: t.pipeline_lists?.name_ar || null,
      list_name_en: t.pipeline_lists?.name_en || null,
      list_color: t.pipeline_lists?.color || null,
      assigned_user_name: t.users?.name || null,
      pipeline_lists: undefined,
      users: undefined
    }));

    // Also get requests grouped by classification
    let requestsQuery = sup
      .from('requests')
      .select(`*, pipeline_lists!classification_id!left(name_ar, name_en, color), agencies!left(name_ar, name_en), cases!left(title)`)
      .order('created_at', { ascending: sortOrder === 'oldest' });

    if (caseId) {
      requestsQuery = requestsQuery.eq('case_id', parseInt(caseId));
    }

    const { data: allRequests } = await requestsQuery;

    // Normalize joined fields
    const requestsMapped = (allRequests || []).map(r => ({
      ...r,
      classification_name_ar: r.pipeline_lists?.name_ar || null,
      classification_name_en: r.pipeline_lists?.name_en || null,
      classification_color: r.pipeline_lists?.color || null,
      // Pipeline.jsx renders agency_name_ar on each card to distinguish
      // multiple requests for the same case (e.g. two agencies both landing
      // in "مطلوب دفع") -- this key was never set, so every card silently
      // fell back to showing nothing there, making distinct per-agency
      // cards look like unexplained duplicates of the same case.
      agency_name: r.agencies?.name_en || null,
      agency_name_ar: r.agencies?.name_ar || r.agencies?.name_en || null,
      case_title: r.cases?.title || null,
      pipeline_lists: undefined,
      agencies: undefined,
      cases: undefined
    }));

    // Sort by sort_order descending then created_at
    requestsMapped.sort((a, b) => {
      const aOrder = a.sort_order || 0;
      const bOrder = b.sort_order || 0;
      if (bOrder !== aOrder) return bOrder - aOrder;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    // Group by lists
    const pipeline = (lists || []).map(list => {
      const tasks = tasksMapped.filter(t => t.list_id === list.id);
      const items = requestsMapped.filter(r => r.classification_id === list.id);
      return {
        ...list,
        tasks,
        requests: items,
        count: tasks.length + items.length
      };
    });

    res.json(pipeline);
  } catch (err) {
    console.error('Error getting pipeline:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pipeline/tasks/:id — update task's list_id (drag-drop)
router.put('/pipeline/tasks/:id', requirePermission('pipeline', 'move'), async (req, res) => {
  try {
    const sup = getSupabase();
    const taskId = parseInt(req.params.id);
    const { list_id } = req.body;

    if (!list_id) {
      return res.status(400).json({ error: 'list_id is required' });
    }

    const { data: existing } = await sup
      .from('case_tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (!existing) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const { data: list } = await sup
      .from('pipeline_lists')
      .select('id')
      .eq('id', list_id)
      .single();

    if (!list) {
      return res.status(400).json({ error: 'Invalid list_id' });
    }

    const { error: moveErr } = await sup
      .from('case_tasks')
      .update({ list_id })
      .eq('id', taskId);
    if (moveErr) return res.status(400).json({ error: moveErr.message });

    const { data: updated } = await sup
      .from('case_tasks')
      .select(`*, pipeline_lists!left(name_ar, name_en, color)`)
      .eq('id', taskId)
      .single();

    if (updated) {
      updated.list_name_ar = updated.pipeline_lists?.name_ar || null;
      updated.list_name_en = updated.pipeline_lists?.name_en || null;
      updated.list_color = updated.pipeline_lists?.color || null;
      delete updated.pipeline_lists;
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
