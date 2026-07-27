const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

/**
 * Email Accounts Management
 * Store SMTP/IMAP credentials for multiple email accounts
 */

// GET /api/email-accounts - List all email accounts
router.get('/email-accounts', (req, res) => {
  const db = getDatabase();
  const accounts = db.prepare('SELECT id, email, name, provider, daily_limit, sent_today, is_active FROM email_accounts ORDER BY created_at DESC').all();
  res.json({ success: true, data: accounts });
});

// POST /api/email-accounts - Add email account
router.post('/email-accounts', (req, res) => {
  const db = getDatabase();
  const { email, name, provider, smtp_host, smtp_port, smtp_user, smtp_pass, imap_host, imap_port, imap_user, imap_pass, daily_limit } = req.body;
  
  if (!email || !name) return res.status(400).json({ error: 'الإيميل والاسم مطلوبان' });

  const result = db.prepare(`
    INSERT INTO email_accounts (email, name, provider, smtp_host, smtp_port, smtp_user, smtp_pass, imap_host, imap_port, imap_user, imap_pass, daily_limit, sent_today, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
  `).run(email, name, provider || 'custom', smtp_host, smtp_port, smtp_user || email, smtp_pass, imap_host, imap_port, imap_user || email, imap_pass, daily_limit || 50);

  res.json({ success: true, id: result.lastInsertRowid });
});

// DELETE /api/email-accounts/:id
router.delete('/email-accounts/:id', (req, res) => {
  const db = getDatabase();
  db.prepare('DELETE FROM email_accounts WHERE id = ?').run(parseInt(req.params.id));
  res.json({ success: true });
});

/**
 * Unified Inbox — All communications across all cases
 */

// GET /api/email/inbox - Unified inbox
router.get('/inbox', (req, res) => {
  const db = getDatabase();
  const { limit = 50, offset = 0, type, direction, case_id } = req.query;

  let sql = `
    SELECT c.*, cas.title as case_title, cas.uuid as case_uuid
    FROM communications c
    LEFT JOIN cases cas ON c.case_id = cas.id
    WHERE 1=1
  `;
  const params = [];

  if (type) { sql += ' AND c.type = ?'; params.push(type); }
  if (direction) { sql += ' AND c.direction = ?'; params.push(direction); }
  if (case_id) { sql += ' AND c.case_id = ?'; params.push(parseInt(case_id)); }

  sql += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const items = db.prepare(sql).all(...params);
  const total = db.prepare('SELECT COUNT(*) as count FROM communications').get().count;

  res.json({ success: true, data: items, total });
});

/**
 * Internal messaging (MVP — simulates email)
 * Messages are stored as communications linked to cases
 */

// POST /api/email/send - Send internal message
router.post('/send', (req, res) => {
  const db = getDatabase();
  const { case_id, subject, body, to, cc } = req.body;

  if (!case_id || !subject || !body) {
    return res.status(400).json({ error: 'case_id, subject, and body are required' });
  }

  // Verify case exists
  const caseRow = db.prepare('SELECT id, title FROM cases WHERE id = ?').get(case_id);
  if (!caseRow) return res.status(404).json({ error: 'Case not found' });

  const result = db.prepare(`
    INSERT INTO communications (case_id, type, direction, subject, body, sender, recipient, created_at)
    VALUES (?, 'email', 'outbound', ?, ?, 'system@foia-os', ?, datetime('now'))
  `).run(case_id, subject, body, to || 'recipient@example.com');

  // Add timeline entry as a comment
  db.prepare(`
    INSERT INTO case_comments (case_id, content, created_at)
    VALUES (?, ?, datetime('now'))
  `).run(case_id, `📧 تم إرسال بريد: "${subject}"`);

  res.json({ success: true, id: result.lastInsertRowid, message: '📧 تم إرسال الرسالة' });
});

// POST /api/email/receive - Simulate receiving a message
router.post('/receive', (req, res) => {
  const db = getDatabase();
  const { case_id, subject, body, from, type } = req.body;

  if (!case_id || !subject || !body) {
    return res.status(400).json({ error: 'case_id, subject, body required' });
  }

  const result = db.prepare(`
    INSERT INTO communications (case_id, type, direction, subject, body, sender, recipient, created_at)
    VALUES (?, ?, 'inbound', ?, ?, ?, 'system@foia-os', datetime('now'))
  `).run(case_id, type || 'email', subject, body, from || 'external@agency.gov');

  // Auto-update request status if any pending
  const pendingRequest = db.prepare(`
    SELECT id FROM requests WHERE case_id = ? AND status = 'pending' LIMIT 1
  `).get(case_id);
  
  if (pendingRequest) {
    db.prepare('UPDATE requests SET status = ?, response_date = datetime(\'now\') WHERE id = ?')
      .run('responded', pendingRequest.id);
  }

  db.prepare(`
    INSERT INTO case_comments (case_id, content, created_at)
    VALUES (?, ?, datetime('now'))
  `).run(case_id, `📩 تم استلام رد: "${subject}"`);

  res.json({ success: true, id: result.lastInsertRowid, message: '📩 تم تسجيل الرد' });
});

module.exports = router;
