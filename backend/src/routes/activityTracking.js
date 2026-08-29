const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getSupabase } = require('../supabase');

router.use(requireAuth);

// Nothing beyond one 60-90s flush is ever legitimate in a single call --
// clamping the DELTA stops one runaway/malicious flush from lying about a
// huge jump, and clamping the resulting DAILY TOTAL (16h) stops a client
// that never stops flushing from recording an implausible day. Reports
// only the caller's own user_id (from the JWT) -- a user can only ever
// report their own usage, so no separate permission/case-access check is
// needed here, unlike every case-scoped route in this codebase.
const FLUSH_CAP_SECONDS = 120;
const DAILY_CAP_SECONDS = 16 * 60 * 60;

// POST /api/activity/heartbeat  { seconds: number }
router.post('/activity/heartbeat', async (req, res) => {
  try {
    const seconds = Math.max(0, Math.min(FLUSH_CAP_SECONDS, parseInt(req.body?.seconds) || 0));
    if (!seconds) return res.json({ success: true, active_seconds: 0 });

    const sup = getSupabase();
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();

    const { data: existing } = await sup.from('user_activity_time')
      .select('id, active_seconds').eq('user_id', req.user.id).eq('date', today).maybeSingle();

    const nextSeconds = Math.min(DAILY_CAP_SECONDS, (existing?.active_seconds || 0) + seconds);
    if (existing) {
      await sup.from('user_activity_time').update({ active_seconds: nextSeconds, last_heartbeat_at: now, updated_at: now }).eq('id', existing.id);
    } else {
      await sup.from('user_activity_time').insert({ user_id: req.user.id, date: today, active_seconds: nextSeconds, last_heartbeat_at: now });
    }
    res.json({ success: true, active_seconds: nextSeconds });
  } catch (err) {
    // The migration adding user_activity_time may not have been run yet --
    // this must never break the app (it's a background metric, not a real
    // action the user is waiting on), so fail silently rather than 500.
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
