const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDatabase } = require('../database');

// ===================== PHONE LOGS =====================

// GET /api/cases/:caseId/phone-logs
router.get('/cases/:caseId/phone-logs', requireAuth, (req, res) => {
  try {
    const db = getDatabase();
    const logs = db.prepare(`
      SELECT pl.*, u.name AS created_by_name
      FROM phone_logs pl
      LEFT JOIN users u ON pl.created_by = u.id
      WHERE pl.case_id = ?
      ORDER BY pl.created_at DESC
    `).all(parseInt(req.params.caseId));
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cases/:caseId/phone-logs
router.post('/cases/:caseId/phone-logs', requireAuth, (req, res) => {
  try {
    const db = getDatabase();
    const caseId = parseInt(req.params.caseId);
    const { direction, caller_name, caller_number, duration_seconds, summary, notes, recording_path } = req.body;

    if (!direction) return res.status(400).json({ error: 'direction (inbound/outbound) مطلوب' });

    const result = db.prepare(`
      INSERT INTO phone_logs (case_id, direction, caller_name, caller_number, duration_seconds, summary, notes, recording_path, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      caseId, direction, caller_name || null, caller_number || null,
      duration_seconds || 0, summary || null, notes || null,
      recording_path || null, req.user.id || null
    );

    // Also add as communication entry for unified inbox
    db.prepare(`
      INSERT INTO communications (case_id, type, direction, subject, body, created_at)
      VALUES (?, 'phone', ?, ?, ?, datetime('now'))
    `).run(
      caseId, direction,
      direction === 'inbound' ? `📞 مكالمة واردة من ${caller_name || caller_number || 'مجهول'}` : `📞 مكالمة صادرة إلى ${caller_name || caller_number || 'مجهول'}`,
      summary || notes || 'مكالمة هاتفية'
    );

    const created = db.prepare(`SELECT pl.*, u.name AS created_by_name
      FROM phone_logs pl LEFT JOIN users u ON pl.created_by = u.id WHERE pl.id = ?`).get(result.lastInsertRowid);

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/phone-logs/:id
router.put('/phone-logs/:id', requireAuth, (req, res) => {
  try {
    const db = getDatabase();
    const id = parseInt(req.params.id);
    const { direction, caller_name, caller_number, duration_seconds, summary, notes, recording_path } = req.body;

    db.prepare(`
      UPDATE phone_logs SET
        direction = COALESCE(?, direction), caller_name = COALESCE(?, caller_name),
        caller_number = COALESCE(?, caller_number), duration_seconds = COALESCE(?, duration_seconds),
        summary = COALESCE(?, summary), notes = COALESCE(?, notes),
        recording_path = COALESCE(?, recording_path)
      WHERE id = ?
    `).run(direction || null, caller_name !== undefined ? caller_name : null, caller_number !== undefined ? caller_number : null,
      duration_seconds !== undefined ? duration_seconds : null, summary !== undefined ? summary : null,
      notes !== undefined ? notes : null, recording_path !== undefined ? recording_path : null, id);

    res.json({ success: true, message: '✅ تم تحديث سجل المكالمة' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/phone-logs/:id
router.delete('/phone-logs/:id', requireAuth, (req, res) => {
  getDatabase().prepare('DELETE FROM phone_logs WHERE id = ?').run(parseInt(req.params.id));
  res.json({ success: true });
});

// ===================== PHYSICAL MAIL =====================

// GET /api/cases/:caseId/mail-logs
router.get('/cases/:caseId/mail-logs', requireAuth, (req, res) => {
  try {
    const db = getDatabase();
    const logs = db.prepare(`
      SELECT ml.*, u.name AS created_by_name
      FROM mail_logs ml
      LEFT JOIN users u ON ml.created_by = u.id
      WHERE ml.case_id = ?
      ORDER BY ml.created_at DESC
    `).all(parseInt(req.params.caseId));
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cases/:caseId/mail-logs
router.post('/cases/:caseId/mail-logs', requireAuth, (req, res) => {
  try {
    const db = getDatabase();
    const caseId = parseInt(req.params.caseId);
    const { direction, mail_type, tracking_number, courier, sender_name, recipient_name, sent_date, received_date, notes, scanned_path } = req.body;

    if (!direction) return res.status(400).json({ error: 'direction مطلوب' });

    const result = db.prepare(`
      INSERT INTO mail_logs (case_id, direction, mail_type, tracking_number, courier, sender_name, recipient_name, sent_date, received_date, notes, scanned_path, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      caseId, direction, mail_type || 'letter', tracking_number || null, courier || null,
      sender_name || null, recipient_name || null, sent_date || null, received_date || null,
      notes || null, scanned_path || null, req.user.id || null
    );

    // Add as communication entry
    const mailLabel = mail_type === 'package' ? '📦' : '✉️';
    db.prepare(`
      INSERT INTO communications (case_id, type, direction, subject, body, metadata, created_at)
      VALUES (?, 'mail', ?, ?, ?, ?, datetime('now'))
    `).run(
      caseId, direction,
      `${mailLabel} ${direction === 'inbound' ? 'بريد وارد' : 'بريد صادر'} ${tracking_number ? `(${tracking_number})` : ''} - ${sender_name || recipient_name || ''}`,
      notes || '',
      JSON.stringify({ tracking_number, courier, mail_type })
    );

    const created = db.prepare(`SELECT ml.*, u.name AS created_by_name
      FROM mail_logs ml LEFT JOIN users u ON ml.created_by = u.id WHERE ml.id = ?`).get(result.lastInsertRowid);

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/mail-logs/:id
router.put('/mail-logs/:id', requireAuth, (req, res) => {
  try {
    const db = getDatabase();
    const id = parseInt(req.params.id);
    const { direction, mail_type, tracking_number, courier, sender_name, recipient_name, sent_date, received_date, notes, scanned_path } = req.body;

    db.prepare(`
      UPDATE mail_logs SET
        direction = COALESCE(?, direction), mail_type = COALESCE(?, mail_type),
        tracking_number = COALESCE(?, tracking_number), courier = COALESCE(?, courier),
        sender_name = COALESCE(?, sender_name), recipient_name = COALESCE(?, recipient_name),
        sent_date = COALESCE(?, sent_date), received_date = COALESCE(?, received_date),
        notes = COALESCE(?, notes), scanned_path = COALESCE(?, scanned_path)
      WHERE id = ?
    `).run(direction || null, mail_type || null, tracking_number || null, courier || null,
      sender_name !== undefined ? sender_name : null, recipient_name !== undefined ? recipient_name : null,
      sent_date !== undefined ? sent_date : null, received_date !== undefined ? received_date : null,
      notes !== undefined ? notes : null, scanned_path !== undefined ? scanned_path : null, id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/mail-logs/:id
router.delete('/mail-logs/:id', requireAuth, (req, res) => {
  getDatabase().prepare('DELETE FROM mail_logs WHERE id = ?').run(parseInt(req.params.id));
  res.json({ success: true });
});

module.exports = router;
