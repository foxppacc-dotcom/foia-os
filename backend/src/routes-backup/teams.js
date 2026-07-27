const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getDatabase } = require('../database');

// All teams routes require auth + admin or manager
router.use(requireAuth);

// GET /api/teams — list all teams
router.get('/teams', (req, res) => {
  const db = getDatabase();
  const teams = db.prepare(`
    SELECT t.*, (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id) AS member_count
    FROM teams t ORDER BY t.created_at DESC
  `).all();
  res.json({ success: true, data: teams });
});

// GET /api/teams/:id/members — team members
router.get('/teams/:id/members', (req, res) => {
  const db = getDatabase();
  const members = db.prepare('SELECT id, name, email, role FROM users WHERE team_id = ? ORDER BY name').all(parseInt(req.params.id));
  res.json({ success: true, data: members });
});

// Admin/Manager only from here
router.use(requireRole('admin', 'manager'));

// POST /api/teams — create team
router.post('/teams', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Team name required' });

  const db = getDatabase();
  const result = db.prepare('INSERT INTO teams (name) VALUES (?)').run(name);
  res.json({ success: true, id: result.lastInsertRowid, message: `✅ تم إنشاء فريق ${name}` });
});

// PUT /api/teams/:id — update team
router.put('/teams/:id', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Team name required' });

  const db = getDatabase();
  db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(name, parseInt(req.params.id));
  res.json({ success: true, message: '✅ تم تحديث الفريق' });
});

// DELETE /api/teams/:id
router.delete('/teams/:id', (req, res) => {
  const db = getDatabase();
  db.prepare('UPDATE users SET team_id = NULL WHERE team_id = ?').run(parseInt(req.params.id));
  db.prepare('DELETE FROM teams WHERE id = ?').run(parseInt(req.params.id));
  res.json({ success: true, message: '✅ تم حذف الفريق' });
});

module.exports = router;
