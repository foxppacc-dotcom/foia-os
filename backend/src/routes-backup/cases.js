const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// GET /api/cases — list all with filters
router.get('/cases', (req, res) => {
  try {
    const db = getDatabase();
    const { status, priority, agency, search } = req.query;

    let sql = `
      SELECT c.*, 
             a.name_en AS agency_name, a.name_ar AS agency_name_ar,
             u.name AS assigned_user_name,
             (SELECT COUNT(*) FROM requests r WHERE r.case_id = c.id) AS request_count
      FROM cases c
      LEFT JOIN agencies a ON c.agency_id = a.id
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += ' AND c.status = ?';
      params.push(status);
    }
    if (priority) {
      sql += ' AND c.priority = ?';
      params.push(priority);
    }
    if (agency) {
      sql += ' AND c.agency_id = ?';
      params.push(parseInt(agency));
    }
    if (search) {
      sql += ' AND (c.title LIKE ? OR c.client_name LIKE ? OR c.description LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    sql += ' ORDER BY c.created_at DESC';

    const cases = db.prepare(sql).all(...params);
    res.json(cases);
  } catch (err) {
    console.error('Error listing cases:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cases/:id — single case with all relations
router.get('/cases/:id', (req, res) => {
  try {
    const db = getDatabase();
    const caseId = parseInt(req.params.id);

    const caseRow = db.prepare(`
      SELECT c.*, 
             a.name_ar AS agency_name_ar, a.name_en AS agency_name_en,
             u.name AS assigned_user_name,
             creator.name AS created_by_name
      FROM cases c
      LEFT JOIN agencies a ON c.agency_id = a.id
      LEFT JOIN users u ON c.assigned_to = u.id
      LEFT JOIN users creator ON c.user_id = creator.id
      WHERE c.id = ?
    `).get(caseId);

    if (!caseRow) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const requests = db.prepare(`
      SELECT r.*, pl.name_ar AS classification_name_ar, pl.name_en AS classification_name_en, pl.color AS classification_color,
             a.name_en AS agency_name
      FROM requests r
      LEFT JOIN pipeline_lists pl ON r.classification_id = pl.id
      LEFT JOIN agencies a ON r.agency_id = a.id
      WHERE r.case_id = ?
      ORDER BY r.created_at DESC
    `).all(caseId);

    const communications = db.prepare(`
      SELECT * FROM communications WHERE case_id = ? ORDER BY created_at DESC
    `).all(caseId);

    const documents = db.prepare(`
      SELECT cd.*, u.name AS uploaded_by_name
      FROM case_documents cd
      LEFT JOIN users u ON cd.uploaded_by = u.id
      WHERE cd.case_id = ?
      ORDER BY cd.created_at DESC
    `).all(caseId);

    const tasks = db.prepare(`
      SELECT ct.*, pl.name_ar AS list_name_ar, pl.name_en AS list_name_en, pl.color AS list_color,
             u.name AS assigned_user_name
      FROM case_tasks ct
      LEFT JOIN pipeline_lists pl ON ct.list_id = pl.id
      LEFT JOIN users u ON ct.assigned_to = u.id
      WHERE ct.case_id = ?
      ORDER BY ct.created_at DESC
    `).all(caseId);

    const comments = db.prepare(`
      SELECT cc.*, u.name AS user_name
      FROM case_comments cc
      LEFT JOIN users u ON cc.user_id = u.id
      WHERE cc.case_id = ?
      ORDER BY cc.created_at DESC
    `).all(caseId);

    const labels = db.prepare(`
      SELECT l.* FROM labels l
      INNER JOIN case_labels cl ON l.id = cl.label_id
      WHERE cl.case_id = ?
    `).all(caseId);

    res.json({
      ...caseRow,
      requests,
      communications,
      documents,
      tasks,
      comments,
      labels
    });
  } catch (err) {
    console.error('Error getting case:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cases — create
router.post('/cases', (req, res) => {
  try {
    const db = getDatabase();
    const { title, description, status, priority, client_name, agency_id, user_id, assigned_to, deadline } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const { v4: uuidv4 } = require('uuid');
    const uuid = uuidv4();

    const result = db.prepare(`
      INSERT INTO cases (uuid, title, description, status, priority, client_name, agency_id, user_id, assigned_to, deadline)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuid, title, description || '', status || 'open', priority || 'medium', client_name || null, agency_id || null, user_id || null, assigned_to || null, deadline || null);

    const newCase = db.prepare('SELECT * FROM cases WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(newCase);
  } catch (err) {
    console.error('Error creating case:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/cases/:id — update
router.put('/cases/:id', (req, res) => {
  try {
    const db = getDatabase();
    const caseId = parseInt(req.params.id);

    const existing = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
    if (!existing) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const { title, description, status, priority, client_name, agency_id, user_id, assigned_to, deadline } = req.body;

    db.prepare(`
      UPDATE cases SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        status = COALESCE(?, status),
        priority = COALESCE(?, priority),
        client_name = COALESCE(?, client_name),
        agency_id = COALESCE(?, agency_id),
        user_id = COALESCE(?, user_id),
        assigned_to = COALESCE(?, assigned_to),
        deadline = COALESCE(?, deadline),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      title || null, description !== undefined ? description : null,
      status || null, priority || null,
      client_name !== undefined ? client_name : null,
      agency_id !== undefined ? agency_id : null,
      user_id !== undefined ? user_id : null,
      assigned_to !== undefined ? assigned_to : null,
      deadline !== undefined ? deadline : null,
      caseId
    );

    const updated = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
    res.json(updated);
  } catch (err) {
    console.error('Error updating case:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cases/:id
router.delete('/cases/:id', (req, res) => {
  try {
    const db = getDatabase();
    const caseId = parseInt(req.params.id);

    const existing = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
    if (!existing) {
      return res.status(404).json({ error: 'Case not found' });
    }

    db.prepare('DELETE FROM cases WHERE id = ?').run(caseId);
    res.json({ message: 'Case deleted successfully', id: caseId });
  } catch (err) {
    console.error('Error deleting case:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
