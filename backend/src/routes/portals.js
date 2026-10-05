const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const { encrypt, decrypt } = require('../services/crypto');
const { isSafeLinkUrl } = require('../services/urlSafety');
const trash = require('../services/trash');

// ============ PORTAL CREDENTIALS MANAGEMENT ============
// No global error middleware/uncaughtException handler exists in this app
// (index.js) -- every route below previously destructured req.body with no
// try/catch, so a request sent with no/wrong Content-Type (req.body left
// undefined by express.json()) threw a synchronous, uncaught TypeError that
// crashed the entire Node process for every concurrent user. This file
// handles stored portal passwords, so it's wrapped uniformly rather than
// case-by-case.

// GET /api/portals — list all (passwords NOT in response)
router.get('/portals', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { data, error } = await sup
      .from('portal_credentials')
      .select('id, portal_name, portal_url, username, registered_email, is_active, last_used, notes, created_at, agency_id')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    // Batch-fetch agency names separately instead of an embedded
    // agencies!left(...) join -- PostgREST resolves that syntax off its FK
    // schema cache, which failed here ("Could not find a relationship
    // between 'portal_credentials' and 'agencies'") even though both tables
    // and the agency_id column are real. Same defensive pattern already used
    // for case_assignees/users in case_detail.routes.js.
    const agencyIds = [...new Set((data || []).map(p => p.agency_id).filter(Boolean))];
    let agencyMap = {};
    if (agencyIds.length) {
      const { data: agencies } = await sup.from('agencies').select('id, name_ar, name_en').in('id', agencyIds).is('deleted_at', null);
      (agencies || []).forEach(a => { agencyMap[a.id] = a; });
    }

    const mapped = (data || []).map(p => ({
      ...p,
      agency_name_ar: agencyMap[p.agency_id]?.name_ar || null,
      agency_name_en: agencyMap[p.agency_id]?.name_en || null,
    }));
    res.json({ success: true, data: mapped });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/portals — add new portal credential
router.post('/portals', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { agency_id, portal_name, portal_url, username, password, registered_email, notes } = req.body || {};

    if (!portal_name || !username || !password) {
      return res.status(400).json({ error: 'portal_name, username, password مطلوبون' });
    }
    // portal_url is rendered as a real <a href> on the Portals page with no
    // sanitization at render time -- a stored javascript:/data: URI would
    // execute in the app's own origin the moment anyone clicks it.
    if (portal_url && !isSafeLinkUrl(portal_url)) return res.status(400).json({ error: 'رابط البوابة غير صالح -- يجب أن يبدأ بـ http:// أو https://' });

    const { data, error } = await sup.from('portal_credentials').insert({
      agency_id: agency_id ? parseInt(agency_id) : null,
      portal_name, portal_url: portal_url || null,
      username, password_encrypted: encrypt(password),
      registered_email: registered_email || null, notes: notes || null,
      created_by: req.user.id,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true, id: data.id, message: '✅ تم إضافة بيانات الدخول' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/portals/:id/decrypt — get decrypted password (audit-logged)
router.post('/portals/:id/decrypt', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const sup = getSupabase();
    const id = parseInt(req.params.id);
    const { data: portal } = await sup.from('portal_credentials').select('*').eq('id', id).is('deleted_at', null).maybeSingle();
    if (!portal) return res.status(404).json({ error: 'Portal not found' });

    const decrypted = decrypt(portal.password_encrypted);
    if (decrypted === null) return res.status(500).json({ error: 'فشل فك التشفير' });

    await sup.from('portal_credentials').update({ last_used: new Date().toISOString() }).eq('id', id);
    try {
      await sup.from('activity_logs').insert({
        user_id: req.user.id, user_name: req.user.name,
        action_type: 'portal_credential_viewed', target_type: 'portal_credential', target_id: id,
        target_title: `👁️ ${portal.portal_name}`,
      });
    } catch (e) { console.error('[portals] activity_logs insert failed:', e.message); }

    res.json({ success: true, password: decrypted });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/portals/:id — update
router.put('/portals/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const sup = getSupabase();
    const id = parseInt(req.params.id);
    const { agency_id, portal_name, portal_url, username, password, registered_email, notes, is_active } = req.body || {};
    if (portal_url && !isSafeLinkUrl(portal_url)) return res.status(400).json({ error: 'رابط البوابة غير صالح -- يجب أن يبدأ بـ http:// أو https://' });

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

    // .select().single() surfaces "0 rows matched" (id doesn't exist, or
    // belongs to an already soft-deleted portal) as a real error instead of
    // silently returning {success:true} with nothing actually changed.
    const { data, error } = await sup.from('portal_credentials').update(updates).eq('id', id).is('deleted_at', null).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'بيانات الدخول غير موجودة' });
    res.json({ success: true, message: '✅ تم تحديث بيانات الدخول' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/portals/:id
router.delete('/portals/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { error } = await trash.softDelete(sup, { table: 'portal_credentials', id: parseInt(req.params.id), userId: req.user.id });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, message: '✅ تم حذف بيانات الدخول' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
