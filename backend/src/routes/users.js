const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, requirePermission, bcrypt } = require('../middleware/auth');
const { getSupabase } = require('../supabase');

// All routes require auth; mutating routes additionally require admin
// (applied per-route below) -- GETs stay open to any authenticated staff
// member since other in-app pickers (pipeline list assignees, case team
// assignment) need to read the roster without granting user-management
// rights.
router.use(requireAuth);

// GET /api/users — list all users
router.get('/users', async (req, res) => {
  const sup = getSupabase();
  const { data: users } = await sup
    .from('users')
    .select(`id, name, email, role, team_id, teams!left(name), created_at`)
    .order('created_at', { ascending: false });

  const mapped = (users || []).map(u => ({
    ...u,
    team_name: u.teams?.name || null,
    teams: undefined
  }));

  res.json({ success: true, data: mapped });
});

// Role names are managed dynamically via /roles (teamManagement.js) rather
// than a fixed list here -- falls back to the legacy hardcoded set only if
// the roles table is empty/unreachable, so user creation never hard-fails.
async function getValidRoleNames(sup) {
  const { data } = await sup.from('roles').select('name');
  const names = (data || []).map(r => r.name);
  return names.length ? names : ['admin', 'manager', 'member'];
}

// POST /api/users — create user
router.post('/users', requirePermission('users', 'invite'), async (req, res) => {
  const { name, email, password, role, team_id } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, password required' });

  const sup = getSupabase();
  const validRoles = await getValidRoleNames(sup);
  if (role && !validRoles.includes(role)) return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });

  const { data: existing } = await sup.from('users').select('id').eq('email', email).maybeSingle();
  if (existing) return res.status(409).json({ error: 'Email already exists' });

  const hash = bcrypt.hashSync(password, 10);
  const { data: created, error } = await sup
    .from('users')
    .insert({ name, email, password_hash: hash, role: role || 'member', team_id: team_id || null })
    .select()
    .single();

  if (error) throw error;

  res.json({ success: true, id: created.id, message: `✅ تم إضافة ${name}` });
});

// PUT /api/users/:id — update user
router.put('/users/:id', requirePermission('users', 'edit'), async (req, res) => {
  const { name, email, password, role, team_id, is_active } = req.body;
  const sup = getSupabase();

  const { data: user } = await sup.from('users').select('id').eq('id', parseInt(req.params.id)).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (role) {
    const validRoles = await getValidRoleNames(sup);
    if (!validRoles.includes(role)) return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
  }

  const updates = {};
  if (name) updates.name = name;
  if (email) updates.email = email;
  if (password) updates.password_hash = bcrypt.hashSync(password, 10);
  if (role) updates.role = role;
  if (team_id !== undefined) updates.team_id = team_id || null;
  if (is_active !== undefined) updates.is_active = !!is_active;

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });

  // supabase-js resolves {data, error} rather than throwing on a DB-level
  // rejection (e.g. a stale CHECK constraint on users.role) -- ignoring
  // `error` here meant a rejected update still reported success while the
  // row silently stayed unchanged. Concretely reproduced with a newly
  // created custom role: assigning it to a user looked like it worked, but
  // the role never actually changed.
  const { error } = await sup.from('users').update(updates).eq('id', parseInt(req.params.id));
  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, message: '✅ تم تحديث المستخدم' });
});

// POST /api/users/:id/reset-password — admin sets a new password directly
router.post('/users/:id/reset-password', requirePermission('users', 'edit'), async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'كلمة المرور يجب ألا تقل عن 6 أحرف' });
  const sup = getSupabase();
  const { data: user } = await sup.from('users').select('id').eq('id', parseInt(req.params.id)).maybeSingle();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const hash = bcrypt.hashSync(password, 10);
  const { error } = await sup.from('users').update({ password_hash: hash }).eq('id', parseInt(req.params.id));
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, message: '✅ تم إعادة تعيين كلمة المرور' });
});

// DELETE /api/users/:id
router.delete('/users/:id', requirePermission('users', 'delete'), async (req, res) => {
  const sup = getSupabase();
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'لا يمكن حذف نفسك' });

  const { error } = await sup.from('users').delete().eq('id', id);
  if (error) return res.status(404).json({ error: 'User not found' });

  res.json({ success: true, message: '✅ تم حذف المستخدم' });
});

// GET /api/users/specialized — users with specialties (for case assignment dropdown)
router.get('/users/specialized', async (req, res) => {
  const sup = getSupabase();

  // Get distinct user_ids from user_specialties
  const { data: specUsers } = await sup
    .from('user_specialties')
    .select('user_id');

  const userIds = [...new Set((specUsers || []).map(su => su.user_id))];
  let result = [];

  if (userIds.length > 0) {
    // Users + ALL their specialty links + the specialty catalog, in 3 fixed
    // queries total instead of 2 extra ones per user (was O(N) round trips).
    const [{ data: users }, { data: allLinks }] = await Promise.all([
      sup.from('users').select('id, name, email, role').in('id', userIds).order('name'),
      sup.from('user_specialties').select('user_id, specialty_id').in('user_id', userIds),
    ]);

    const specialtyIds = [...new Set((allLinks || []).map(l => l.specialty_id))];
    const { data: specsData } = specialtyIds.length
      ? await sup.from('specialties').select('id, name_ar, name_en, icon').in('id', specialtyIds)
      : { data: [] };
    const specsById = Object.fromEntries((specsData || []).map(s => [s.id, s]));

    const specIdsByUser = {};
    for (const l of allLinks || []) (specIdsByUser[l.user_id] ||= []).push(l.specialty_id);

    result = (users || []).map(u => ({
      ...u,
      specialties: (specIdsByUser[u.id] || []).map(id => specsById[id]).filter(Boolean),
    }));
  }

  res.json({ success: true, data: result });
});

module.exports = router;
