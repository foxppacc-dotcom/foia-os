const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const multer = require('multer');
const storage = require('../services/storage');
const composeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// communications.metadata is a plain TEXT column (not jsonb) — must stringify/parse manually.
function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

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

// GET /api/imap/folders/:accountId — INBOX vs Spam vs All Mail counts
// (mailPoller only ever reads INBOX; this checks whether a message that
// never showed up actually landed in Spam instead).
router.get('/imap/folders/:accountId', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { data: account } = await sup.from('email_accounts').select('*').eq('id', parseInt(req.params.accountId)).single();
    if (!account) return res.status(404).json({ success: false, error: 'Account not found' });
    const imapService = require('../services/imapService');
    const result = await imapService.checkFolders(account);
    res.json({ success: true, folders: result });
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
router.post('/cases/:caseId/compose', requireAuth, composeUpload.array('attachments', 10), async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.caseId);
    const { to, cc, bcc, subject, body, account_id, agency_id, request_id, reply_to_id } = req.body;
    if (!to || !subject || !account_id) return res.status(400).json({ error: 'to, subject, account_id مطلوبون' });

    const { data: account } = await sup.from('email_accounts').select('email').eq('id', parseInt(account_id)).single();
    if (!account) return res.status(404).json({ error: 'Email account not found' });

    // Reply/Reply-All/Forward: thread against the original message so both
    // our own matching (thread_id) and the recipient's mail client (In-Reply-To/
    // References headers) group this into the same conversation.
    let inReplyTo, references, threadId;
    if (reply_to_id) {
      const { data: original } = await sup.from('communications').select('message_id, thread_id').eq('id', parseInt(reply_to_id)).maybeSingle();
      if (original) {
        inReplyTo = original.message_id;
        references = original.message_id;
        threadId = original.thread_id || original.message_id;
      }
    }

    // Upload attachments to Supabase Storage AND attach them to the outgoing
    // email itself (nodemailer accepts a raw Buffer for `content`).
    const storedAttachments = [];
    const mailAttachments = [];
    for (const file of req.files || []) {
      const ext = file.originalname?.includes('.') ? file.originalname.slice(file.originalname.lastIndexOf('.')) : '';
      const storagePath = `case_${caseId}/email/${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
      const storageKey = await storage.upload('case-documents', storagePath, file.buffer, file.mimetype);
      storedAttachments.push({ filename: file.originalname, size: file.size, mimeType: file.mimetype, storageKey });
      mailAttachments.push({ filename: file.originalname, content: file.buffer });
    }

    const emailService = require('../services/emailService');
    const info = await emailService.sendEmail(parseInt(account_id), { to, cc, bcc, subject, text: body, inReplyTo, references, attachments: mailAttachments });

    // Create communication record (insert only — .select() may not return on all Supabase versions)
    await sup.from('communications').insert({
      case_id: caseId,
      type: 'email', direction: 'outbound',
      subject, body: body || '', sender: account.email, recipient: to,
      message_id: info.messageId,
      thread_id: threadId || info.messageId,
      created_at: new Date().toISOString(),
      metadata: storedAttachments.length ? JSON.stringify({ attachments: storedAttachments }) : null,
    }).select();

    // Create timeline event (best-effort)
    try {
      await sup.from('activity_logs').insert({
        user_id: req.user?.id, user_name: req.user?.name,
        action_type: reply_to_id ? 'email_reply' : 'email_sent',
        target_type: 'case', target_id: caseId, target_title: `📧 ${subject}`,
      });
    } catch (tlErr) { console.error('Timeline insert error:', tlErr.message); }

    res.json({ success: true, messageId: info.messageId });
  } catch (ex) {
    res.json({ success: false, error: ex.message });
  }
});

// GET /api/communications/:id/attachments/:index/download — signed URL for an attachment
router.get('/communications/:id/attachments/:index/download', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { data: comm } = await sup.from('communications').select('metadata').eq('id', parseInt(req.params.id)).maybeSingle();
    const attachments = parseMetadata(comm?.metadata).attachments || [];
    const att = attachments[parseInt(req.params.index)];
    if (!att || !att.storageKey) return res.status(404).json({ error: 'Attachment not found' });
    const [bucket, ...pathParts] = att.storageKey.split('/');
    const url = await storage.getSignedUrl(bucket, pathParts.join('/'));
    if (!url) return res.status(500).json({ error: 'Could not generate download URL' });
    res.json({ success: true, url, filename: att.filename });
  } catch (ex) {
    res.status(500).json({ error: ex.message });
  }
});

// DELETE /api/communications/:id/attachments/:index — remove one attachment
router.delete('/communications/:id/attachments/:index', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const commId = parseInt(req.params.id);
    const index = parseInt(req.params.index);
    const { data: comm } = await sup.from('communications').select('metadata').eq('id', commId).maybeSingle();
    const meta = parseMetadata(comm?.metadata);
    const attachments = meta.attachments || [];
    const att = attachments[index];
    if (!att) return res.status(404).json({ error: 'Attachment not found' });

    if (att.storageKey) await storage.deleteByKey(att.storageKey).catch(e => console.warn('Storage delete failed:', e.message));

    const updatedAttachments = attachments.filter((_, i) => i !== index);
    await sup.from('communications').update({ metadata: JSON.stringify({ ...meta, attachments: updatedAttachments }) }).eq('id', commId);

    try {
      await sup.from('activity_logs').insert({
        user_id: req.user?.id, user_name: req.user?.name,
        action_type: 'attachment_deleted', target_type: 'communication', target_id: commId,
        target_title: `🗑️ ${att.filename}`,
      });
    } catch (e) { console.error('[attachments] activity_logs insert failed:', e.message); }

    res.json({ success: true });
  } catch (ex) {
    res.status(500).json({ error: ex.message });
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
    const parsed = (messages || []).map(m => {
      let metadata = {};
      if (m.metadata) {
        if (typeof m.metadata !== 'string') metadata = m.metadata;
        else { try { metadata = JSON.parse(m.metadata); } catch { metadata = {}; } }
      }
      return { ...m, metadata };
    });
    res.json({ success: true, data: parsed, total: count || 0 });
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
