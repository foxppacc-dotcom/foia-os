const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getRecentActivity, logActivity } = require('../services/activityLogger');
const { getSupabase } = require('../supabase');
const { canAccessCase, canViewAllCases, getVisibleCaseIds } = require('../services/caseAccess');

// GET /api/activity — system-wide activity feed (Dashboard's "الخط الزمني
// الشامل" section). Gated by its own permission (resource 'timeline',
// action 'view') rather than being open to any authenticated user, since an
// admin should decide per-role whether this cross-case feed is visible.
router.get('/activity', requireAuth, requirePermission('timeline', 'view'), async (req, res) => {
  const { target_type, target_id } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
  try {
  // requirePermission('timeline','view') only confirms the ROLE can see this
  // cross-case feed at all -- it says nothing about whether THIS specific
  // case (passed via ?target_id=) is one the caller is allowed to touch. A
  // role restricted to its own assigned cases (cases.view_all = false) but
  // granted timeline:view (e.g. to see the Dashboard's own global feed)
  // could otherwise pull any other case's activity log entries -- including
  // its title -- just by knowing/guessing its numeric id, the same
  // per-resource gap already closed on every other case-scoped route this
  // session via requireCaseAccess/canAccessCase.
  if (target_type === 'case' && target_id) {
    const sup = getSupabase();
    if (!(await canAccessCase(sup, req.user, parseInt(target_id)))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }
  }
  const sup = getSupabase();
  let logs = await getRecentActivity(
    limit,
    target_type || null,
    target_id ? parseInt(target_id) : null
  );
  // A role restricted to its own cases must not see the org-wide feed: entries
  // about OTHER cases (titles, auto-classify rows...) leaked through the
  // unfiltered /activity?limit=20 call the Dashboard makes. Keep the caller's
  // own entries plus entries whose case target they can see.
  if (!(await canViewAllCases(sup, req.user.role))) {
    const visible = new Set(await getVisibleCaseIds(sup, req.user.id));
    logs = logs.filter(l => l.user_id === req.user.id || (l.target_type === 'case' && visible.has(l.target_id)));
  }
  res.json({ success: true, data: logs });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
