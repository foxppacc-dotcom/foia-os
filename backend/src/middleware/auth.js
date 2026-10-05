/**
 * Authentication middleware for FOIA OS.
 * Uses JWT from Authorization header. Secret from CONFIG (env var).
 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const CONFIG = require('../config');

function generateToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    CONFIG.jwt.secret,
    { expiresIn: '24h' }
  );
}

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — missing token' });
  }
  const token = authHeader.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, CONFIG.jwt.secret);
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized — invalid token' });
  }
  // Re-read the user's CURRENT role/active status on every request instead
  // of trusting the JWT's claims for its full 24h lifetime -- previously an
  // admin demoting a role or deactivating an account had no effect until
  // that user's existing token expired (up to 24h later), since every
  // permission check downstream reads req.user.role straight off the token.
  // requirePermission() already pays an equivalent per-request DB lookup for
  // non-admin roles, so this isn't a new class of cost, just closing the gap
  // for requests that never happened to hit that check.
  try {
    const { getSupabase } = require('../supabase');
    const sup = getSupabase();
    const { data: user, error: userErr } = await sup.from('users').select('id, name, email, role, is_active, deleted_at, password_changed_at').eq('id', decoded.id).maybeSingle();
    // A DB hiccup is NOT "invalid session": answering 401 made the frontend wipe
    // the token and reload, signing every active employee out over one blip.
    if (userErr) return res.status(503).json({ error: 'الخدمة غير متاحة مؤقتًا -- حاول مرة أخرى' });
    if (!user || user.is_active === false || user.deleted_at) {
      return res.status(401).json({ error: 'Unauthorized — الحساب غير نشط، يرجى تسجيل الدخول مجددًا' });
    }
    // A token issued BEFORE the account's most recent password change is a
    // token an incident-response password reset was specifically meant to
    // kill -- without this, a stolen JWT kept working for up to its full
    // 24h lifetime even after the compromised password was changed.
    // decoded.iat is seconds since epoch (JWT standard); password_changed_at
    // is a real timestamp -- compare in the same unit.
    if (user.password_changed_at && decoded.iat && Math.floor(new Date(user.password_changed_at).getTime() / 1000) > decoded.iat) {
      return res.status(401).json({ error: 'Unauthorized — تم تغيير كلمة المرور، يرجى تسجيل الدخول مجددًا' });
    }
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    next();
  } catch (e) {
    return res.status(503).json({ error: 'الخدمة غير متاحة مؤقتًا -- حاول مرة أخرى' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden — insufficient permissions' });
    }
    next();
  };
}

/**
 * Granular permission gate backed by role_permissions (role x resource x
 * action -> allowed), the same table the Permissions settings tab reads and
 * writes. Admin always passes without a lookup. Any other role passes only
 * if an admin has explicitly granted resource/action to their role from
 * that tab -- this is what actually makes "reduce or grant permissions"
 * mean something, instead of the old fixed requireRole('admin','manager')
 * gates that no amount of settings-tab clicking could ever change.
 */
function requirePermission(resource, action) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === 'admin') return next();
    try {
      const { getSupabase } = require('../supabase');
      const sup = getSupabase();
      const { data } = await sup.from('role_permissions')
        .select('allowed').eq('role', req.user.role).eq('resource', resource).eq('action', action).maybeSingle();
      if (data?.allowed) return next();
    } catch (e) { /* table not migrated yet -- fail closed, same as no permission granted */ }
    return res.status(403).json({ error: 'Forbidden — insufficient permissions' });
  };
}

/**
 * Same role_permissions lookup as requirePermission, but as a plain boolean
 * check instead of a hard route gate -- for routes where permission is one
 * of several ways to be allowed in (e.g. "own comment within 60s OR admin OR
 * this role's delete_any grant"), not the only way.
 */
async function hasPermission(sup, user, resource, action) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  try {
    const { data } = await sup.from('role_permissions')
      .select('allowed').eq('role', user.role).eq('resource', resource).eq('action', action).maybeSingle();
    return !!data?.allowed;
  } catch (e) { return false; }
}

module.exports = { requireAuth, requireRole, requirePermission, hasPermission, generateToken, bcrypt };
