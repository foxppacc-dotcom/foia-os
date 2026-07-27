const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// GET /api/cases/:caseId/communications
router.get('/cases/:caseId/communications', (req, res) => {
  try {
    const db = getDatabase();
    const caseId = parseInt(req.params.caseId);

    const communications = db.prepare(`
      SELECT * FROM communications WHERE case_id = ? ORDER BY created_at DESC
    `).all(caseId);

    // Parse JSON fields
    const parsed = communications.map(c => ({
      ...c,
      file_paths: c.file_paths ? JSON.parse(c.file_paths) : [],
      metadata: c.metadata ? JSON.parse(c.metadata) : {}
    }));

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cases/:caseId/communications
router.post('/cases/:caseId/communications', (req, res) => {
  try {
    const db = getDatabase();
    const caseId = parseInt(req.params.caseId);

    // Verify case exists
    const caseRow = db.prepare('SELECT id FROM cases WHERE id = ?').get(caseId);
    if (!caseRow) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const { type, direction, subject, body, sender, recipient, file_paths, metadata } = req.body;

    if (!type || !direction) {
      return res.status(400).json({ error: 'type and direction are required' });
    }

    const validTypes = ['email', 'phone', 'mail', 'portal', 'sms'];
    const validDirections = ['inbound', 'outbound'];

    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    }
    if (!validDirections.includes(direction)) {
      return res.status(400).json({ error: `Invalid direction. Must be one of: ${validDirections.join(', ')}` });
    }

    const result = db.prepare(`
      INSERT INTO communications (case_id, type, direction, subject, body, sender, recipient, file_paths, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      caseId, type, direction, subject || null, body || null,
      sender || null, recipient || null,
      file_paths ? JSON.stringify(file_paths) : null,
      metadata ? JSON.stringify(metadata) : null
    );

    const newComm = db.prepare('SELECT * FROM communications WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({
      ...newComm,
      file_paths: newComm.file_paths ? JSON.parse(newComm.file_paths) : [],
      metadata: newComm.metadata ? JSON.parse(newComm.metadata) : {}
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
