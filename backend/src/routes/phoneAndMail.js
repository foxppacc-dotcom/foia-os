const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getSupabase } = require('../supabase');

// ===================== PHONE LOGS =====================

// GET /api/cases/:caseId/phone-logs
router.get('/cases/:caseId/phone-logs', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { data, error } = await sup.from('phone_logs')
      .select('*, users!phone_logs_created_by_fkey(name)')
      .eq('case_id', parseInt(req.params.caseId))
      .order('created_at', { ascending: false });
    if (error) throw error;
    const logs = (data || []).map(l => ({ ...l, created_by_name: l.users?.name || null, users: undefined }));
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cases/:caseId/phone-logs
router.post('/cases/:caseId/phone-logs', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.caseId);
    const { direction, caller_name, caller_number, duration_seconds, summary, notes, recording_path } = req.body;
    if (!direction) return res.status(400).json({ error: 'direction (inbound/outbound) مطلوب' });

    const { data: created, error } = await sup.from('phone_logs').insert({
      case_id: caseId, direction, caller_name: caller_name || null, caller_number: caller_number || null,
      duration_seconds: duration_seconds || 0, summary: summary || null, notes: notes || null,
      recording_path: recording_path || null, created_by: req.user.id || null,
    }).select().single();
    if (error) throw error;

    // Also add as communication entry for unified inbox
    await sup.from('communications').insert({
      case_id: caseId, type: 'phone', direction,
      subject: direction === 'inbound' ? `📞 مكالمة واردة من ${caller_name || caller_number || 'مجهول'}` : `📞 مكالمة صادرة إلى ${caller_name || caller_number || 'مجهول'}`,
      body: summary || notes || 'مكالمة هاتفية',
    });

    res.status(201).json({ success: true, data: { ...created, created_by_name: req.user.name || null } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/phone-logs/:id
router.put('/phone-logs/:id', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { direction, caller_name, caller_number, duration_seconds, summary, notes, recording_path } = req.body;
    const updates = {};
    if (direction !== undefined) updates.direction = direction;
    if (caller_name !== undefined) updates.caller_name = caller_name;
    if (caller_number !== undefined) updates.caller_number = caller_number;
    if (duration_seconds !== undefined) updates.duration_seconds = duration_seconds;
    if (summary !== undefined) updates.summary = summary;
    if (notes !== undefined) updates.notes = notes;
    if (recording_path !== undefined) updates.recording_path = recording_path;

    const { error } = await sup.from('phone_logs').update(updates).eq('id', parseInt(req.params.id));
    if (error) throw error;
    res.json({ success: true, message: '✅ تم تحديث سجل المكالمة' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/phone-logs/:id
router.delete('/phone-logs/:id', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { error } = await sup.from('phone_logs').delete().eq('id', parseInt(req.params.id));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== PHYSICAL MAIL =====================

// GET /api/cases/:caseId/mail-logs
router.get('/cases/:caseId/mail-logs', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { data, error } = await sup.from('mail_logs')
      .select('*, users!mail_logs_created_by_fkey(name)')
      .eq('case_id', parseInt(req.params.caseId))
      .order('created_at', { ascending: false });
    if (error) throw error;
    const logs = (data || []).map(l => ({ ...l, created_by_name: l.users?.name || null, users: undefined }));
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cases/:caseId/mail-logs
router.post('/cases/:caseId/mail-logs', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.caseId);
    const { direction, mail_type, tracking_number, courier, sender_name, recipient_name, sent_date, received_date, notes, scanned_path } = req.body;
    if (!direction) return res.status(400).json({ error: 'direction مطلوب' });

    const { data: created, error } = await sup.from('mail_logs').insert({
      case_id: caseId, direction, mail_type: mail_type || 'letter', tracking_number: tracking_number || null,
      courier: courier || null, sender_name: sender_name || null, recipient_name: recipient_name || null,
      sent_date: sent_date || null, received_date: received_date || null, notes: notes || null,
      scanned_path: scanned_path || null, created_by: req.user.id || null,
    }).select().single();
    if (error) throw error;

    // Add as communication entry
    const mailLabel = mail_type === 'package' ? '📦' : '✉️';
    await sup.from('communications').insert({
      case_id: caseId, type: 'mail', direction,
      subject: `${mailLabel} ${direction === 'inbound' ? 'بريد وارد' : 'بريد صادر'} ${tracking_number ? `(${tracking_number})` : ''} - ${sender_name || recipient_name || ''}`,
      body: notes || '',
      metadata: JSON.stringify({ tracking_number, courier, mail_type }),
    });

    res.status(201).json({ success: true, data: { ...created, created_by_name: req.user.name || null } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/mail-logs/:id
router.put('/mail-logs/:id', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { direction, mail_type, tracking_number, courier, sender_name, recipient_name, sent_date, received_date, notes, scanned_path } = req.body;
    const updates = {};
    if (direction !== undefined) updates.direction = direction;
    if (mail_type !== undefined) updates.mail_type = mail_type;
    if (tracking_number !== undefined) updates.tracking_number = tracking_number;
    if (courier !== undefined) updates.courier = courier;
    if (sender_name !== undefined) updates.sender_name = sender_name;
    if (recipient_name !== undefined) updates.recipient_name = recipient_name;
    if (sent_date !== undefined) updates.sent_date = sent_date;
    if (received_date !== undefined) updates.received_date = received_date;
    if (notes !== undefined) updates.notes = notes;
    if (scanned_path !== undefined) updates.scanned_path = scanned_path;

    const { error } = await sup.from('mail_logs').update(updates).eq('id', parseInt(req.params.id));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/mail-logs/:id
router.delete('/mail-logs/:id', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { error } = await sup.from('mail_logs').delete().eq('id', parseInt(req.params.id));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
