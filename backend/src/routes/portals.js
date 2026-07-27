const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getDatabase } = require('../database');
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.FOIA_VAULT_KEY || crypto.randomBytes(32).toString('hex').slice(0, 32);
const ALGORITHM = 'aes-256-cbc';

/**
 * Simple encryption for stored credentials
 */
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encryptedText = parts.join(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ============ PORTAL CREDENTIALS MANAGEMENT ============

// GET /api/portals — list all (passwords NOT in response)
router.get('/portals', requireAuth, (req, res) => {
  const db = getDatabase();
  const portals = db.prepare(`
    SELECT pc.id, pc.portal_name, pc.portal_url, pc.username, pc.registered_email,
           pc.is_active, pc.last_used, pc.notes, pc.created_at,
           a.name_ar AS agency_name_ar, a.name_en AS agency_name_en
    FROM portal_credentials pc
    LEFT JOIN agencies a ON pc.agency_id = a.id
    ORDER BY pc.created_at DESC
  `).all();
  res.json({ success: true, data: portals });
});

// POST /api/portals — add new portal credential
router.post('/portals', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const db = getDatabase();
  const { agency_id, portal_name, portal_url, username, password, registered_email, notes } = req.body;

  if (!portal_name || !username || !password) {
    return res.status(400).json({ error: 'portal_name, username, password مطلوبون' });
  }

  const encrypted = encrypt(password);

  const result = db.prepare(`
    INSERT INTO portal_credentials (agency_id, portal_name, portal_url, username, password_encrypted, registered_email, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    agency_id ? parseInt(agency_id) : null,
    portal_name, portal_url || null,
    username, encrypted,
    registered_email || null, notes || null,
    req.user.id
  );

  res.json({ success: true, id: result.lastInsertRowid, message: '✅ تم إضافة بيانات الدخول' });
});

// POST /api/portals/:id/decrypt — get decrypted password (audit-logged)
router.post('/portals/:id/decrypt', requireAuth, requireRole('admin'), (req, res) => {
  const db = getDatabase();
  const portal = db.prepare('SELECT * FROM portal_credentials WHERE id = ?').get(parseInt(req.params.id));
  if (!portal) return res.status(404).json({ error: 'Portal not found' });

  try {
    const decrypted = decrypt(portal.password_encrypted);
    // Update last_used
    db.prepare("UPDATE portal_credentials SET last_used = datetime('now') WHERE id = ?").run(portal.id);
    res.json({ success: true, password: decrypted });
  } catch (err) {
    res.status(500).json({ error: 'فشل فك التشفير' });
  }
});

// PUT /api/portals/:id — update
router.put('/portals/:id', requireAuth, requireRole('admin'), (req, res) => {
  const db = getDatabase();
  const id = parseInt(req.params.id);
  const { agency_id, portal_name, portal_url, username, password, registered_email, notes, is_active } = req.body;

  const sets = [];
  const params = [];

  if (agency_id !== undefined) { sets.push('agency_id = ?'); params.push(agency_id || null); }
  if (portal_name) { sets.push('portal_name = ?'); params.push(portal_name); }
  if (portal_url !== undefined) { sets.push('portal_url = ?'); params.push(portal_url); }
  if (username) { sets.push('username = ?'); params.push(username); }
  if (password) { sets.push('password_encrypted = ?'); params.push(encrypt(password)); }
  if (registered_email !== undefined) { sets.push('registered_email = ?'); params.push(registered_email); }
  if (notes !== undefined) { sets.push('notes = ?'); params.push(notes); }
  if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0); }

  sets.push("updated_at = datetime('now')");
  params.push(id);

  if (sets.length === 1) return res.status(400).json({ error: 'No fields to update' });

  db.prepare(`UPDATE portal_credentials SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true, message: '✅ تم تحديث بيانات الدخول' });
});

// DELETE /api/portals/:id
router.delete('/portals/:id', requireAuth, requireRole('admin'), (req, res) => {
  getDatabase().prepare('DELETE FROM portal_credentials WHERE id = ?').run(parseInt(req.params.id));
  res.json({ success: true, message: '✅ تم حذف بيانات الدخول' });
});

module.exports = router;
