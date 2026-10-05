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
  // Only FAILED attempts count: employees behind one office IP logging in each
  // morning were burning the shared 20-per-15-min budget with successful logins.
  skipSuccessfulRequests: true,
  message: { error: 'محاولات دخول كثيرة جدًا -- حاول مرة أخرى بعد قليل' },
  standardHeaders: true, legacyHeaders: false,
});

// A bcrypt compare only ran when a user row was actually found -- an
// unknown email short-circuited on a fast DB miss, while a known email with
// a wrong password paid the full (deliberately slow) bcrypt cost every
// time. That latency gap is a timing side-channel an attacker can use to
// enumerate valid employee emails without ever seeing a different error
// message. Comparing against this fixed dummy hash on the "no such user"
// path costs the same bcrypt work either way, closing the gap -- the hash
// itself doesn't correspond to any real password, it only exists to burn
// the same CPU time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-just-for-timing', 10);

// POST /api/auth/login (primary)
router.post('/auth/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const sup = getSupabase();
    // Trashed (soft-deleted) accounts must not be able to log in.
    const { data: users, error } = await sup.from('users').select('*').eq('email', email).is('deleted_at', null).limit(1);

    const user = (!error && users && users.length) ? users[0] : null;
    // Always runs a real bcrypt compare, win or lose -- see DUMMY_HASH's own
    // comment above for why this matters (timing side-channel).
    const valid = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !valid) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.is_active === false) return res.status(403).json({ error: 'هذا الحساب غير نشط -- تواصل مع مدير النظام' });

    const token = generateToken(user);
    res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الدخول' });
  }
});

// POST /api/login — short alias
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const sup = getSupabase();
    // Trashed (soft-deleted) accounts must not be able to log in.
    const { data: users, error } = await sup.from('users').select('*').eq('email', email).is('deleted_at', null).limit(1);

    const user = (!error && users && users.length) ? users[0] : null;
    // Always runs a real bcrypt compare, win or lose -- see DUMMY_HASH's own
    // comment above for why this matters (timing side-channel).
    const valid = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !valid) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.is_active === false) return res.status(403).json({ error: 'هذا الحساب غير نشط -- تواصل مع مدير النظام' });

    const token = generateToken(user);
    res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الدخول' });
  }
});

// GET /api/auth/me — verify token
router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
