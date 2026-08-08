const express = require('express');
const router = express.Router();

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

module.exports = router;
