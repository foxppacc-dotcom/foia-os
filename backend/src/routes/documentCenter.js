const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getSupabase } = require('../supabase');

// ============ AGENCY COMMUNICATION CONFIG ============

// PUT /api/requests/:id/communication-config — save agency settings
router.put('/requests/:id/communication-config', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { email_account_id, comm_method, sla_days } = req.body;
  const configStr = JSON.stringify({ _comm: { email_account_id: email_account_id || null, method: comm_method || 'email', sla_days: sla_days || 20, updated_at: new Date().toISOString() }});
  const { error } = await sup.from('requests').update({ notes: configStr }).eq('id', parseInt(req.params.id));
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// PUT /api/requests/:id/status — quick actions (send, reminder, escalate, verify, close)
router.put('/requests/:id/status', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status required' });
  const update = { status };
  if (status === 'sent' || status === 'reminder') update.sent_at = new Date().toISOString();
  const { error } = await sup.from('requests').update(update).eq('id', parseInt(req.params.id));
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// ============ DOCUMENT CENTER API ============

// GET /api/documents/categories — list all categories
router.get('/documents/categories', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data, error } = await sup.from('document_categories').select('*').order('order_index', { ascending: true });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ categories: data });
});

// GET /api/documents/:id — get single document
router.get('/documents/:id', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data, error } = await sup.from('case_documents').select('*').eq('id', parseInt(req.params.id)).single();
  if (error) return res.status(404).json({ error: error.message });
  res.json({ document: data });
});

// GET /api/cases/:caseId/documents — list documents for a case
router.get('/cases/:caseId/documents', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data, error } = await sup.from('case_documents').select('*').eq('case_id', parseInt(req.params.caseId)).order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ documents: data });
});

// POST /api/cases/:caseId/upload — upload a document
router.post('/cases/:caseId/upload', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { file_name, file_type, file_url, file_size, category_id, notes } = req.body;
  const user = res.locals.user;
  const { data, error } = await sup.from('case_documents').insert({
    case_id: parseInt(req.params.caseId), file_name, file_type, file_url, file_size, category_id,
    notes, uploaded_by: user.id, version: 1,
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  await sup.from('case_comments').insert({
    case_id: parseInt(req.params.caseId), content: `📄 ${file_name}`,
  });
  res.json({ success: true, document: data });
});

// POST /api/documents/:id/verify — mark document as verified
router.post('/documents/:id/verify', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const user = res.locals.user;
  const { data, error } = await sup.from('case_documents').update({
    verification_status: 'verified', verified_by: user.id,
    verified_at: new Date().toISOString(),
  }).eq('id', parseInt(req.params.id)).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, document: data });
});

// PUT /api/documents/:id — update document metadata
router.put('/documents/:id', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data, error } = await sup.from('case_documents').update(req.body).eq('id', parseInt(req.params.id)).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, document: data });
});

// DELETE /api/documents/:id — soft delete
router.delete('/documents/:id', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { error } = await sup.from('case_documents').update({ is_deleted: true }).eq('id', parseInt(req.params.id));
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// GET /api/email-accounts — list email accounts
router.get('/email-accounts', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data, error } = await sup.from('email_accounts').select('*');
  if (error) return res.status(400).json({ error: error.message });
  res.json({ accounts: data || [] });
});

// GET /api/imap/diagnose/:accountId — production IMAP diagnostic (instrumented)
router.get('/imap/diagnose/:accountId', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { data: account } = await sup.from('email_accounts').select('*').eq('id', parseInt(req.params.accountId)).single();
    if (!account) return res.status(404).json({ success: false, error: 'Account not found' });
    const imapService = require('../services/imapService');
    const report = await imapService.diagnose(account);
    res.json(report);
  } catch (ex) { res.status(500).json({ success: false, error: ex.message }); }
});

// GET /api/imap/connectivity/:accountId — minimal connect+auth test
router.get('/imap/connectivity/:accountId', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { data: account } = await sup.from('email_accounts').select('*').eq('id', parseInt(req.params.accountId)).single();
    if (!account) return res.status(404).json({ success: false, error: 'Account not found' });
    const imapService = require('../services/imapService');
    const result = await imapService.testConnectivity(account);
    res.json(result);
  } catch (ex) { res.status(500).json({ success: false, error: ex.message }); }
});

// GET /api/imap/compare/:accountId — compare SMTP vs IMAP credentials securely
router.get('/imap/compare/:accountId', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { data: account } = await sup.from('email_accounts').select('*').eq('id', parseInt(req.params.accountId)).single();
    if (!account) return res.status(404).json({ success: false, error: 'Account not found' });
    const imapService = require('../services/imapService');
    const result = await imapService.compareCredentials(account);
    res.json(result);
  } catch (ex) { res.status(500).json({ success: false, error: ex.message }); }
});

// POST /api/imap/fix-credentials/:accountId — fix IMAP password + auto-test
router.post('/imap/fix-credentials/:accountId', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { encrypt, decrypt } = require('../services/crypto');
    const imapService = require('../services/imapService');

    const { data: account } = await sup.from('email_accounts').select('*').eq('id', parseInt(req.params.accountId)).single();
    if (!account) return res.status(404).json({ success: false, error: 'Account not found' });

    const result = { account: account.email, smtpStatus: null, imapStatus: null, updated: false, error: null };

    // Decrypt SMTP password
    let smtpPass;
    try {
      smtpPass = decrypt(account.smtp_pass);
      if (!smtpPass || smtpPass.length < 2) throw new Error('SMTP password empty after decrypt');
    } catch (e) {
      return res.json({ success: false, error: `Failed to decrypt SMTP password: ${e.message}` });
    }

    // Test SMTP with current password (should work)
    try {
      const transporter = require('nodemailer').createTransport({
        host: account.smtp_host || 'smtp.gmail.com',
        port: account.smtp_port || 587,
        secure: false,
        auth: { user: account.smtp_user || account.email, pass: smtpPass },
      });
      await transporter.verify();
      result.smtpStatus = 'pass';
    } catch (e) {
      result.smtpStatus = `fail: ${e.message}`;
    }

    // Encrypt SMTP pass as new IMAP pass
    const newImapPass = encrypt(smtpPass);

    // Update imap_pass in database
    const { error: updateError } = await sup.from('email_accounts')
      .update({ imap_pass: newImapPass })
      .eq('id', account.id);
    if (updateError) return res.json({ success: false, error: `Update failed: ${updateError.message}` });

    result.updated = true;

    // Test IMAP with new password
    const { data: updated } = await sup.from('email_accounts').select('*').eq('id', account.id).single();
    if (updated) {
      const imapResult = await imapService.testConnectivity(updated);
      result.imapStatus = imapResult.result === 'connected' ? 'pass' : `fail: ${imapResult.error || 'unknown'}`;
    }

    // Compare to confirm
    const compareResult = await imapService.compareCredentials(updated || account);
    result.passwordsMatch = compareResult.passwordsEqual;

    res.json({ success: true, result });
  } catch (ex) { res.status(500).json({ success: false, error: ex.message }); }
});
router.post('/cases/:caseId/compose', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.caseId);
    const { to, subject, body, account_id, agency_id, request_id } = req.body;
    if (!to || !subject || !account_id) return res.status(400).json({ error: 'to, subject, account_id مطلوبون' });

    // Get the email account
    const { data: account } = await sup.from('email_accounts').select('*').eq('id', parseInt(account_id)).single();
    if (!account) return res.status(404).json({ error: 'Email account not found' });

    // Decrypt password and send via SMTP
    let nodemailer;
    try { nodemailer = require('nodemailer'); }
    catch (e) { return res.json({ success: false, error: 'Nodemailer unavailable' }); }

    const { decrypt } = require('../services/crypto');
    const smtpPass = decrypt(account.smtp_pass);
    const transporter = nodemailer.createTransport({
      host: account.smtp_host || 'smtp.gmail.com',
      port: account.smtp_port || 587,
      secure: account.smtp_port === 465,
      auth: { user: account.smtp_user || account.email, pass: smtpPass },
      tls: { rejectUnauthorized: false },
    });

    const info = await transporter.sendMail({
      from: `"${account.name || account.email}" <${account.smtp_user || account.email}>`,
      to, subject, text: body,
    });

    // Create communication record (insert only — .select() may not return on all Supabase versions)
    const { data: comm } = await sup.from('communications').insert({
      case_id: caseId,
      type: 'email', direction: 'outbound',
      subject, body: body || '', sender: account.email, recipient: to,
      message_id: info.messageId,
      thread_id: info.messageId,
      created_at: new Date().toISOString(),
    }).select();

    // Create timeline event (best-effort)
    try {
      await sup.from('case_comments').insert({
        case_id: caseId, content: `📧 ${subject}`,
      });
    } catch (tlErr) { console.error('Timeline insert error:', tlErr.message); }

    res.json({ success: true, messageId: info.messageId });
  } catch (ex) {
    res.json({ success: false, error: ex.message });
  }
});

// GET /api/inbox — Global enterprise inbox
router.get('/inbox', requireAuth, async (req, res) => {
  const sup = getSupabase();
  try {
    const { status, account_id, search, limit = 50, offset = 0 } = req.query;
    let query = sup.from('communications').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    if (status === 'unread') query = query.is('is_read', false);
    if (status === 'read') query = query.is('is_read', true);
    if (status === 'unlinked') query = query.is('case_id', null);
    if (status === 'linked') query = query.not('case_id', 'is', null);
    if (account_id) query = query.eq('email_account_id', parseInt(account_id));
    if (search) query = query.or(`subject.ilike.%${search}%,sender.ilike.%${search}%,body.ilike.%${search}%`);

    const { data: messages, count, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, data: messages || [], total: count || 0 });
  } catch (ex) { res.status(500).json({ error: ex.message }); }
});

// PUT /api/inbox/:id/link — Link email to case + agency
router.put('/inbox/:id/link', requireAuth, async (req, res) => {
  const sup = getSupabase();
  try {
    const { case_id, agency_id } = req.body;
    const updates = {};
    if (case_id) updates.case_id = parseInt(case_id);
    if (agency_id) updates.agency_id = parseInt(agency_id);
    updates.is_read = true;
    const { error } = await sup.from('communications').update(updates).eq('id', parseInt(req.params.id));
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (ex) { res.status(500).json({ error: ex.message }); }
});

// PUT /api/inbox/:id/archive
router.put('/inbox/:id/archive', requireAuth, async (req, res) => {
  const sup = getSupabase();
  await sup.from('communications').update({ is_read: true }).eq('id', parseInt(req.params.id));
  res.json({ success: true });
});

// POST /api/imap/poll — Trigger IMAP polling
router.post('/imap/poll', requireAuth, async (req, res) => {
  try {
    const mailPoller = require('../services/mailPoller');
    const count = await mailPoller.pollAll();
    res.json({ success: true, newMessages: count });
  } catch (ex) { res.json({ success: false, error: ex.message }); }
});

// GET /api/inbox/unread-count
router.get('/inbox/unread-count', requireAuth, async (req, res) => {
  const sup = getSupabase();
  try {
    const { count, error } = await sup.from('communications').select('*', { count: 'exact', head: true }).is('is_read', false);
    if (error) return res.json({ unread: 0 });
    res.json({ unread: count || 0 });
  } catch (ex) { res.json({ unread: 0 }); }
});

module.exports = router;
