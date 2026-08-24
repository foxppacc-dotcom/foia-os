const express = require('express');
const router = express.Router();

// Shared by every cron job's catch block below -- best-effort, never lets a
// notification failure mask the original cron error in the response.
async function notifyAdminsOfCronFailure(type, title, body) {
  try {
    const { getSupabase } = require('../supabase');
    const { notifyUsers } = require('../services/notificationService');
    const sup = getSupabase();
    const { data: admins } = await sup.from('users').select('id').eq('role', 'admin');
    await notifyUsers(sup, (admins || []).map(a => a.id), { type, title, body, target_type: 'settings', target_id: null });
  } catch (e) { console.error('[cron] admin failure notification failed:', e.message); }
}

// GET /api/cron/imap-poll — Vercel Cron target. Authenticated via CRON_SECRET
// (Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when configured),
// NOT via requireAuth — there is no logged-in user in a scheduled invocation.
router.get('/cron/imap-poll', async (req, res) => {
  const configuredSecret = process.env.CRON_SECRET;
  if (configuredSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${configuredSecret}`) {
      return res.status(401).json({ error: 'Unauthorized cron request' });
    }
  }

  try {
    const mailPoller = require('../services/mailPoller');
    const { total, errors } = await mailPoller.pollAll();
    if (errors.length) console.error('[cron] poll errors:', JSON.stringify(errors));
    res.json({ success: true, newMessages: total, errors: errors.length ? errors : undefined, polledAt: new Date().toISOString() });
  } catch (ex) {
    console.error('Cron IMAP poll error:', ex.message);
    // A failure here means real inbound emails just stop being processed --
    // previously this only ever showed up in a Vercel function log nobody
    // was watching, matching the exact failure mode gdrive-check was
    // already patched for. Same pattern: tell every admin the moment it breaks.
    await notifyAdminsOfCronFailure('imap_poll_failed', '⚠️ فشل فحص البريد الوارد', `تعذر جلب الإيميلات الجديدة: ${ex.message}`);
    res.status(500).json({ success: false, error: ex.message });
  }
});

// GET /api/cron/deadline-check — Vercel Cron target, same auth pattern as imap-poll.
router.get('/cron/deadline-check', async (req, res) => {
  const configuredSecret = process.env.CRON_SECRET;
  if (configuredSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${configuredSecret}`) {
      return res.status(401).json({ error: 'Unauthorized cron request' });
    }
  }

  try {
    const { checkOverdueDeadlines } = require('../services/deadlineChecker');
    const result = await checkOverdueDeadlines();
    res.json({ success: true, ...result, checkedAt: new Date().toISOString() });
  } catch (ex) {
    console.error('Cron deadline check error:', ex.message);
    // A silent failure here means overdue FOIA deadlines go completely
    // unnoticed instead of just unannounced -- worth alerting admins the
    // same way gdrive-check already does for its own failure mode.
    await notifyAdminsOfCronFailure('deadline_check_failed', '⚠️ فشل فحص المواعيد النهائية', `تعذر فحص القضايا المتأخرة: ${ex.message}`);
    res.status(500).json({ success: false, error: ex.message });
  }
});

// GET /api/cron/reset-email-counters — Vercel Cron target, same auth pattern
// as imap-poll/deadline-check. email_accounts.sent_today is meant to be a
// per-day sending cap (daily_limit), but nothing advanced it automatically --
// the only way to zero it was an admin manually pressing "تصفير العدادات"
// in the Email Accounts page. Left alone, "sent_today" is really a running
// total since the last manual reset (which may never happen), so accounts
// would hit "Daily limit reached" errors well before an actual day's worth
// of sends. Runs once daily so the counter genuinely means "today".
router.get('/cron/reset-email-counters', async (req, res) => {
  const configuredSecret = process.env.CRON_SECRET;
  if (configuredSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${configuredSecret}`) {
      return res.status(401).json({ error: 'Unauthorized cron request' });
    }
  }

  try {
    const { getSupabase } = require('../supabase');
    const sup = getSupabase();
    const { error } = await sup.from('email_accounts').update({ sent_today: 0 }).not('id', 'is', null);
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, resetAt: new Date().toISOString() });
  } catch (ex) {
    console.error('Cron email counter reset error:', ex.message);
    res.status(500).json({ success: false, error: ex.message });
  }
});

// GET /api/cron/gdrive-check — Vercel Cron target, same auth pattern as the
// others above. A stored refresh token can go silently invalid (Google
// auto-expires it after 7 days for an OAuth app still in "Testing"
// publishing status, or it can be revoked) -- gdrive.isConnected() only
// checks that a token is STORED, not that it still works, so this used to
// go undetected until someone's upload failed with a raw "invalid_grant"
// error. This makes the real verifyConnection() call daily and notifies
// every admin the moment it breaks, instead of waiting for a user to hit it.
router.get('/cron/gdrive-check', async (req, res) => {
  const configuredSecret = process.env.CRON_SECRET;
  if (configuredSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${configuredSecret}`) {
      return res.status(401).json({ error: 'Unauthorized cron request' });
    }
  }

  try {
    const gdrive = require('../services/googleDriveService');
    const { getSupabase } = require('../supabase');
    const { notifyUsers } = require('../services/notificationService');
    const sup = getSupabase();

    if (!(await gdrive.isConnected())) {
      return res.json({ success: true, skipped: 'not_connected', checkedAt: new Date().toISOString() });
    }
    const check = await gdrive.verifyConnection();
    if (!check.ok) {
      const { data: admins } = await sup.from('users').select('id').eq('role', 'admin');
      await notifyUsers(sup, (admins || []).map(a => a.id), {
        type: 'gdrive_disconnected',
        title: '⚠️ انقطع اتصال Google Drive',
        body: check.reason === 'invalid_grant'
          ? 'انتهت صلاحية ربط Google Drive (على الأغلب لازم يتحول تطبيق Google Cloud من Testing لـ Published حتى لا يتكرر). أعد الربط من صفحة Google Drive.'
          : `تعذر التحقق من الاتصال بـ Google Drive: ${check.error || check.reason}`,
        target_type: 'settings', target_id: null,
      });
    }
    res.json({ success: true, connected: check.ok, reason: check.ok ? null : check.reason, checkedAt: new Date().toISOString() });
  } catch (ex) {
    console.error('Cron gdrive check error:', ex.message);
    res.status(500).json({ success: false, error: ex.message });
  }
});

module.exports = router;
