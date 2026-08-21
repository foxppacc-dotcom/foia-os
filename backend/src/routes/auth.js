const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { generateToken, bcrypt, requireAuth } = require('../middleware/auth');
const { getSupabase } = require('../supabase');

// No throttling previously existed on login -- unbounded credential
// stuffing/brute force against real employee accounts. Keyed on IP (the
// rate-limit default), not email, so this can't itself be used to lock out
// a specific known account by an attacker hammering it from elsewhere.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: { error: 'محاولات دخول كثيرة جدًا -- حاول مرة أخرى بعد قليل' },
  standardHeaders: true, legacyHeaders: false,
});

// POST /api/auth/login (primary)
router.post('/auth/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const sup = getSupabase();
    const { data: users, error } = await sup.from('users').select('*').eq('email', email).limit(1);

    if (error || !users || users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];
    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = generateToken(user);
    res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/login — short alias
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const sup = getSupabase();
    const { data: users, error } = await sup.from('users').select('*').eq('email', email).limit(1);

    if (error || !users || users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];
    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = generateToken(user);
    res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me — verify token
router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
