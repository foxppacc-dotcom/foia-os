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
  res.json({ success: true, resources: RESOURCES, roles });
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
    return res.json({ success: true, role, wildcard: true, permissions: [] });
  }
  const { data, error } = await sup.from('role_permissions').select('resource, action, allowed').eq('role', role);
  if (error) return res.json({ success: true, role, wildcard: false, permissions: [] });
  res.json({ success: true, role, wildcard: false, permissions: (data || []).filter(p => p.allowed !== false) });
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
