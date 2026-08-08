const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, requirePermission } = require('../middleware/auth');
const { getSupabase } = require('../supabase');

// ============ PRODUCTION / MONTAGE QUEUE ============

// GET /api/production — list all production queue items
router.get('/production', requireAuth, requirePermission('production', 'view'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { status } = req.query;

    let query = sup.from('production_queue')
      .select('*, cases!inner(title, uuid, status), users!left(name)')
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    // Drive-linked file counts (per case), fetched in one batch instead of a correlated subquery per row
    const caseIds = [...new Set((data || []).map(d => d.case_id))];
    let driveCounts = {};
    if (caseIds.length) {
      const { data: docs } = await sup.from('case_documents')
        .select('case_id')
        .in('case_id', caseIds)
        .eq('mime_type', 'application/vnd.google-apps.drive-link');
      (docs || []).forEach(d => { driveCounts[d.case_id] = (driveCounts[d.case_id] || 0) + 1; });
    }

    const items = (data || []).map(pq => ({
      ...pq,
      case_title: pq.cases?.title || null,
      case_uuid: pq.cases?.uuid || null,
      case_status: pq.cases?.status || null,
      assigned_user_name: pq.users?.name || null,
      drive_file_count: driveCounts[pq.case_id] || 0,
      cases: undefined, users: undefined,
    }));

    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/production/add — add case to production queue
router.post('/production/add', requireAuth, requirePermission('production', 'edit'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { case_id, assigned_to, priority, notes } = req.body;
    if (!case_id) return res.status(400).json({ error: 'case_id مطلوب' });
    const caseId = parseInt(case_id);

    const { data: caseRow } = await sup.from('cases').select('id, title, status, drive_folder_id, drive_folder_status').eq('id', caseId).maybeSingle();
    if (!caseRow) return res.status(404).json({ error: 'Case not found' });

    const { data: existing } = await sup.from('production_queue').select('id, status').eq('case_id', caseId).maybeSingle();
    if (existing) return res.status(409).json({ error: 'القضية موجودة مسبقاً في قائمة الإنتاج', id: existing.id });

    await sup.from('cases').update({ status: 'in_production', updated_at: new Date().toISOString() }).eq('id', caseId);

    const driveLink = caseRow.drive_folder_id ? `https://drive.google.com/drive/folders/${caseRow.drive_folder_id}` : null;

    const { data: created, error } = await sup.from('production_queue').insert({
      case_id: caseId, assigned_to: assigned_to ? parseInt(assigned_to) : null,
      priority: priority || 'medium', notes: notes || null,
      drive_folder_link: driveLink,
    }).select().single();
    if (error) throw error;

    try {
      await sup.from('activity_logs').insert({
        user_id: req.user?.id, user_name: req.user?.name,
        action_type: 'production_added', target_type: 'case', target_id: caseId,
        target_title: '🎬 تم تحويل القضية إلى قائمة الإنتاج (مونتاج)',
      });
    } catch (e) { console.error('[production] activity_logs insert failed:', e.message); }

    res.status(201).json({ success: true, id: created.id, drive_folder_link: driveLink });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/production/:id — update status / assignment
router.put('/production/:id', requireAuth, requirePermission('production', 'edit'), async (req, res) => {
  try {
    const sup = getSupabase();
    const id = parseInt(req.params.id);
    const { status, assigned_to, priority, notes, drive_folder_link } = req.body;

    const { data: existing } = await sup.from('production_queue').select('*').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const updates = {};
    if (status) {
      updates.status = status;
      if (status === 'completed') {
        updates.completed_at = new Date().toISOString();
        await sup.from('cases').update({ status: 'production_done', updated_at: new Date().toISOString() }).eq('id', existing.case_id);
        try {
          await sup.from('activity_logs').insert({
            user_id: req.user?.id, user_name: req.user?.name,
            action_type: 'production_completed', target_type: 'case', target_id: existing.case_id,
            target_title: '✅ تم الانتهاء من الإنتاج والمونتاج',
          });
        } catch (e) { console.error('[production] activity_logs insert failed:', e.message); }
      }
    }
    if (assigned_to !== undefined) updates.assigned_to = assigned_to || null;
    if (priority) updates.priority = priority;
    if (notes !== undefined) updates.notes = notes;
    if (drive_folder_link !== undefined) updates.drive_folder_link = drive_folder_link;

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });

    const { error } = await sup.from('production_queue').update(updates).eq('id', id);
    if (error) throw error;

    res.json({ success: true, message: '✅ تم تحديث حالة الإنتاج' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/production/:id — remove from queue
router.delete('/production/:id', requireAuth, requirePermission('production', 'edit'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { data: item } = await sup.from('production_queue').select('case_id').eq('id', parseInt(req.params.id)).maybeSingle();
    if (item) {
      await sup.from('cases').update({ status: 'open', updated_at: new Date().toISOString() }).eq('id', item.case_id);
    }
    const { error } = await sup.from('production_queue').delete().eq('id', parseInt(req.params.id));
    if (error) throw error;
    res.json({ success: true, message: '✅ تم إزالة القضية من قائمة الإنتاج' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/production/auto-check — auto-detect cases ready for production
router.post('/production/auto-check', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const sup = getSupabase();
    // Find cases where ALL requests are classified as "Records Received" (list_id=1)
    // and not already in production queue
    const { data: openCases } = await sup.from('cases').select('id, title, uuid').in('status', ['open', 'in_progress']);
    const { data: queued } = await sup.from('production_queue').select('case_id');
    const queuedIds = new Set((queued || []).map(q => q.case_id));

    const added = [];
    for (const c of (openCases || []).filter(c => !queuedIds.has(c.id))) {
      const { data: reqs } = await sup.from('requests').select('classification_id').eq('case_id', c.id);
      if (!reqs || reqs.length === 0) continue;
      const allReceived = reqs.every(r => r.classification_id === 1);
      if (!allReceived) continue;

      await sup.from('cases').update({ status: 'in_production', updated_at: new Date().toISOString() }).eq('id', c.id);
      await sup.from('production_queue').insert({ case_id: c.id, priority: 'medium', notes: 'تمت الإضافة تلقائياً — جميع السجلات متوفرة' });
      try {
        await sup.from('activity_logs').insert({
          action_type: 'production_auto_added', target_type: 'case', target_id: c.id,
          target_title: '🎬 أتمتة: تم تحويل القضية تلقائياً للإنتاج (اكتمال السجلات)',
        });
      } catch (e) { console.error('[production] auto-check activity_logs insert failed:', e.message); }
      added.push({ id: c.id, title: c.title });
      if (added.length >= 10) break;
    }

    res.json({ success: true, added_count: added.length, candidates: added });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
