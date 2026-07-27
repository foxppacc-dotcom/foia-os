const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getSupabase } = require('../supabase');

// SMTP test — lazy-load nodemailer so it doesn't crash serverless startup
router.post('/email-accounts/:id/test-smtp', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { data: account } = await sup.from('email_accounts').select('*').eq('id', parseInt(req.params.id)).single();
    if (!account) return res.status(404).json({ error: 'Account not found' });

    // Lazy import to avoid Vercel serverless startup crash
    let nodemailer;
    try { nodemailer = require('nodemailer'); }
    catch (e) { return res.json({ success: false, status: 'nodemailer_unavailable', error: e.message }); }

    // Decrypt SMTP password
    const { decrypt } = require('../services/crypto');
    const smtpPass = decrypt(account.smtp_pass);

    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port || 587,
      secure: account.smtp_secure !== false && (account.smtp_port === 465),
      auth: { user: account.smtp_user || account.email, pass: smtpPass },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10000,
    });

    await transporter.verify();
    await sup.from('email_accounts').update({ status: 'active', last_checked: new Date().toISOString() }).eq('id', account.id);
    res.json({ success: true, status: 'connected', host: account.smtp_host, port: account.smtp_port });
  } catch (err) {
    const sup = getSupabase();
    await sup.from('email_accounts').update({ status: 'smtp_failed' }).eq('id', parseInt(req.params.id));
    res.json({ success: false, status: 'disconnected', error: err.message });
  }
});

// Test compose — send a real email using a configured account (no case required)
router.post('/email/test-compose', requireAuth, async (req, res) => {
  try {
    const { to, subject, body, account_id } = req.body;
    if (!to || !subject || !account_id) return res.status(400).json({ error: 'to, subject, and account_id are required' });

    const sup = getSupabase();
    const { data: account, error: acctErr } = await sup.from('email_accounts').select('*').eq('id', parseInt(account_id)).single();
    if (acctErr || !account) return res.status(404).json({ error: 'Email account not found' });

    let nodemailer;
    try { nodemailer = require('nodemailer'); }
    catch (e) { return res.json({ success: false, error: 'Nodemailer unavailable', detail: e.message }); }

    // Decrypt password — DB stores AES-256-GCM encrypted value
    const { decrypt } = require('../services/crypto');
    const smtpPass = decrypt(account.smtp_pass);

    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port || 587,
      secure: account.smtp_secure !== false && (account.smtp_port === 465),
      auth: { user: account.smtp_user || account.email, pass: smtpPass },
      tls: { rejectUnauthorized: false },
    });

    const info = await transporter.sendMail({
      from: `"${account.name || account.email}" <${account.smtp_user || account.email}>`,
      to,
      subject,
      text: body,
    });

    res.json({ success: true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected });
  } catch (ex) {
    res.json({ success: false, error: ex.message });
  }
});

module.exports = router;
