const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const { encrypt, decrypt } = require('../services/crypto');

// ============ PORTAL CREDENTIALS MANAGEMENT ============

// GET /api/portals — list all (passwords NOT in response)
router.get('/portals', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data, error } = await sup
    .from('portal_credentials')
    .select('id, portal_name, portal_url, username, registered_email, is_active, last_used, notes, created_at, agency_id, agencies!left(name_ar, name_en)')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const mapped = (data || []).map(p => ({
    ...p,
    agency_name_ar: p.agencies?.name_ar || null,
    agency_name_en: p.agencies?.name_en || null,
    agencies: undefined,
  }));
  res.json({ success: true, data: mapped });
});

// POST /api/portals — add new portal credential
router.post('/portals', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const sup = getSupabase();
  const { agency_id, portal_name, portal_url, username, password, registered_email, notes } = req.body;

  if (!portal_name || !username || !password) {
    return res.status(400).json({ error: 'portal_name, username, password مطلوبون' });
  }

  const { data, error } = await sup.from('portal_credentials').insert({
    agency_id: agency_id ? parseInt(agency_id) : null,
    portal_name, portal_url: portal_url || null,
    username, password_encrypted: encrypt(password),
    registered_email: registered_email || null, notes: notes || null,
    created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true, id: data.id, message: '✅ تم إضافة بيانات الدخول' });
});

// POST /api/portals/:id/decrypt — get decrypted password (audit-logged)
router.post('/portals/:id/decrypt', requireAuth, requireRole('admin'), async (req, res) => {
  const sup = getSupabase();
  const id = parseInt(req.params.id);
  const { data: portal } = await sup.from('portal_credentials').select('*').eq('id', id).maybeSingle();
  if (!portal) return res.status(404).json({ error: 'Portal not found' });

  const decrypted = decrypt(portal.password_encrypted);
  if (decrypted === null) return res.status(500).json({ error: 'فشل فك التشفير' });

  await sup.from('portal_credentials').update({ last_used: new Date().toISOString() }).eq('id', id);
  await sup.from('activity_logs').insert({
    user_id: req.user.id, user_name: req.user.name,
    action_type: 'portal_credential_viewed', target_type: 'portal_credential', target_id: id,
    target_title: `👁️ ${portal.portal_name}`,
  }).catch(e => console.error('[portals] activity_logs insert failed:', e.message));

  res.json({ success: true, password: decrypted });
});

// PUT /api/portals/:id — update
router.put('/portals/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const sup = getSupabase();
  const id = parseInt(req.params.id);
  const { agency_id, portal_name, portal_url, username, password, registered_email, notes, is_active } = req.body;

  const updates = { updated_at: new Date().toISOString() };
  if (agency_id !== undefined) updates.agency_id = agency_id || null;
  if (portal_name) updates.portal_name = portal_name;
  if (portal_url !== undefined) updates.portal_url = portal_url;
  if (username) updates.username = username;
  if (password) updates.password_encrypted = encrypt(password);
  if (registered_email !== undefined) updates.registered_email = registered_email;
  if (notes !== undefined) updates.notes = notes;
  if (is_active !== undefined) updates.is_active = !!is_active;

  if (Object.keys(updates).length === 1) return res.status(400).json({ error: 'No fields to update' });

  const { error } = await sup.from('portal_credentials').update(updates).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: '✅ تم تحديث بيانات الدخول' });
});

// DELETE /api/portals/:id
router.delete('/portals/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const sup = getSupabase();
  const { error } = await sup.from('portal_credentials').delete().eq('id', parseInt(req.params.id));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: '✅ تم حذف بيانات الدخول' });
});

module.exports = router;
