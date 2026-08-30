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
// A grace window on top of real wall-clock elapsed time, to absorb normal
// network latency/clock skew between the client's tick and this request
// landing -- not meant to allow any real extra credit.
const HEARTBEAT_GRACE_SECONDS = 10;

// POST /api/activity/heartbeat  { seconds: number }
router.post('/activity/heartbeat', async (req, res) => {
  try {
    const seconds = Math.max(0, Math.min(FLUSH_CAP_SECONDS, parseInt(req.body?.seconds) || 0));
    if (!seconds) return res.json({ success: true, active_seconds: 0 });

    const sup = getSupabase();
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();

    const { data: existing } = await sup.from('user_activity_time')
      .select('id, active_seconds, last_heartbeat_at').eq('user_id', req.user.id).eq('date', today).maybeSingle();

    // The per-call cap alone only bounds a single tab's own claim -- it
    // does nothing about the SAME person running multiple tabs/devices at
    // once, each independently ticking and flushing its own ~60s/minute.
    // Since this feeds performance evaluation, that's a real way to inflate
    // your own recorded time, not just a theoretical one. Clamp the
    // credited seconds to how much REAL wall-clock time has actually
    // elapsed since the last heartbeat from ANY tab for this user -- only
    // one second of wall-clock time can ever pass per second, no matter how
    // many tabs are open reporting it.
    let creditedSeconds = seconds;
    if (existing?.last_heartbeat_at) {
      const elapsed = (Date.now() - new Date(existing.last_heartbeat_at).getTime()) / 1000;
      creditedSeconds = Math.max(0, Math.min(seconds, elapsed + HEARTBEAT_GRACE_SECONDS));
    }

    const nextSeconds = Math.min(DAILY_CAP_SECONDS, (existing?.active_seconds || 0) + creditedSeconds);
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
