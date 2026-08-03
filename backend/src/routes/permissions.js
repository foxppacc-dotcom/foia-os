const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSupabase } = require('../supabase');

// Fixed catalog of resources/actions the UI renders as a matrix.
// The *values* (which role has which permission) live entirely in the
// role_permissions table — this list only defines the shape of the matrix.
const RESOURCES = [
  { key: 'cases', label: 'القضايا', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'agencies', label: 'الجهات', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'pipeline', label: 'خط الإنتاج', actions: ['view', 'move', 'edit'] },
  { key: 'production', label: 'مونتاج', actions: ['view', 'edit'] },
  { key: 'reports', label: 'التقارير', actions: ['view', 'export'] },
  { key: 'settings', label: 'الإعدادات', actions: ['view', 'manage'] },
  { key: 'users', label: 'المستخدمين', actions: ['invite', 'edit', 'delete'] },
  { key: 'email_accounts', label: 'حسابات البريد', actions: ['manage'] },
];

// Navigation visibility catalog — mirrors the Sidebar items exactly.
// Stored in role_permissions as resource='nav', action=<key>, allowed=true|false.
// A hidden item is simply not rendered in the Sidebar (no space, no disable).
const NAV_ITEMS = [
  { key: 'dashboard', label: 'لوحة التحكم' },
  { key: 'intake', label: 'استقبال ذكي' },
  { key: 'cases', label: 'القضايا' },
  { key: 'pipeline', label: 'خط الإنتاج' },
  { key: 'production', label: 'مونتاج' },
  { key: 'agencies', label: 'الجهات' },
  { key: 'portals', label: 'بوابات' },
  { key: 'inbox', label: 'صندوق الوارد' },
  { key: 'email_accounts', label: 'إيميلات' },
  { key: 'teams', label: 'الفرق' },
  { key: 'permissions', label: 'فريق العمل' },
  { key: 'gdrive', label: 'Google Drive' },
  { key: 'phone_logs', label: 'سجل المكالمات' },
  { key: 'mail_logs', label: 'البريد الفعلي' },
];

// Production Line visibility catalog — mirrors pipeline_lists (list_number).
// Stored in role_permissions as resource='production_line', action=<list_number>.
const PRODUCTION_LISTS = [
  { key: '1', label: 'لسته تم استلام السجلات' },
  { key: '2', label: 'لسته مطلوب دفع' },
  { key: '3', label: 'لسته مفيش سجلات متوفرة' },
  { key: '4', label: 'لسته تم الرفض بموجب القانون' },
  { key: '5', label: 'لسته القضية لسه مفتوحة' },
  { key: '6', label: 'لسته لا يستخدمون بودي كام' },
  { key: '7', label: 'لسته محتاجة تأكيد مواطنة' },
];

// Fallback only for the rare case the roles table is empty/unreachable --
// the real, editable role list lives in the `roles` table (teamManagement.js
// /roles CRUD), not hardcoded here, so newly-added custom roles show up in
// this matrix automatically.
const FALLBACK_ROLES = ['admin', 'manager', 'agent', 'editor', 'viewer'];

async function getRoleNames(sup) {
  const { data } = await sup.from('roles').select('name').order('sort_order');
  const names = (data || []).map(r => r.name).filter(n => n !== 'admin');
  return names.length ? names : FALLBACK_ROLES.filter(r => r !== 'admin');
}

// GET /api/permissions/schema — resource/action catalog + role list (for rendering the matrix)
router.get('/permissions/schema', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const roles = await getRoleNames(sup);
  res.json({ success: true, resources: RESOURCES, navItems: NAV_ITEMS, productionLists: PRODUCTION_LISTS, roles });
});

// GET /api/permissions — full matrix (all roles)
router.get('/permissions', requireAuth, requireRole('admin'), async (req, res) => {
  const sup = getSupabase();
  const { data, error } = await sup.from('role_permissions').select('*');
  if (error) return res.status(400).json({ error: error.message.includes('does not exist') ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (role_permissions)' : error.message });
  res.json({ success: true, data: data || [] });
});

// GET /api/permissions/mine — current user's own resolved permissions (used by frontend to decide what to show)
router.get('/permissions/mine', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const role = req.user.role;
  if (role === 'admin') {
    // Admin always has full access — no need to hit the table.
    return res.json({
      success: true, role, wildcard: true, permissions: [],
      navVisibility: Object.fromEntries(NAV_ITEMS.map(i => [i.key, true])),
      productionVisibility: Object.fromEntries(PRODUCTION_LISTS.map(l => [l.key, true])),
    });
  }
  const { data, error } = await sup.from('role_permissions').select('resource, action, allowed').eq('role', role);
  if (error) return res.json({ success: true, role, wildcard: false, permissions: [], navVisibility: {}, productionVisibility: {} });

  // Nav visibility: if the role has NO nav rows yet (not configured), default to
  // everything visible — a freshly created role must never lose its sidebar.
  const navRows = (data || []).filter(p => p.resource === 'nav');
  const navVisibility = {};
  for (const item of NAV_ITEMS) {
    const row = navRows.find(p => p.action === item.key);
    navVisibility[item.key] = navRows.length === 0 ? true : (row ? row.allowed !== false : false);
  }

  // Production line visibility: same default-open logic per list.
  const prodRows = (data || []).filter(p => p.resource === 'production_line');
  const productionVisibility = {};
  for (const list of PRODUCTION_LISTS) {
    const row = prodRows.find(p => p.action === list.key);
    productionVisibility[list.key] = prodRows.length === 0 ? true : (row ? row.allowed !== false : false);
  }

  res.json({
    success: true, role, wildcard: false,
    permissions: (data || []).filter(p => p.allowed !== false),
    navVisibility, productionVisibility,
  });
});

// PUT /api/permissions — upsert a single permission cell { role, resource, action, allowed }
router.put('/permissions', requireAuth, requireRole('admin'), async (req, res) => {
  const { role, resource, action, allowed } = req.body;
  if (!role || !resource || !action) return res.status(400).json({ error: 'role, resource, action مطلوبة' });

  const sup = getSupabase();
  const roles = await getRoleNames(sup);
  if (!roles.includes(role)) return res.status(400).json({ error: `Invalid role. Must be one of: ${roles.join(', ')}` });
  const { error } = await sup
    .from('role_permissions')
    .upsert({ role, resource, action, allowed: !!allowed }, { onConflict: 'role,resource,action' });

  if (error) return res.status(400).json({ error: error.message.includes('does not exist') ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (role_permissions)' : error.message });
  res.json({ success: true });
});

module.exports = router;
