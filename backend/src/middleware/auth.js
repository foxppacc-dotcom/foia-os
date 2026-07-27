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

module.exports = { requireAuth, requireRole, generateToken, bcrypt };
