const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
router.use(requireAuth);
const { getSupabase } = require('../supabase');

// GET /api/profile/:id
router.get('/profile/:id', async (req, res) => {
  try {
    const sup = getSupabase();
    const id = parseInt(req.params.id);
    const { data: user } = await sup.from('users').select('id, name, email, role, team_id, created_at').eq('id', id).single();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { data: tasks } = await sup.from('case_tasks').select('id, title, status, priority, due_date, created_at').eq('assigned_to', id).order('created_at', { ascending: false }).limit(20);
    // attendance_logs and notifications may not exist — wrap each independently
    let attendance = [];
    try { const r = await sup.from('attendance_logs').select('*').eq('user_id', id).order('date', { ascending: false }).limit(30); attendance = r.data || []; } catch(e) {}
    let notifications = [];
    try { const r = await sup.from('notifications').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(20); notifications = r.data || []; } catch(e) {}
    let unreadCount = { count: 0 };
    try { unreadCount = await sup.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', id).eq('is_read', false); } catch(e) {}

    const tasksCompleted = tasks?.filter(t => t.status === 'completed').length || 0;
    const tasksOnTime = tasks?.filter(t => t.status === 'completed' && (!t.due_date || new Date(t.completed_at) <= new Date(t.due_date))).length || 0;
    const overdue = tasks?.filter(t => t.status !== 'completed' && t.due_date && new Date(t.due_date) < new Date()).length || 0;

    res.json({
      user,
      tasks: tasks || [],
      attendance: attendance || [],
      notifications: notifications || [],
      unreadCount: unreadCount.count || 0,
      kpi: { tasks_total: tasks?.length || 0, tasks_completed: tasksCompleted, tasks_on_time: tasksOnTime, tasks_overdue: overdue }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/profile/:id
router.put('/profile/:id', async (req, res) => {
  try {
    const sup = getSupabase();
    const { name } = req.body;
    // Only update columns that exist in the table
    const updates = {};
    if (name !== undefined) updates.name = name;
    const { error } = await sup.from('users').update(updates).eq('id', parseInt(req.params.id));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/notifications
router.get('/notifications', async (req, res) => {
  try {
    const sup = getSupabase();
    let { data, error } = await sup.from('notifications').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(50);
    if (error && error.message.includes('Could not find')) {
      return res.json({ data: [], unreadCount: 0 });
    }
    if (error) throw error;
    let unreadCount = { count: 0 };
    try { unreadCount = await sup.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', req.user.id).eq('is_read', false); } catch(e) {}
    res.json({ data: data || [], unreadCount: unreadCount.count || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/notifications/read-all
router.put('/notifications/read-all', async (req, res) => {
  try {
    const sup = getSupabase();
    try { await sup.from('notifications').update({ is_read: true }).eq('user_id', req.user.id).eq('is_read', false); } catch(e) {}
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/notifications/:id/read
router.put('/notifications/:id/read', async (req, res) => {
  try {
    const sup = getSupabase();
    await sup.from('notifications').update({ is_read: true }).eq('id', parseInt(req.params.id)).eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/attendance/check-in
router.post('/attendance/check-in', async (req, res) => {
  try {
    const sup = getSupabase();
    const today = new Date().toISOString().split('T')[0];
    const { data: existing } = await sup.from('attendance_logs').select('*').eq('user_id', req.user.id).eq('date', today).maybeSingle();
    if (existing) return res.json({ success: true, message: 'Already checked in', data: existing });
    const { data, error } = await sup.from('attendance_logs').insert({ user_id: req.user.id, date: today, check_in: new Date().toISOString(), status: 'present' }).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/attendance/check-out
router.put('/attendance/check-out', async (req, res) => {
  try {
    const sup = getSupabase();
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await sup.from('attendance_logs').update({ check_out: new Date().toISOString() }).eq('user_id', req.user.id).eq('date', today).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/attendance?user_id=&month=&year=
router.get('/attendance', async (req, res) => {
  try {
    const sup = getSupabase();
    const userId = parseInt(req.query.user_id) || req.user.id;
    let query = sup.from('attendance_logs').select('*').eq('user_id', userId).order('date', { ascending: false });
    if (req.query.month && req.query.year) {
      const start = `${req.query.year}-${String(req.query.month).padStart(2, '0')}-01`;
      const end = `${req.query.year}-${String(req.query.month).padStart(2, '0')}-31`;
      query = sup.from('attendance_logs').select('*').eq('user_id', userId).gte('date', start).lte('date', end).order('date', { ascending: false });
    }
    let { data, error } = await query;
    if (error && error.message.includes('Could not find')) {
      return res.json({ data: [] });
    }
    if (error) throw error;
    res.json({ data: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/tasks/mine
router.get('/tasks/mine', async (req, res) => {
  try {
    const sup = getSupabase();
    const { status, priority } = req.query;
    let query = sup.from('case_tasks').select('*').eq('assigned_to', req.user.id);
    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    
    // Batch fetch case titles separately (no FK join)
    let result = data || [];
    if (result.length > 0) {
      const caseIds = [...new Set(result.map(t => t.case_id).filter(Boolean))];
      if (caseIds.length) {
        const { data: cases } = await sup.from('cases').select('id, title').in('id', caseIds);
        const caseMap = {};
        (cases || []).forEach(c => caseMap[c.id] = c);
        result = result.map(t => ({ ...t, cases: caseMap[t.case_id] || null }));
      }
    }

    const now = new Date();
    const withMeta = result.map(t => ({
      ...t, overdue: t.due_date && t.status !== 'completed' && new Date(t.due_date) < now
    }));
    res.json({ data: withMeta });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/tasks/:id/status
router.put('/tasks/:id/status', async (req, res) => {
  try {
    const sup = getSupabase();
    const { status } = req.body;
    const updates = { status };
    if (status === 'completed') updates.completed_at = new Date().toISOString();
    const { error } = await sup.from('case_tasks').update(updates).eq('id', parseInt(req.params.id));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/kpi/:userId
router.get('/kpi/:userId', async (req, res) => {
  try {
    const sup = getSupabase();
    const userId = parseInt(req.params.userId);
    const { data: tasks } = await sup.from('case_tasks').select('id, status, due_date, completed_at, priority').eq('assigned_to', userId);
    let { data: attendance, error: attErr } = await sup.from('attendance_logs').select('id, date, status').eq('user_id', userId);
    if (attErr) attendance = [];
    
    const total = tasks?.length || 0;
    const completed = tasks?.filter(t => t.status === 'completed').length || 0;
    const onTime = tasks?.filter(t => t.status === 'completed' && t.due_date && t.completed_at && new Date(t.completed_at) <= new Date(t.due_date)).length || 0;
    const overdue = tasks?.filter(t => t.status !== 'completed' && t.due_date && new Date(t.due_date) < new Date()).length || 0;
    const urgent = tasks?.filter(t => t.priority === 'urgent').length || 0;
    const present = attendance?.filter(a => a.status === 'present').length || 0;
    const absent = attendance?.filter(a => a.status === 'absent').length || 0;

    res.json({
      user_id: userId, total_tasks: total, completed_tasks: completed, overdue_tasks: overdue,
      urgent_tasks: urgent, on_time_rate: total > 0 ? Math.round((onTime / total) * 100) : 0,
      completion_rate: total > 0 ? Math.round((completed / total) * 100) : 0,
      attendance_days: attendance?.length || 0, present_days: present, absent_days: absent,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
