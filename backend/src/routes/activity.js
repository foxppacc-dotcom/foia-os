const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getRecentActivity, logActivity } = require('../services/activityLogger');
const { getSupabase } = require('../supabase');
const { requireCaseAccess } = require('../services/caseAccess');

// GET /api/cases/:id/activities — case timeline (from case_comments).
// Previously had no per-case access check -- leaked a case's filtered
// timeline entries to any authenticated user regardless of visibility scope.
router.get('/cases/:id/activities', requireAuth, requireCaseAccess('id'), async (req, res) => {
  const sup = getSupabase();
  const { data, error } = await sup.from('case_comments').select('*').eq('case_id', parseInt(req.params.id)).order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });
  const activities = (data || []).filter(c => c.content?.startsWith('📧') || c.content?.startsWith('📄'));
  res.json(activities);
});

// GET /api/activity — system-wide activity feed (Dashboard's "الخط الزمني
// الشامل" section). Gated by its own permission (resource 'timeline',
// action 'view') rather than being open to any authenticated user, since an
// admin should decide per-role whether this cross-case feed is visible.
router.get('/activity', requireAuth, requirePermission('timeline', 'view'), async (req, res) => {
  const { limit = 50, target_type, target_id } = req.query;
  const logs = await getRecentActivity(
    parseInt(limit),
    target_type || null,
    target_id ? parseInt(target_id) : null
  );
  res.json({ success: true, data: logs });
});

// POST /api/activity/log — client-side error telemetry (ErrorBoundary.jsx).
// This route never existed before, so every React error boundary catch
// silently 404'd trying to report itself -- swallowed client-side, so
// nothing user-visible broke, but error monitoring was a total blind spot.
router.post('/activity/log', requireAuth, async (req, res) => {
  const { action_type, target_type, target_title, details } = req.body;
  try {
    await logActivity({
      user_id: req.user?.id, user_name: req.user?.name,
      action_type: action_type || 'error', target_type: target_type || 'app',
      target_id: null, target_title: target_title || 'Client error',
      details: typeof details === 'string' ? details : JSON.stringify(details || {}),
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
