const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// GET /api/agencies
router.get('/agencies', (req, res) => {
  try {
    const db = getDatabase();
    const { search } = req.query;

    let sql = 'SELECT * FROM agencies';
    const params = [];

    if (search) {
      sql += ' WHERE name_ar LIKE ? OR name_en LIKE ? OR city LIKE ? OR state LIKE ?';
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    sql += ' ORDER BY name_en ASC';

    const agencies = db.prepare(sql).all(...params);
    res.json(agencies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agencies
router.post('/agencies', (req, res) => {
  try {
    const db = getDatabase();
    const { name_ar, name_en, state, city, type, email, phone, portal_url, notes } = req.body;

    if (!name_en) {
      return res.status(400).json({ error: 'name_en (English name) is required' });
    }

    const result = db.prepare(`
      INSERT INTO agencies (name_ar, name_en, state, city, type, email, phone, portal_url, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name_ar || null, name_en, state || null, city || null, type || null, email || null, phone || null, portal_url || null, notes || null);

    const newAgency = db.prepare('SELECT * FROM agencies WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(newAgency);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/agencies/:id
router.put('/agencies/:id', (req, res) => {
  try {
    const db = getDatabase();
    const agencyId = parseInt(req.params.id);

    const existing = db.prepare('SELECT * FROM agencies WHERE id = ?').get(agencyId);
    if (!existing) {
      return res.status(404).json({ error: 'Agency not found' });
    }

    const { name_ar, name_en, state, city, type, email, phone, portal_url, notes } = req.body;

    db.prepare(`
      UPDATE agencies SET
        name_ar = COALESCE(?, name_ar),
        name_en = COALESCE(?, name_en),
        state = COALESCE(?, state),
        city = COALESCE(?, city),
        type = COALESCE(?, type),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        portal_url = COALESCE(?, portal_url),
        notes = COALESCE(?, notes)
      WHERE id = ?
    `).run(
      name_ar !== undefined ? name_ar : null,
      name_en || null,
      state !== undefined ? state : null,
      city !== undefined ? city : null,
      type !== undefined ? type : null,
      email !== undefined ? email : null,
      phone !== undefined ? phone : null,
      portal_url !== undefined ? portal_url : null,
      notes !== undefined ? notes : null,
      agencyId
    );

    const updated = db.prepare('SELECT * FROM agencies WHERE id = ?').get(agencyId);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
