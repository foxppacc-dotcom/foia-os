const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// GET /api/cases/:caseId/requests
router.get('/cases/:caseId/requests', (req, res) => {
  try {
    const db = getDatabase();
    const caseId = parseInt(req.params.caseId);

    const requests = db.prepare(`
      SELECT r.*, pl.name_ar AS classification_name_ar, pl.name_en AS classification_name_en, 
             pl.color AS classification_color, a.name_en AS agency_name
      FROM requests r
      LEFT JOIN pipeline_lists pl ON r.classification_id = pl.id
      LEFT JOIN agencies a ON r.agency_id = a.id
      WHERE r.case_id = ?
      ORDER BY r.created_at DESC
    `).all(caseId);

    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cases/:caseId/requests
router.post('/cases/:caseId/requests', (req, res) => {
  try {
    const db = getDatabase();
    const caseId = parseInt(req.params.caseId);
    const { agency_id, status, classification_id, sent_date, response_date, notes } = req.body;

    // Verify case exists
    const caseRow = db.prepare('SELECT id FROM cases WHERE id = ?').get(caseId);
    if (!caseRow) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const result = db.prepare(`
      INSERT INTO requests (case_id, agency_id, status, classification_id, sent_date, response_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(caseId, agency_id || null, status || 'pending', classification_id || null, sent_date || null, response_date || null, notes || null);

    const newRequest = db.prepare('SELECT * FROM requests WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(newRequest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/requests/:id
router.put('/requests/:id', (req, res) => {
  try {
    const db = getDatabase();
    const requestId = parseInt(req.params.id);

    const existing = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!existing) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const { agency_id, status, classification_id, sent_date, response_date, notes } = req.body;

    db.prepare(`
      UPDATE requests SET
        agency_id = COALESCE(?, agency_id),
        status = COALESCE(?, status),
        classification_id = COALESCE(?, classification_id),
        sent_date = COALESCE(?, sent_date),
        response_date = COALESCE(?, response_date),
        notes = COALESCE(?, notes)
      WHERE id = ?
    `).run(
      agency_id !== undefined ? agency_id : null,
      status || null,
      classification_id !== undefined ? classification_id : null,
      sent_date !== undefined ? sent_date : null,
      response_date !== undefined ? response_date : null,
      notes !== undefined ? notes : null,
      requestId
    );

    const updated = db.prepare(`
      SELECT r.*, pl.name_ar AS classification_name_ar, pl.name_en AS classification_name_en, 
             pl.color AS classification_color, a.name_en AS agency_name
      FROM requests r
      LEFT JOIN pipeline_lists pl ON r.classification_id = pl.id
      LEFT JOIN agencies a ON r.agency_id = a.id
      WHERE r.id = ?
    `).get(requestId);

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/requests/:id/classification — move to different pipeline list
router.put('/requests/:id/classification', (req, res) => {
  try {
    const db = getDatabase();
    const requestId = parseInt(req.params.id);
    const { classification_id } = req.body;

    if (!classification_id) {
      return res.status(400).json({ error: 'classification_id is required' });
    }

    const existing = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!existing) {
      return res.status(404).json({ error: 'Request not found' });
    }

    // Verify classification exists
    const list = db.prepare('SELECT id FROM pipeline_lists WHERE id = ?').get(classification_id);
    if (!list) {
      return res.status(400).json({ error: 'Invalid classification_id' });
    }

    db.prepare('UPDATE requests SET classification_id = ? WHERE id = ?').run(classification_id, requestId);

    const updated = db.prepare(`
      SELECT r.*, pl.name_ar AS classification_name_ar, pl.name_en AS classification_name_en, 
             pl.color AS classification_color, a.name_en AS agency_name
      FROM requests r
      LEFT JOIN pipeline_lists pl ON r.classification_id = pl.id
      LEFT JOIN agencies a ON r.agency_id = a.id
      WHERE r.id = ?
    `).get(requestId);

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
