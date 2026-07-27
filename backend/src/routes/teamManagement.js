const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getSupabase } = require('../supabase');

// ═══════════════════════════════════════════════
// WORKLOAD DASHBOARD
// ═══════════════════════════════════════════════
router.get('/users/workload', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { data: users, error } = await sup.from('workload_view').select('*').order('active_investigations', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const total = users?.length || 0;
    const overloaded = users?.filter(u => u.active_investigations > 10 && u.active) || [];
    const idle = users?.filter(u => u.active_investigations === 0 && u.active && u.vacation_status === 'active') || [];
    const late = users?.filter(u => u.stalled_investigations > 3 && u.active) || [];
    const onVacation = users?.filter(u => u.vacation_status !== 'active') || [];
    const totalCapacity = users?.filter(u => u.active && u.vacation_status === 'active').length || 0;
    res.json({ users: users || [], summary: { total, totalCapacity, overloaded: overloaded.length, idle: idle.length, late: late.length, onVacation: onVacation.length,
      overloadedUsers: overloaded.map(u => ({ id: u.user_id, name: u.user_name, activeInvestigations: u.active_investigations })),
      idleUsers: idle.map(u => ({ id: u.user_id, name: u.user_name })) } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// ROLES — Complete CRUD
// ═══════════════════════════════════════════════
router.get('/roles', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data } = await sup.from('roles').select('*').order('sort_order');
  res.json({ roles: data || [] });
});

router.post('/roles', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { name, label, permissions } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const { data, error } = await sup.from('roles').insert({
    name: name.toLowerCase().replace(/\s+/g, '_'), label: label || name,
    permissions: permissions || { view_investigation: true }, sort_order: 99
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, role: data });
});

router.put('/roles/:id', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { label, permissions, name } = req.body;
  const updates = {};
  if (label !== undefined) updates.label = label;
  if (name !== undefined) updates.name = name;
  if (permissions !== undefined) updates.permissions = permissions;
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields' });
  const { data, error } = await sup.from('roles').update(updates).eq('id', parseInt(req.params.id)).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, role: data });
});

router.delete('/roles/:id', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { error } = await sup.from('roles').delete().eq('id', parseInt(req.params.id));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

router.post('/roles/:id/duplicate', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data: original } = await sup.from('roles').select('*').eq('id', parseInt(req.params.id)).single();
  if (!original) return res.status(404).json({ error: 'Role not found' });
  const { data, error } = await sup.from('roles').insert({
    name: `${original.name}_copy`, label: `${original.label} (نسخة)`,
    permissions: original.permissions, sort_order: 99
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, role: data });
});

// ═══════════════════════════════════════════════
// DEPARTMENTS — Complete CRUD
// ═══════════════════════════════════════════════
router.get('/departments', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data } = await sup.from('departments').select('*').order('name');
  res.json({ departments: data || [] });
});

router.post('/departments', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { name, description, manager_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const { data, error } = await sup.from('departments').insert({ name, description, manager_id }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, department: data });
});

router.put('/departments/:id', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { name, description, manager_id, archived } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (manager_id !== undefined) updates.manager_id = manager_id;
  if (archived !== undefined) updates.archived = archived;
  const { data, error } = await sup.from('departments').update(updates).eq('id', parseInt(req.params.id)).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, department: data });
});

router.delete('/departments/:id', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { error } = await sup.from('departments').delete().eq('id', parseInt(req.params.id));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
// ORGANIZATION SETTINGS
// ═══════════════════════════════════════════════
router.get('/organization', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data } = await sup.from('organization_settings').select('*').limit(1).single();
  res.json({ organization: data || {} });
});

router.put('/organization', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const allowed = ['company_name', 'timezone', 'working_days', 'business_hours', 'default_language', 'logo_url', 'email_footer', 'investigation_numbering', 'case_numbering'];
  const updates = {};
  for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
  updates.updated_at = new Date().toISOString();
  const { data, error } = await sup.from('organization_settings').update(updates).eq('id', 1).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, organization: data });
});

// ═══════════════════════════════════════════════
// CASE / INVESTIGATION TEAM ASSIGNMENTS
// ═══════════════════════════════════════════════
router.get('/cases/:id/assignees', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const caseId = parseInt(req.params.id);
  const { data: caseData } = await sup.from('cases').select('id, title, owner_id, supervisor_id, default_email_account_id').eq('id', caseId).single();
  const { data: assignees } = await sup.from('case_assignees').select('*, user:user_id(name, email, role_id, title)').eq('case_id', caseId);
  const { data: allUsers } = await sup.from('users').select('id, name, email, role_id, title, active_investigations').eq('active', true).order('name');
  res.json({ caseInfo: caseData || {}, assignees: assignees || [], availableUsers: allUsers || [] });
});

router.post('/cases/:id/assignees', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { user_id, role } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const { data, error } = await sup.from('case_assignees').insert({
    case_id: parseInt(req.params.id), user_id, role: role || 'investigator'
  }).select().single();
  if (error?.message?.includes('duplicate')) return res.status(409).json({ error: 'User already assigned' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, assignee: data });
});

router.put('/cases/:id/assignees/:userId', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { role } = req.body;
  if (!role) return res.status(400).json({ error: 'Role required' });
  const { data, error } = await sup.from('case_assignees').update({ role }).eq('case_id', parseInt(req.params.id)).eq('user_id', parseInt(req.params.userId)).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, assignee: data });
});

router.delete('/cases/:id/assignees/:userId', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { error } = await sup.from('case_assignees').delete().eq('case_id', parseInt(req.params.id)).eq('user_id', parseInt(req.params.userId));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Transfer ownership
router.put('/cases/:id/transfer', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { owner_id } = req.body;
  if (!owner_id) return res.status(400).json({ error: 'owner_id required' });
  const { data, error } = await sup.from('cases').update({ owner_id }).eq('id', parseInt(req.params.id)).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, case: data });
});

// ═══════════════════════════════════════════════
// SOURCE / AGENCY ENHANCED
// ═══════════════════════════════════════════════
router.put('/agencies/:id', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const allowed = ['primary_email', 'secondary_emails', 'preferred_contact', 'assigned_email_account_id', 'average_response_days', 'last_communication'];
  const updates = {};
  for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
  const { data, error } = await sup.from('agencies').update(updates).eq('id', parseInt(req.params.id)).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, agency: data });
});

module.exports = router;
