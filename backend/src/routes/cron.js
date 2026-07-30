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

module.exports = router;
