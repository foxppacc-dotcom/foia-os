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

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — missing token' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, CONFIG.jwt.secret);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized — invalid token' });
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

module.exports = { requireAuth, requireRole, requirePermission, generateToken, bcrypt };
