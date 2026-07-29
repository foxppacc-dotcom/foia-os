const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const { encrypt, decrypt } = require('../services/crypto');
const emailService = require('../services/emailService');

/**
 * Real Email Engine for FOIA OS
 * — Multiple SMTP/IMAP account management
 * — Send real emails via nodemailer
 * — Fetch inbox via IMAP
 * — Auto-link to cases
 */

// GET /api/email-accounts — list all (alias for frontend compat)
router.get('/email-accounts', requireAuth, (req, res) => {
  const sup = getSupabase();
  sup.from('email_accounts').select('id, email, name, provider, smtp_host, smtp_port, imap_host, imap_port, daily_limit, sent_today, is_active, created_at').order('created_at', { ascending: false })
    .then(({ data, error }) => {
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true, data: data || [] });
    });
});

// POST /api/email-accounts — add new (alias)
router.post('/email-accounts', requireAuth, requireRole('admin'), async (req, res) => {
  const sup = getSupabase();
  try {
    const { email, name, provider, smtp_host, smtp_port, smtp_user, smtp_pass, imap_host, imap_port, imap_user, imap_pass, daily_limit } = req.body;
    if (!email || !name) return res.status(400).json({ error: 'الإيميل والاسم مطلوبان' });
    const encSmtpPass = encrypt(smtp_pass);
    const encImapPass = encrypt(imap_pass);
    const { error } = await sup.from('email_accounts').insert({ email, name, provider: provider || 'custom', smtp_host, smtp_port: smtp_port || 587, smtp_user: smtp_user || email, smtp_pass: encSmtpPass, imap_host, imap_port: imap_port || 993, imap_user: imap_user || email, imap_pass: encImapPass, daily_limit: daily_limit || 50 });
    if (error) return res.status(500).json({ error: error.message });
    try { await sup.from('activity_logs').insert({ user_id: req.user?.id, user_name: req.user?.name, action_type: 'email_account_created', target_type: 'email_account', target_title: `Email account ${email} created` }); } catch {}
    res.json({ success: true, message: '✅ تم إضافة حساب الإيميل' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ ACCOUNT MANAGEMENT ============

// GET /api/email/accounts — list all (no passwords)
router.get('/accounts', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data: accounts, error } = await sup
    .from('email_accounts')
    .select('id, email, name, provider, smtp_host, smtp_port, imap_host, imap_port, daily_limit, sent_today, is_active, created_at')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data: accounts || [] });
});

// POST /api/email/accounts — add new email account
router.post('/accounts', requireAuth, requireRole('admin'), async (req, res) => {
  const sup = getSupabase();
  try {
    const {
      email, name, provider,
      smtp_host, smtp_port, smtp_user, smtp_pass,
      imap_host, imap_port, imap_user, imap_pass,
      daily_limit
    } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: 'الإيميل والاسم مطلوبان' });
    }

    const { data: existing } = await sup.from('email_accounts').select('id').eq('email', email).maybeSingle();
    if (existing) return res.status(409).json({ error: 'هذا الإيميل موجود مسبقاً' });

    const { data: created, error } = await sup.from('email_accounts').insert({
      email,
      name,
      provider: provider || 'custom',
      smtp_host: smtp_host || null,
      smtp_port: smtp_port || 587,
      smtp_user: smtp_user || email,
      smtp_pass: smtp_pass || null,
      imap_host: imap_host || null,
      imap_port: imap_port || 993,
      imap_user: imap_user || email,
      imap_pass: imap_pass || null,
      daily_limit: daily_limit || 50,
      sent_today: 0,
      is_active: true
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true, id: created.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/email/accounts/:id
router.put('/accounts/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const sup = getSupabase();
  try {
    const id = parseInt(req.params.id);
    const { data: existing } = await sup.from('email_accounts').select('id').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Account not found' });

    const { email, name, provider, smtp_host, smtp_port, smtp_user, smtp_pass, imap_host, imap_port, imap_user, imap_pass, daily_limit, is_active } = req.body;

    const updates = {};
    if (email !== undefined) updates.email = email;
    if (name !== undefined) updates.name = name;
    if (smtp_pass !== undefined) updates.smtp_pass = encrypt(smtp_pass);
    if (imap_pass !== undefined) updates.imap_pass = encrypt(imap_pass);
    if (provider !== undefined) updates.provider = provider;
    if (smtp_host !== undefined) updates.smtp_host = smtp_host;
    if (smtp_port !== undefined) updates.smtp_port = smtp_port;
    if (smtp_user !== undefined) updates.smtp_user = smtp_user;
    if (imap_host !== undefined) updates.imap_host = imap_host;
    if (imap_port !== undefined) updates.imap_port = imap_port;
    if (imap_user !== undefined) updates.imap_user = imap_user;
    if (daily_limit !== undefined) updates.daily_limit = daily_limit;
    if (is_active !== undefined) updates.is_active = is_active;

    const { error } = await sup.from('email_accounts').update(updates).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true, message: '✅ تم تحديث حساب الإيميل' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT alias — /email-accounts/:id
router.put('/email-accounts/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const sup = getSupabase();
  try {
    const id = parseInt(req.params.id);
    const { data: existing } = await sup.from('email_accounts').select('id').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Account not found' });

    const updates = {};
    if (req.body.smtp_pass !== undefined) updates.smtp_pass = encrypt(req.body.smtp_pass);
    if (req.body.imap_pass !== undefined) updates.imap_pass = encrypt(req.body.imap_pass);
    if (req.body.email !== undefined) updates.email = req.body.email;
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.provider !== undefined) updates.provider = req.body.provider;
    if (req.body.smtp_host !== undefined) updates.smtp_host = req.body.smtp_host;
    if (req.body.smtp_port !== undefined) updates.smtp_port = req.body.smtp_port;
    if (req.body.smtp_user !== undefined) updates.smtp_user = req.body.smtp_user;
    if (req.body.imap_host !== undefined) updates.imap_host = req.body.imap_host;
    if (req.body.imap_port !== undefined) updates.imap_port = req.body.imap_port;
    if (req.body.imap_user !== undefined) updates.imap_user = req.body.imap_user;
    if (req.body.daily_limit !== undefined) updates.daily_limit = req.body.daily_limit;
    if (req.body.is_active !== undefined) updates.is_active = req.body.is_active;

    const { error } = await sup.from('email_accounts').update(updates).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, message: '✅ تم تحديث حساب الإيميل' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/email/accounts/:id
router.delete('/accounts/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const sup = getSupabase();
  try {
    await sup.from('email_accounts').delete().eq('id', parseInt(req.params.id));
    res.json({ success: true, message: '✅ تم حذف الحساب' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE alias — email-accounts/:id
router.delete('/email-accounts/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const sup = getSupabase();
  try {
    await sup.from('email_accounts').delete().eq('id', parseInt(req.params.id));
    res.json({ success: true, message: '✅ تم حذف الحساب' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ SEND REAL EMAIL ============

// POST /api/email/send — send real email from an account
router.post('/send', requireAuth, async (req, res) => {
  try {
    const { account_id, case_id, to, cc, subject, body, html } = req.body;
    if (!account_id || !to || !subject) {
      return res.status(400).json({ error: 'account_id, to, subject مطلوبون' });
    }

    const result = await emailService.sendEmail(parseInt(account_id), {
      to, cc, subject, text: body, html,
    });

    // Link to case if provided
    if (case_id) {
      const sup = getSupabase();
      await sup.from('communications').insert({
        case_id: parseInt(case_id),
        type: 'email',
        direction: 'outbound',
        subject,
        body: body || html || '',
        sender: to,
        recipient: cc || '',
        message_id: result.messageId,
        thread_id: result.messageId,
        created_at: new Date().toISOString()
      });

      await sup.from('case_comments').insert({
        case_id: parseInt(case_id),
        content: `📧 تم إرسال بريد إلى ${to}: "${subject}"`,
        created_at: new Date().toISOString()
      });
    }

    res.json({ success: true, messageId: result.messageId, accepted: result.accepted });
  } catch (err) {
    console.error('Email send error:', err);
    res.status(500).json({ error: `فشل الإرسال: ${err.message}` });
  }
});

// ============ FETCH INBOX VIA IMAP ============

// POST /api/email/fetch — fetch unread emails from an account
router.post('/fetch', requireAuth, async (req, res) => {
  try {
    const { account_id, case_id } = req.body;
    if (!account_id) return res.status(400).json({ error: 'account_id مطلوب' });

    const result = await emailService.processIncomingEmails(parseInt(account_id), case_id ? parseInt(case_id) : null);

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Email fetch error:', err);
    res.status(500).json({ error: `فشل جلب الإيميلات: ${err.message}` });
  }
});

// POST /api/email/fetch-all — fetch from all active accounts
router.post('/fetch-all', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { data: accounts, error } = await sup
      .from('email_accounts')
      .select('id')
      .eq('is_active', 1)
      .not('imap_host', 'is', null);

    if (error) return res.status(500).json({ error: error.message });

    let totalFetched = 0;
    let totalCreated = 0;
    const errors = [];

    for (const account of accounts || []) {
      try {
        const result = await emailService.processIncomingEmails(account.id);
        totalFetched += result.emails_fetched;
        totalCreated += result.communications_created;
      } catch (e) {
        errors.push({ account_id: account.id, error: e.message });
      }
    }

    res.json({
      success: true,
      accounts_checked: (accounts || []).length,
      total_emails_fetched: totalFetched,
      total_communications_created: totalCreated,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ UNIFIED INBOX VIEW ============

// GET /api/email/inbox — unified inbox
// NOTE: GET /inbox used to be defined here too, shadowing documentCenter.js's
// richer version (which supports status=unread/unlinked/linked + search --
// what the Inbox.jsx frontend actually calls) since 'email' mounts before
// documentCenter in index.js. Removed as dead/superseded code so the real
// implementation is finally reachable.

// ============ SIMULATE RECEIVE (backward compat + test) ============

// POST /api/email/receive — simulate receiving (kept for testing)
router.post('/receive', requireAuth, async (req, res) => {
  const sup = getSupabase();
  try {
    const { case_id, subject, body, from, type } = req.body;

    if (!case_id || !subject || !body) {
      return res.status(400).json({ error: 'case_id, subject, body required' });
    }

    await sup.from('communications').insert({
      case_id: parseInt(case_id),
      type: type || 'email',
      direction: 'inbound',
      subject,
      body,
      sender: from || 'external@agency.gov',
      recipient: 'system@foia-os',
      created_at: new Date().toISOString()
    });

    // Auto-update pending request
    const { data: pendingRequest } = await sup
      .from('requests')
      .select('id')
      .eq('case_id', parseInt(case_id))
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();

    if (pendingRequest) {
      await sup
        .from('requests')
        .update({ status: 'responded', response_date: new Date().toISOString().split('T')[0] })
        .eq('id', pendingRequest.id);
    }

    await sup.from('case_comments').insert({
      case_id: parseInt(case_id),
      content: `📩 تم استلام رد: "${subject}"`,
      created_at: new Date().toISOString()
    });

    res.json({ success: true, message: '📩 تم تسجيل الرد' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ RESET DAILY COUNTERS ============

// POST /api/email/reset-counters
router.post('/reset-counters', requireAuth, requireRole('admin'), async (req, res) => {
  const sup = getSupabase();
  try {
    await sup.from('email_accounts').update({ sent_today: 0 }).not('id', 'is', null);
    res.json({ success: true, message: '✅ تم تصفير العدادات' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
