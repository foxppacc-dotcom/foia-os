const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSupabase } = require('../supabase');

// Fixed catalog of resources/actions the UI renders as a matrix.
// The *values* (which role has which permission) live entirely in the
// role_permissions table — this list only defines the shape of the matrix.
const RESOURCES = [
  { key: 'cases', label: 'القضايا', actions: ['view', 'view_all', 'create', 'edit', 'delete'] },
  { key: 'agencies', label: 'الجهات', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'pipeline', label: 'خط الإنتاج', actions: ['view', 'move', 'edit'] },
  { key: 'production', label: 'مونتاج', actions: ['view', 'edit'] },
  { key: 'reports', label: 'التقارير', actions: ['view', 'export'] },
  { key: 'timeline', label: 'الخط الزمني الشامل', actions: ['view'] },
  { key: 'settings', label: 'الإعدادات', actions: ['view', 'manage'] },
  { key: 'users', label: 'المستخدمين', actions: ['invite', 'edit', 'delete'] },
  { key: 'email_accounts', label: 'حسابات البريد', actions: ['manage'] },
];

// Navigation visibility catalog — mirrors the Sidebar items exactly.
// Stored in role_permissions as resource='nav', action=<key>, allowed=true|false.
// A hidden item is simply not rendered in the Sidebar (no space, no disable).
const NAV_ITEMS = [
  { key: 'dashboard', label: 'لوحة التحكم' },
  { key: 'settings', label: 'الإعدادات (زر أسفل القائمة الجانبية)' },
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
  { key: 'production_lists', label: 'إدارة قوائم الإنتاج' },
  { key: 'theme_settings', label: 'الألوان والثيم' },
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

// These sidebar nav items map 1:1 onto a RESOURCES entry that already has a
// 'view' action. Keeping their sidebar visibility independently toggleable
// from that same resource's view permission was the root cause of repeated
// "role X has permission but the link is hidden" (or the reverse: visible
// link, 403 on click) reports -- so for exactly these keys, nav visibility
// is derived straight from the resource's view permission instead of its
// own row. Every other nav item (no matching resource, or no 'view' action)
// keeps its own independently-configured visibility below.
const RESOURCE_VIEW_NAV_KEYS = ['cases', 'agencies', 'pipeline', 'production', 'settings'];

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
      success: true, role, wildcard: true, permissions: [], canViewAllCases: true,
      navVisibility: Object.fromEntries(NAV_ITEMS.map(i => [i.key, true])),
      productionVisibility: Object.fromEntries(PRODUCTION_LISTS.map(l => [l.key, true])),
    });
  }
  const { data, error } = await sup.from('role_permissions').select('resource, action, allowed').eq('role', role);
  if (error) return res.json({ success: true, role, wildcard: false, permissions: [], navVisibility: {}, productionVisibility: {}, canViewAllCases: true });

  // Nav visibility: each item defaults to visible unless a row explicitly
  // sets it to false — per-item, not "if this role has any nav row at all".
  // That coarser rule used to mean touching ONE nav item for a role quietly
  // hid every OTHER never-configured item too, which is exactly the "I only
  // hid list 4-7, why did 1 and 2 disappear as well" class of report this
  // was rebuilt to stop causing (first for nav, now applied identically to
  // production_line below after the same bug reproduced there).
  const navRows = (data || []).filter(p => p.resource === 'nav');
  const navVisibility = {};
  for (const item of NAV_ITEMS) {
    if (RESOURCE_VIEW_NAV_KEYS.includes(item.key)) {
      const viewRow = (data || []).find(p => p.resource === item.key && p.action === 'view');
      navVisibility[item.key] = viewRow ? viewRow.allowed !== false : false;
      continue;
    }
    const row = navRows.find(p => p.action === item.key);
    navVisibility[item.key] = row ? row.allowed !== false : true;
  }

  // Production line visibility: same per-item default-open rule as nav above.
  const prodRows = (data || []).filter(p => p.resource === 'production_line');
  const productionVisibility = {};
  for (const list of PRODUCTION_LISTS) {
    const row = prodRows.find(p => p.action === list.key);
    productionVisibility[list.key] = row ? row.allowed !== false : true;
  }

  // Case visibility scope: unconfigured (no row yet) defaults to unrestricted,
  // same convention as nav/production above — see caseAccess.js.
  const viewAllRow = (data || []).find(p => p.resource === 'cases' && p.action === 'view_all');
  const canViewAllCases = viewAllRow ? viewAllRow.allowed !== false : true;

  res.json({
    success: true, role, wildcard: false,
    permissions: (data || []).filter(p => p.allowed !== false),
    navVisibility, productionVisibility, canViewAllCases,
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

// GET /api/nav-layout — global sidebar order + placement (sidebar vs
// settings-only) for every nav item. Distinct from per-role nav visibility
// above -- this is one shared layout for everyone, editable from
// الإعدادات → ترتيب القائمة الجانبية.
router.get('/nav-layout', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data, error } = await sup.from('nav_layout').select('*').order('sort_order');
  if (error) return res.status(400).json({ error: /does not exist|could not find the table/i.test(error.message) ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (nav_layout)' : error.message });

  // Any catalog item with no row yet (e.g. newly added to NAV_ITEMS after
  // the layout was last saved) defaults to the sidebar, appended after
  // whatever's already configured -- never silently disappears.
  const byKey = Object.fromEntries((data || []).map(r => [r.nav_key, r]));
  let nextOrder = Math.max(0, ...(data || []).map(r => r.sort_order)) + 1;
  const full = NAV_ITEMS.map(item => byKey[item.key] || { nav_key: item.key, location: 'sidebar', sort_order: nextOrder++ });
  full.sort((a, b) => a.sort_order - b.sort_order);

  res.json({ success: true, data: full });
});

// PUT /api/nav-layout — bulk save (admin only): [{nav_key, location, sort_order}, ...]
router.put('/nav-layout', requireAuth, requireRole('admin'), async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items array مطلوبة' });
  const sup = getSupabase();
  const rows = items.map(i => ({
    nav_key: i.nav_key,
    location: i.location === 'settings' ? 'settings' : 'sidebar',
    sort_order: parseInt(i.sort_order) || 0,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await sup.from('nav_layout').upsert(rows, { onConflict: 'nav_key' });
  if (error) return res.status(400).json({ error: /does not exist|could not find the table/i.test(error.message) ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (nav_layout)' : error.message });
  res.json({ success: true });
});

module.exports = router;
