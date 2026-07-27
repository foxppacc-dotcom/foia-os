const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getDatabase } = require('../database');

// All automation routes require auth
router.use(requireAuth);

// GET /api/automations — list all
router.get('/automations', (req, res) => {
  const db = getDatabase();
  const list = db.prepare('SELECT * FROM automations ORDER BY created_at DESC').all();
  res.json({ success: true, data: list });
});

// POST /api/automations — create
router.post('/automations', requireRole('admin'), (req, res) => {
  const { name, trigger_type, trigger_config, action_type, action_config } = req.body;
  if (!name || !trigger_type || !action_type) return res.status(400).json({ error: 'name, trigger_type, action_type required' });

  const db = getDatabase();
  const result = db.prepare(`
    INSERT INTO automations (name, trigger_type, trigger_config, action_type, action_config)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, trigger_type, JSON.stringify(trigger_config || {}), action_type, JSON.stringify(action_config || {}));

  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /api/automations/:id — update
router.put('/automations/:id', requireRole('admin'), (req, res) => {
  const { name, trigger_type, trigger_config, action_type, action_config, is_active } = req.body;
  const db = getDatabase();
  const a = db.prepare('SELECT id FROM automations WHERE id = ?').get(parseInt(req.params.id));
  if (!a) return res.status(404).json({ error: 'Not found' });

  db.prepare(`
    UPDATE automations SET name=?, trigger_type=?, trigger_config=?, action_type=?, action_config=?, is_active=?
    WHERE id=?
  `).run(name, trigger_type, JSON.stringify(trigger_config||{}), action_type, JSON.stringify(action_config||{}), is_active ?? 1, parseInt(req.params.id));

  res.json({ success: true });
});

// DELETE /api/automations/:id
router.delete('/automations/:id', requireRole('admin'), (req, res) => {
  getDatabase().prepare('DELETE FROM automations WHERE id=?').run(parseInt(req.params.id));
  res.json({ success: true });
});

// POST /api/automations/:id/run — run manually
router.post('/automations/:id/run', requireRole('admin'), (req, res) => {
  const db = getDatabase();
  const a = db.prepare('SELECT * FROM automations WHERE id=?').get(parseInt(req.params.id));
  if (!a) return res.status(404).json({ error: 'Not found' });

  const result = executeAutomation(a, db);
  res.json({ success: true, result });
});

// POST /api/automations/run-all — run all active
router.post('/automations/run-all', requireRole('admin'), (req, res) => {
  const db = getDatabase();
  const list = db.prepare('SELECT * FROM automations WHERE is_active=1').all();
  const results = list.map(a => {
    try {
      return { name: a.name, result: executeAutomation(a, db) };
    } catch (e) {
      return { name: a.name, error: e.message };
    }
  });
  res.json({ success: true, results });
});

// GET /api/automations/logs — automation history
router.get('/automations/logs', (req, res) => {
  const db = getDatabase();
  const logs = db.prepare(`
    SELECT al.*, a.name AS automation_name, c.title AS case_title
    FROM automation_logs al
    LEFT JOIN automations a ON al.automation_id = a.id
    LEFT JOIN cases c ON al.case_id = c.id
    ORDER BY al.created_at DESC LIMIT 50
  `).all();
  res.json({ success: true, data: logs });
});

/**
 * Execute a single automation
 */
function executeAutomation(a, db) {
  const config = (() => { try { return JSON.parse(a.action_config || '{}'); } catch { return {}; } })();
  const result = { matched: 0, actions: [] };

  // CASE 1: Send follow-up for overdue deadlines
  if (a.action_type === 'follow_up_overdue') {
    const overdue = db.prepare(`
      SELECT id, title, deadline, status FROM cases
      WHERE deadline IS NOT NULL AND deadline < date('now') AND status != 'closed'
      LIMIT 20
    `).all();

    overdue.forEach(c => {
      db.prepare(`
        INSERT INTO communications (case_id, type, direction, subject, body, created_at)
        VALUES (?, 'email', 'outbound', ?, ?, datetime('now'))
      `).run(c.id, `متابعة الطلب — ${c.title}`, `هذا تذكير بأن الموعد النهائي ${c.deadline} قد مضى. نرجو المتابعة.`);

      db.prepare(`
        INSERT INTO case_comments (case_id, content, created_at)
        VALUES (?, ?, datetime('now'))
      `).run(c.id, `🤖 أتمتة: تم إرسال متابعة تلقائية للطلب المتأخر`);

      logAction(db, a.id, c.id, 'follow_up_sent');
      result.matched++;
      result.actions.push({ case_id: c.id, action: 'follow_up' });
    });
  }

  // CASE 2: Escalate high-priority cases without recent activity
  else if (a.action_type === 'escalate_stale_high') {
    const stale = db.prepare(`
      SELECT id, title, status, updated_at FROM cases
      WHERE priority = 'high' AND status = 'open'
      AND updated_at < datetime('now', '-3 days')
      LIMIT 10
    `).all();

    stale.forEach(c => {
      db.prepare(`UPDATE cases SET priority = 'high', status = 'in_progress' WHERE id = ?`).run(c.id);
      db.prepare(`INSERT INTO case_comments (case_id, content, created_at) VALUES (?, ?, datetime('now'))`)
        .run(c.id, `🚨 أتمتة: تم تصعيد القضية لعدم وجود نشاط لمدة 3 أيام`);
      logAction(db, a.id, c.id, 'escalated');
      result.matched++;
      result.actions.push({ case_id: c.id, action: 'escalated' });
    });
  }

  // CASE 3: Auto-classify newly created cases without classification
  else if (a.action_type === 'auto_classify') {
    const unclassified = db.prepare(`
      SELECT r.id, r.case_id, r.notes, c.title, c.description
      FROM requests r JOIN cases c ON r.case_id = c.id
      WHERE r.classification_id IS NULL AND c.status = 'open'
      LIMIT 20
    `).all();

    const textToClassify = (item) => `${item.title} ${item.description || ''} ${item.notes || ''}`.toLowerCase();

    unclassified.forEach(r => {
      const txt = textToClassify(r);
      let listId = null;
      if (/body[- ]?cam|footage|video|تسجيل|فيديو/.test(txt)) listId = 1;
      else if (/payment|fee|charge|رسوم|دفع/.test(txt)) listId = 2;
      else if (/no.*record|unavailable|doesn.*exist|مفيش|غير.*متوف/.test(txt)) listId = 3;
      else if (/denied|refused|reject|رفض|مرفوض/.test(txt)) listId = 4;
      else if (/court|pending|investigat|محكمة|قيد.*التحقيق/.test(txt)) listId = 5;
      else if (/no.*bodycam|doesn.*use|لا.*تستخدم/.test(txt)) listId = 6;
      else if (/citizenship|identity|إثبات|مواطنة|هوية/.test(txt)) listId = 7;

      if (listId) {
        db.prepare('UPDATE requests SET classification_id = ? WHERE id = ?').run(listId, r.id);
        logAction(db, a.id, r.case_id, `classified_to_${listId}`);
        result.matched++;
        result.actions.push({ case_id: r.case_id, request_id: r.id, list_id: listId });
      }
    });
  }

  // CASE 4: Notify about upcoming deadlines (within 3 days)
  else if (a.action_type === 'deadline_reminder') {
    const upcoming = db.prepare(`
      SELECT id, title, deadline FROM cases
      WHERE deadline IS NOT NULL AND deadline BETWEEN date('now') AND date('now', '+3 days') AND status != 'closed'
      LIMIT 20
    `).all();

    upcoming.forEach(c => {
      db.prepare(`INSERT INTO case_comments (case_id, content, created_at) VALUES (?, ?, datetime('now'))`)
        .run(c.id, `⏰ أتمتة: الموعد النهائي ${c.deadline} يقترب (خلال 3 أيام)`);
      logAction(db, a.id, c.id, 'reminder_sent');
      result.matched++;
      result.actions.push({ case_id: c.id, action: 'reminder' });
    });
  }

  // CASE 5: Auto-close cases where all requests are responded
  else if (a.action_type === 'auto_close_completed') {
    const candidates = db.prepare(`
      SELECT c.id, c.title FROM cases c
      WHERE c.status != 'closed'
      AND (SELECT COUNT(*) FROM requests r WHERE r.case_id = c.id AND r.status != 'responded') = 0
      AND (SELECT COUNT(*) FROM requests r WHERE r.case_id = c.id) > 0
      LIMIT 10
    `).all();

    candidates.forEach(c => {
      db.prepare("UPDATE cases SET status = 'closed', updated_at = datetime('now') WHERE id = ?").run(c.id);
      db.prepare(`INSERT INTO case_comments (case_id, content, created_at) VALUES (?, ?, datetime('now'))`)
        .run(c.id, `✅ أتمتة: تم إغلاق القضية — جميع الطلبات تم الرد عليها`);
      logAction(db, a.id, c.id, 'auto_closed');
      result.matched++;
      result.actions.push({ case_id: c.id, action: 'closed' });
    });
  }

  // Update last_run
  db.prepare('UPDATE automations SET last_run = datetime(\'now\') WHERE id = ?').run(a.id);

  return result;
}

function logAction(db, automationId, caseId, status) {
  db.prepare('INSERT INTO automation_logs (automation_id, case_id, status) VALUES (?, ?, ?)')
    .run(automationId, caseId, status);
}

module.exports = router;
