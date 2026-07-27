const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const { logActivity } = require('../services/activityLogger');

// GET /api/checklist/templates — list all templates
router.get('/templates', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { data, error } = await sup.from('checklist_templates').select('*').order('sort_order');
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/checklist/templates — create template
router.post('/templates', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { title, icon, color, sort_order, enabled, default_status, record_type } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const { data, error } = await sup.from('checklist_templates').insert({
      title, icon: icon || 'FileText', color: color || '#D4A843',
      sort_order: sort_order || 0, enabled: enabled !== false,
      default_status: default_status || 'not_started',
      record_type: record_type || title.replace(/\s+/g, '_').toLowerCase(),
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    try { await logActivity({ user_id: req.user?.id, user_name: req.user?.name, action_type: 'checklist_template_created', target_type: 'checklist', target_title: `Template: ${title}` }); } catch {}
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/checklist/templates/:id — update template
router.put('/templates/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const sup = getSupabase();
    const id = parseInt(req.params.id);
    const updates = {};
    ['title', 'icon', 'color', 'sort_order', 'enabled', 'default_status', 'record_type',
     'requires_owner', 'requires_priority', 'requires_due_date', 'requires_evidence', 'requires_attachment', 'ai_verification'
    ].forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });
    updates.updated_at = new Date().toISOString();
    const { data, error } = await sup.from('checklist_templates').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/checklist/templates/:id — soft delete (disable)
router.delete('/templates/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const sup = getSupabase();
    const id = parseInt(req.params.id);
    // Soft delete: disable the template so old cases keep their data
    const { error } = await sup.from('checklist_templates').update({ enabled: false, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, message: 'Template disabled' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/checklist/templates/reorder — reorder templates
router.post('/templates/reorder', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of {id, sort_order}' });
    for (const item of order) {
      await sup.from('checklist_templates').update({ sort_order: item.sort_order }).eq('id', item.id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
