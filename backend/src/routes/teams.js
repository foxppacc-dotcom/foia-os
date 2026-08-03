const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSupabase } = require('../supabase');

// All teams routes require auth + admin or manager
router.use(requireAuth);

// GET /api/teams — list all teams
router.get('/teams', async (req, res) => {
  const sup = getSupabase();
  const { data: teams } = await sup.from('teams').select('*').order('created_at', { ascending: false });

  // Get member counts for each team
  const result = [];
  for (const t of teams || []) {
    const { count } = await sup.from('users').select('*', { count: 'exact', head: true }).eq('team_id', t.id);
    result.push({ ...t, member_count: count || 0 });
  }

  res.json({ success: true, data: result });
});

// GET /api/teams/:id/members — team members
router.get('/teams/:id/members', async (req, res) => {
  const sup = getSupabase();
  const { data: members } = await sup
    .from('users')
    .select('id, name, email, role')
    .eq('team_id', parseInt(req.params.id))
    .order('name');

  res.json({ success: true, data: members || [] });
});

// Admin/Manager only for /teams* paths — NOT a bare router.use(): since every
// router is mounted at '/api', an un-pathed router.use(requireRole) here would
// intercept ALL /api/* requests that don't match a route in this file first
// (e.g. a viewer hitting /api/permissions/mine would 403 here before the
// permissions router ever saw it). Scope it to the teams paths.
router.use('/teams', requireRole('admin', 'manager'));

// POST /api/teams — create team
router.post('/teams', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Team name required' });

  const sup = getSupabase();
  const { data: created, error } = await sup.from('teams').insert({ name }).select().single();
  if (error) throw error;

  res.json({ success: true, id: created.id, message: `✅ تم إنشاء فريق ${name}` });
});

// PUT /api/teams/:id — update team
router.put('/teams/:id', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Team name required' });

  const sup = getSupabase();
  await sup.from('teams').update({ name }).eq('id', parseInt(req.params.id));
  res.json({ success: true, message: '✅ تم تحديث الفريق' });
});

// DELETE /api/teams/:id
router.delete('/teams/:id', async (req, res) => {
  const sup = getSupabase();
  const id = parseInt(req.params.id);

  // Unlink users from this team
  await sup.from('users').update({ team_id: null }).eq('team_id', id);
  await sup.from('teams').delete().eq('id', id);

  res.json({ success: true, message: '✅ تم حذف الفريق' });
});

module.exports = router;
