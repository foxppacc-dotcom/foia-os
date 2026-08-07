const express = require('express');
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
router.use(requireAuth);
const { getSupabase } = require('../supabase');

// GET /api/cases/:caseId/requests
router.get('/cases/:caseId/requests', async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.caseId);

    const { data: requests } = await sup
      .from('requests')
      .select(`*, pipeline_lists!left(name_ar, name_en, color), agencies!left(name_en)`)
      .eq('case_id', caseId)
      .order('created_at', { ascending: false });

    const mapped = (requests || []).map(r => ({
      ...r,
      classification_name_ar: r.pipeline_lists?.name_ar || null,
      classification_name_en: r.pipeline_lists?.name_en || null,
      classification_color: r.pipeline_lists?.color || null,
      agency_name: r.agencies?.name_en || null,
      pipeline_lists: undefined,
      agencies: undefined
    }));

    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cases/:caseId/requests
router.post('/cases/:caseId/requests', async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.caseId);
    const { agency_id, status, classification_id, sent_date, response_date, notes } = req.body;

    // Verify case exists
    const { data: caseRow } = await sup.from('cases').select('id').eq('id', caseId).single();
    if (!caseRow) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const { data: newRequest, error } = await sup
      .from('requests')
      .insert({
        case_id: caseId,
        agency_id: agency_id || null,
        status: status || 'pending',
        classification_id: classification_id || null,
        sent_date: sent_date || null,
        response_date: response_date || null,
        notes: notes || null
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(newRequest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/requests/:id
router.put('/requests/:id', async (req, res) => {
  try {
    const sup = getSupabase();
    const requestId = parseInt(req.params.id);

    const { data: existing } = await sup.from('requests').select('*').eq('id', requestId).single();
    if (!existing) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const { agency_id, status, classification_id, sent_date, response_date, notes } = req.body;

    const updates = {};
    if (agency_id !== undefined) updates.agency_id = agency_id;
    if (status !== undefined) updates.status = status;
    if (classification_id !== undefined) updates.classification_id = classification_id;
    if (sent_date !== undefined) updates.sent_date = sent_date;
    if (response_date !== undefined) updates.response_date = response_date;
    if (notes !== undefined) updates.notes = notes;

    const { error: updateErr } = await sup.from('requests').update(updates).eq('id', requestId);
    if (updateErr) return res.status(400).json({ error: updateErr.message });

    const { data: updated } = await sup
      .from('requests')
      .select(`*, pipeline_lists!left(name_ar, name_en, color), agencies!left(name_en)`)
      .eq('id', requestId)
      .single();

    if (updated) {
      updated.classification_name_ar = updated.pipeline_lists?.name_ar || null;
      updated.classification_name_en = updated.pipeline_lists?.name_en || null;
      updated.classification_color = updated.pipeline_lists?.color || null;
      updated.agency_name = updated.agencies?.name_en || null;
      delete updated.pipeline_lists;
      delete updated.agencies;
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NOTE: PUT /api/requests/:id/classification used to be duplicated here.
// cases.js registers the identical route and loads before this file in
// index.js's routes array (both mount at '/api'), so this copy never
// actually handled a request -- removed as dead code rather than left
// diverging (cases.js has the maintained, error-checked version).

// PUT /api/requests/:id/channel — update request channel method
router.put('/requests/:id/channel', async (req, res) => {
  try {
    const sup = getSupabase();
    const requestId = parseInt(req.params.id);
    const { channel_method, email_account_id, contact_value } = req.body;

    const { data: existing } = await sup.from('requests').select('*').eq('id', requestId).single();
    if (!existing) return res.status(404).json({ error: 'Request not found' });

    const { error: updateErr } = await sup
      .from('requests')
      .update({
        channel_method: channel_method || 'email',
        email_account_id: email_account_id || null,
        contact_value: contact_value || null
      })
      .eq('id', requestId);
    if (updateErr) return res.status(400).json({ error: updateErr.message });

    // Activity log
    const { logActivity } = require('../services/activityLogger');
    logActivity({
      user_id: req.user?.id, user_name: req.user?.name,
      action_type: 'update_channel',
      target_type: 'request',
      target_id: requestId,
      details: `طريقة الطلب: ${channel_method === 'email' ? '📧 إيميل' : channel_method === 'phone' ? '📞 هاتف' : channel_method === 'mail' ? '✉️ بريد' : '🌐 بوابة'}`
    });

    const { data: updated } = await sup
      .from('requests')
      .select(`*, agencies!left(name_ar, name_en)`)
      .eq('id', requestId)
      .single();

    if (updated) {
      updated.agency_name_ar = updated.agencies?.name_ar || null;
      updated.agency_name_en = updated.agencies?.name_en || null;
      delete updated.agencies;
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/requests/:id/sort — update sort order within a list
router.put('/requests/:id/sort', async (req, res) => {
  try {
    const sup = getSupabase();
    const requestId = parseInt(req.params.id);
    const { sort_order } = req.body;
    if (sort_order === undefined) return res.status(400).json({ error: 'sort_order مطلوب' });

    const { data: existing } = await sup.from('requests').select('*').eq('id', requestId).single();
    if (!existing) return res.status(404).json({ error: 'Request not found' });

    const { error } = await sup.from('requests').update({ sort_order }).eq('id', requestId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, sort_order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/requests/:id/acknowledge-overdue — mark a "تخطّى الموعد المتوقع
// للرد" item as seen/handled. Permanent (no route unmarks it, matching the
// requirement that this be a documented, undeletable record): drops the
// request off the system-wide Dashboard overdue panel, but stays visible
// inside the case itself as "تم الاطلاع من قبل <name>" instead of vanishing.
router.post('/requests/:id/acknowledge-overdue', async (req, res) => {
  try {
    const sup = getSupabase();
    const requestId = parseInt(req.params.id);

    const { data: existing } = await sup.from('requests').select('id, case_id, agency_id').eq('id', requestId).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Request not found' });

    const { error } = await sup.from('requests').update({
      overdue_ack_by: req.user.id,
      overdue_ack_at: new Date().toISOString(),
    }).eq('id', requestId);
    if (error) return res.status(400).json({ error: error.message.includes('overdue_ack') ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (overdue_ack_by/overdue_ack_at)' : error.message });

    const { data: agency } = existing.agency_id
      ? await sup.from('agencies').select('name_ar, name_en').eq('id', existing.agency_id).maybeSingle()
      : { data: null };
    const agencyName = agency?.name_ar || agency?.name_en || 'جهة';

    try {
      await sup.from('activity_logs').insert({
        user_id: req.user.id, user_name: req.user.name,
        action_type: 'overdue_acknowledged', target_type: 'case', target_id: existing.case_id,
        target_title: `✅ تم الاطلاع على تخطي الموعد المتوقع للرد — ${agencyName}`,
      });
    } catch (e) { console.error('[acknowledge-overdue] activity_logs insert failed:', e.message); }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
