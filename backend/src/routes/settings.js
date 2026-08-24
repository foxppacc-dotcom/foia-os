const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, requirePermission } = require('../middleware/auth');
const { getSupabase } = require('../supabase');

// GET /api/settings — get all settings
router.get('/settings', requireAuth, requirePermission('settings', 'view'), async (req, res) => {
  const sup = getSupabase();
  const { data: rows } = await sup.from('system_settings').select('key, value').order('key', { ascending: true });
  const settings = {};
  for (const r of rows || []) settings[r.key] = r.value;
  res.json({ success: true, data: settings });
});

// PUT /api/settings — update one or more settings
router.put('/settings', requireAuth, requirePermission('settings', 'manage'), async (req, res) => {
  const sup = getSupabase();
  const updates = req.body; // { key: value, key2: value2 }

  const allowedPrefixes = ['theme_', 'app_', 'general_', 'email_'];
  let count = 0;

  for (const [key, value] of Object.entries(updates)) {
    // Security: only allow known setting keys (those already in DB)
    const { data: exists } = await sup.from('system_settings').select('key').eq('key', key).maybeSingle();
    if (!exists) continue; // skip unknown keys

    const { error } = await sup
      .from('system_settings')
      .update({ value: String(value), updated_at: new Date().toISOString() })
      .eq('key', key);
    if (error) return res.status(400).json({ error: error.message });
    count++;
  }

  // Return updated set
  const { data: rows } = await sup.from('system_settings').select('key, value').order('key', { ascending: true });
  const settings = {};
  for (const r of rows || []) settings[r.key] = r.value;

  res.json({ success: true, updated: count, data: settings });
});

// POST /api/settings/reset — reset to defaults
router.post('/settings/reset', requireAuth, requirePermission('settings', 'manage'), async (req, res) => {
  const sup = getSupabase();
  const defaults = {
    theme_mode: 'light',
    theme_bg_primary: '#F8F9FA',
    theme_bg_secondary: '#FFFFFF',
    theme_bg_tertiary: '#F0F2F5',
    theme_bg_elevated: '#E8EAED',
    theme_border: '#DEE2E6',
    theme_text_primary: '#1A1A2E',
    theme_text_secondary: '#495057',
    theme_text_muted: '#6C757D',
    theme_accent: '#D4A843',
    theme_accent_hover: '#e4b84a',
    theme_danger: '#EF4444',
    theme_success: '#10B981',
    theme_warning: '#F59E0B',
  };

  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(defaults)) {
    const { error } = await sup
      .from('system_settings')
      .update({ value, updated_at: now })
      .eq('key', key);
    if (error) return res.status(400).json({ error: error.message });
  }

  res.json({ success: true, message: '✅ تم إعادة تعيين الإعدادات' });
});

// GET /api/settings/theme-css — get CSS variables string
router.get('/settings/theme-css', requireAuth, requirePermission('settings', 'view'), async (req, res) => {
  const sup = getSupabase();
  const { data: rows } = await sup.from("system_settings").select('key, value').like('key', 'theme_%');

  let css = ':root {\n';
  for (const r of rows || []) {
    const varName = '--' + r.key.replace('theme_', '');
    css += `  ${varName}: ${r.value};\n`;
  }
  css += '}\n';

  res.type('text/css');
  res.send(css);
});

module.exports = router;
