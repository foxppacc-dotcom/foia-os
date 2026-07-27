const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, bcrypt } = require('../middleware/auth');
const { getSupabase } = require('../supabase');

// All routes require auth + admin role
router.use(requireAuth);
router.use(requireRole('admin'));

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

// POST /api/users — create user
router.post('/users', async (req, res) => {
  const { name, email, password, role, team_id } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, password required' });

  const validRoles = ['admin', 'manager', 'member'];
  if (role && !validRoles.includes(role)) return res.status(400).json({ error: `Invalid role. Must be: ${validRoles.join(', ')}` });

  const sup = getSupabase();

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
router.put('/users/:id', async (req, res) => {
  const { name, email, password, role, team_id } = req.body;
  const sup = getSupabase();

  const { data: user } = await sup.from('users').select('id').eq('id', parseInt(req.params.id)).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const updates = {};
  if (name) updates.name = name;
  if (email) updates.email = email;
  if (password) updates.password_hash = bcrypt.hashSync(password, 10);
  if (role) updates.role = role;
  if (team_id !== undefined) updates.team_id = team_id || null;

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });

  await sup.from('users').update(updates).eq('id', parseInt(req.params.id));

  res.json({ success: true, message: '✅ تم تحديث المستخدم' });
});

// DELETE /api/users/:id
router.delete('/users/:id', async (req, res) => {
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
  const result = [];

  if (userIds.length > 0) {
    const { data: users } = await sup
      .from('users')
      .select('id, name, email, role')
      .in('id', userIds)
      .order('name');

    for (const u of users || []) {
      const { data: userSpecs } = await sup
        .from('user_specialties')
        .select('specialty_id')
        .eq('user_id', u.id);

      const specialtyIds = (userSpecs || []).map(us => us.specialty_id);

      let specs = [];
      if (specialtyIds.length > 0) {
        const { data: specsData } = await sup
          .from('specialties')
          .select('id, name_ar, name_en, icon')
          .in('id', specialtyIds);
        specs = specsData || [];
      }

      result.push({ ...u, specialties: specs });
    }
  }

  res.json({ success: true, data: result });
});

module.exports = router;
