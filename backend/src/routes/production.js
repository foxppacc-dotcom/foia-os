const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getDatabase } = require('../database');

// ============ PRODUCTION / MONTAGE QUEUE ============

// GET /api/production — list all production queue items
router.get('/production', requireAuth, (req, res) => {
  const db = getDatabase();
  const { status } = req.query;

  let sql = `
    SELECT pq.*, c.title AS case_title, c.uuid AS case_uuid, c.status AS case_status,
           u.name AS assigned_user_name,
           (SELECT COUNT(*) FROM case_documents cd WHERE cd.case_id = pq.case_id AND cd.mime_type = 'application/vnd.google-apps.drive-link') AS drive_file_count
    FROM production_queue pq
    JOIN cases c ON pq.case_id = c.id
    LEFT JOIN users u ON pq.assigned_to = u.id
    WHERE 1=1
  `;
  const params = [];

  if (status) { sql += ' AND pq.status = ?'; params.push(status); }

  sql += ' ORDER BY pq.created_at DESC';

  const items = db.prepare(sql).all(...params);
  res.json({ success: true, data: items });
});

// POST /api/production/add — add case to production queue
router.post('/production/add', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const db = getDatabase();
  const { case_id, assigned_to, priority, notes } = req.body;

  if (!case_id) return res.status(400).json({ error: 'case_id مطلوب' });

  // Check case exists
  const caseRow = db.prepare('SELECT id, title, status FROM cases WHERE id = ?').get(parseInt(case_id));
  if (!caseRow) return res.status(404).json({ error: 'Case not found' });

  // Check if already in queue
  const existing = db.prepare('SELECT id, status FROM production_queue WHERE case_id = ?').get(parseInt(case_id));
  if (existing) return res.status(409).json({ error: 'القضية موجودة مسبقاً في قائمة الإنتاج', id: existing.id });

  // Mark case status as in_production
  db.prepare("UPDATE cases SET status = 'in_production', updated_at = datetime('now') WHERE id = ?").run(parseInt(case_id));

  const result = db.prepare(`
    INSERT INTO production_queue (case_id, assigned_to, priority, notes)
    VALUES (?, ?, ?, ?)
  `).run(parseInt(case_id), assigned_to ? parseInt(assigned_to) : null, priority || 'medium', notes || null);

  // Add automatic Drive folder link if not set
  const gdriveFolder = db.prepare("SELECT description FROM cases WHERE id = ?").get(parseInt(case_id));
  let driveLink = null;
  try {
    const meta = JSON.parse(gdriveFolder.description || '{}');
    if (meta._gdrive?.folderId) {
      driveLink = `https://drive.google.com/drive/folders/${meta._gdrive.folderId}`;
      db.prepare('UPDATE production_queue SET drive_folder_link = ? WHERE id = ?').run(driveLink, result.lastInsertRowid);
    }
  } catch { /* ignore */ }

  db.prepare("INSERT INTO case_comments (case_id, content, created_at) VALUES (?, ?, datetime('now'))")
    .run(parseInt(case_id), '🎬 تم تحويل القضية إلى قائمة الإنتاج (مونتاج)');

  res.status(201).json({ success: true, id: result.lastInsertRowid, drive_folder_link: driveLink });
});

// PUT /api/production/:id — update status / assignment
router.put('/production/:id', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const db = getDatabase();
  const id = parseInt(req.params.id);
  const { status, assigned_to, priority, notes, drive_folder_link } = req.body;

  const existing = db.prepare('SELECT * FROM production_queue WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const sets = [];
  const params = [];

  if (status) {
    sets.push('status = ?'); params.push(status);
    if (status === 'completed') {
      sets.push("completed_at = datetime('now')");
      db.prepare("UPDATE cases SET status = 'production_done', updated_at = datetime('now') WHERE id = ?").run(existing.case_id);
      db.prepare("INSERT INTO case_comments (case_id, content, created_at) VALUES (?, ?, datetime('now'))")
        .run(existing.case_id, '✅ تم الانتهاء من الإنتاج والمونتاج');
    }
  }
  if (assigned_to !== undefined) { sets.push('assigned_to = ?'); params.push(assigned_to || null); }
  if (priority) { sets.push('priority = ?'); params.push(priority); }
  if (notes !== undefined) { sets.push('notes = ?'); params.push(notes); }
  if (drive_folder_link !== undefined) { sets.push('drive_folder_link = ?'); params.push(drive_folder_link); }

  if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

  params.push(id);
  db.prepare(`UPDATE production_queue SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  res.json({ success: true, message: '✅ تم تحديث حالة الإنتاج' });
});

// DELETE /api/production/:id — remove from queue
router.delete('/production/:id', requireAuth, requireRole('admin'), (req, res) => {
  const db = getDatabase();
  const item = db.prepare('SELECT case_id FROM production_queue WHERE id = ?').get(parseInt(req.params.id));
  if (item) {
    db.prepare("UPDATE cases SET status = 'open', updated_at = datetime('now') WHERE id = ?").run(item.case_id);
  }
  db.prepare('DELETE FROM production_queue WHERE id = ?').run(parseInt(req.params.id));
  res.json({ success: true, message: '✅ تم إزالة القضية من قائمة الإنتاج' });
});

// POST /api/production/auto-check — auto-detect cases ready for production
router.post('/production/auto-check', requireAuth, requireRole('admin'), (req, res) => {
  const db = getDatabase();
  // Find cases where ALL requests are classified as "Records Received" (list_id=1) 
  // and not already in production queue
  const candidates = db.prepare(`
    SELECT c.id, c.title, c.uuid
    FROM cases c
    WHERE c.status IN ('open', 'in_progress')
    AND c.id NOT IN (SELECT case_id FROM production_queue)
    AND (SELECT COUNT(*) FROM requests r WHERE r.case_id = c.id) > 0
    AND (SELECT COUNT(*) FROM requests r WHERE r.case_id = c.id AND r.classification_id != 1) = 0
    AND (SELECT COUNT(*) FROM requests r WHERE r.case_id = c.id AND r.classification_id = 1) > 0
    LIMIT 10
  `).all();

  const added = [];
  for (const c of candidates) {
    db.prepare("UPDATE cases SET status = 'in_production', updated_at = datetime('now') WHERE id = ?").run(c.id);
    db.prepare(`INSERT INTO production_queue (case_id, priority, notes) VALUES (?, 'medium', ?)`)
      .run(c.id, 'تمت الإضافة تلقائياً — جميع السجلات متوفرة');
    db.prepare("INSERT INTO case_comments (case_id, content) VALUES (?, '🎬 أتمتة: تم تحويل القضية تلقائياً للإنتاج (اكتمال السجلات)')")
      .run(c.id);
    added.push({ id: c.id, title: c.title });
  }

  res.json({ success: true, added_count: added.length, candidates: added });
});

module.exports = router;
