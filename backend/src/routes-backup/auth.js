const express = require('express');
const router = express.Router();
const { generateToken, bcrypt, requireAuth } = require('../middleware/auth');
const { getDatabase } = require('../database');

// POST /api/auth/login
router.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const db = getDatabase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = generateToken(user);
  res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// GET /api/auth/me — verify token
router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
