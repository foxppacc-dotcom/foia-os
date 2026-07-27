const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getRecentActivity } = require('../services/activityLogger');
const { getSupabase } = require('../supabase');

// GET /api/cases/:id/activities — case timeline (from case_comments)
router.get('/cases/:id/activities', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data, error } = await sup.from('case_comments').select('*').eq('case_id', parseInt(req.params.id)).order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });
  const activities = (data || []).filter(c => c.content?.startsWith('📧') || c.content?.startsWith('📄'));
  res.json(activities);
});

// GET /api/activity — get recent activity
router.get('/activity', requireAuth, async (req, res) => {
  const { limit = 50, target_type, target_id } = req.query;
  const logs = await getRecentActivity(
    parseInt(limit),
    target_type || null,
    target_id ? parseInt(target_id) : null
  );
  res.json({ success: true, data: logs });
});

module.exports = router;
