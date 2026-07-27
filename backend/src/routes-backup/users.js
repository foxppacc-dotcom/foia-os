const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, bcrypt } = require('../middleware/auth');
const { getDatabase } = require('../database');

// All routes require auth + admin role
router.use(requireAuth);
router.use(requireRole('admin'));

// GET /api/users — list all users
router.get('/users', (req, res) => {
  const db = getDatabase();
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.team_id, t.name AS team_name, u.created_at
    FROM users u
    LEFT JOIN teams t ON u.team_id = t.id
    ORDER BY u.created_at DESC
  `).all();
  res.json({ success: true, data: users });
});

// POST /api/users — create user
router.post('/users', (req, res) => {
  const { name, email, password, role, team_id } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, password required' });

  const validRoles = ['admin', 'manager', 'member', 'viewer'];
  if (role && !validRoles.includes(role)) return res.status(400).json({ error: `Invalid role. Must be: ${validRoles.join(', ')}` });

  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already exists' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (name, email, password_hash, role, team_id) VALUES (?, ?, ?, ?, ?)')
    .run(name, email, hash, role || 'member', team_id || null);

  res.json({ success: true, id: result.lastInsertRowid, message: `✅ تم إضافة ${name}` });
});

// PUT /api/users/:id — update user
router.put('/users/:id', (req, res) => {
  const { name, email, password, role, team_id } = req.body;
  const db = getDatabase();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(parseInt(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found' });

  const updates = [];
  const params = [];

  if (name) { updates.push('name = ?'); params.push(name); }
  if (email) { updates.push('email = ?'); params.push(email); }
  if (password) { updates.push('password_hash = ?'); params.push(bcrypt.hashSync(password, 10)); }
  if (role) { updates.push('role = ?'); params.push(role); }
  if (team_id !== undefined) { updates.push('team_id = ?'); params.push(team_id || null); }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  params.push(parseInt(req.params.id));
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  res.json({ success: true, message: '✅ تم تحديث المستخدم' });
});

// DELETE /api/users/:id
router.delete('/users/:id', (req, res) => {
  const db = getDatabase();
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'لا يمكن حذف نفسك' });

  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });

  res.json({ success: true, message: '✅ تم حذف المستخدم' });
});

module.exports = router;
