const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const trash = require('../services/trash');

// All teams routes require auth + admin or manager. Scoped to '/teams'
// (not a bare router.use(requireRole)) since every router is mounted at
// '/api' -- an un-pathed one here would intercept ALL /api/* requests that
// don't match a route in this file first. Placed immediately after
// requireAuth, before ANY route in this file -- it used to sit further
// down, after the two GET routes below, which meant Express had already
// matched and served them (registration order, not declaration intent)
// before this gate ever ran: any authenticated employee, not just
// admin/manager, could enumerate every team and every member's name/email/role.
router.use(requireAuth);
router.use('/teams', requireRole('admin', 'manager'));

// GET /api/teams — list all teams
router.get('/teams', async (req, res) => {
  const sup = getSupabase();
  const { data: teams } = await sup.from('teams').select('*').is('deleted_at', null).order('created_at', { ascending: false });

  // Member counts for all teams in one query instead of one count query per
  // team (was N sequential PostgREST round trips).
  const teamIds = (teams || []).map(t => t.id);
  const countByTeam = {};
  if (teamIds.length) {
    const { data: memberRows } = await sup.from('users').select('team_id').in('team_id', teamIds).is('deleted_at', null);
    for (const m of memberRows || []) countByTeam[m.team_id] = (countByTeam[m.team_id] || 0) + 1;
  }
  const result = (teams || []).map(t => ({ ...t, member_count: countByTeam[t.id] || 0 }));

  res.json({ success: true, data: result });
});

// GET /api/teams/:id/members — team members
router.get('/teams/:id/members', async (req, res) => {
  const sup = getSupabase();
  const { data: members } = await sup
    .from('users')
    .select('id, name, email, role')
    .eq('team_id', parseInt(req.params.id))
    .is('deleted_at', null)
    .order('name');

  res.json({ success: true, data: members || [] });
});

// POST /api/teams — create team
router.post('/teams', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Team name required' });

    const sup = getSupabase();
    const { data: created, error } = await sup.from('teams').insert({ name }).select().single();
    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true, id: created.id, message: `✅ تم إنشاء فريق ${name}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/teams/:id — update team
router.put('/teams/:id', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Team name required' });

  const sup = getSupabase();
  const { error } = await sup.from('teams').update({ name }).eq('id', parseInt(req.params.id));
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, message: '✅ تم تحديث الفريق' });
});

// DELETE /api/teams/:id
router.delete('/teams/:id', async (req, res) => {
  const sup = getSupabase();
  const id = parseInt(req.params.id);

  // Unlink users from this team
  const { error: unlinkErr } = await sup.from('users').update({ team_id: null }).eq('team_id', id);
  if (unlinkErr) return res.status(400).json({ error: unlinkErr.message });
  const { error } = await trash.softDelete(sup, { table: 'teams', id, userId: req.user.id });
  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, message: '✅ تم حذف الفريق' });
});

module.exports = router;
