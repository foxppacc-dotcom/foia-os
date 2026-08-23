const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, requirePermission } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const multer = require('multer');
const storage = require('../services/storage');
const caseFileStorage = require('../services/caseFileStorage');
const gdrive = require('../services/googleDriveService');
const composeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const { requireCaseAccess, canAccessCase, canViewAllCases, getVisibleCaseIds } = require('../services/caseAccess');
const { notifyUsers, getCaseRecipients, getCaseActivityRecipients } = require('../services/notificationService');
const { checkLock } = require('../services/emailAccountLock');
// /cases/:caseId/documents, /upload, /compose, /portal-log previously had no
// per-case access check -- a role restricted to its own assigned cases
// could list/upload documents, SEND A REAL OUTBOUND EMAIL as, or log a
// portal submission on ANY case just by knowing its id.
const caseGate = requireCaseAccess('caseId');

// communications.metadata is a plain TEXT column (not jsonb) — must stringify/parse manually.
function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

// ============ AGENCY COMMUNICATION CONFIG ============

// PUT /api/requests/:id/communication-config — save agency settings
// Previously only requireAuth -- a role restricted to its own assigned
// cases could reconfigure the send account/method/SLA on ANY request in
// the system just by knowing its id, same class of gap the earlier
// case-scoping audit fixed elsewhere -- requests.case_id is NOT NULL, so
// resolving it first and gating on it is always possible.
router.put('/requests/:id/communication-config', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const requestId = parseInt(req.params.id);
  const { data: reqRow } = await sup.from('requests').select('case_id').eq('id', requestId).maybeSingle();
  if (!reqRow) return res.status(404).json({ error: 'Request not found' });
  if (!(await canAccessCase(sup, req.user, reqRow.case_id))) return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
  const { email_account_id, comm_method, sla_days } = req.body;
  const configStr = JSON.stringify({ _comm: { email_account_id: email_account_id || null, method: comm_method || 'email', sla_days: sla_days || 20, updated_at: new Date().toISOString() }});
  const { error } = await sup.from('requests').update({ notes: configStr }).eq('id', requestId);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// PUT /api/requests/:id/status — quick actions (send, reminder, escalate, verify, close)
router.put('/requests/:id/status', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const requestId = parseInt(req.params.id);
  const { data: reqRow } = await sup.from('requests').select('case_id').eq('id', requestId).maybeSingle();
  if (!reqRow) return res.status(404).json({ error: 'Request not found' });
  if (!(await canAccessCase(sup, req.user, reqRow.case_id))) return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status required' });
  const update = { status };
  if (status === 'sent' || status === 'reminder') update.sent_date = new Date().toISOString();
  const { error } = await sup.from('requests').update(update).eq('id', requestId);
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
  // Scoped by the DOCUMENT's own id, not a case id in the URL -- still owned
  // by a case, so still has to check that case's visibility.
  if (data && !(await canAccessCase(sup, req.user, data.case_id))) {
    return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
  }
  res.json({ document: data });
});

// GET /api/cases/:caseId/documents — list documents for a case
router.get('/cases/:caseId/documents', requireAuth, caseGate, async (req, res) => {
  const sup = getSupabase();
  const { data, error } = await sup.from('case_documents').select('*').eq('case_id', parseInt(req.params.caseId)).order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ documents: data });
});

// POST /api/cases/:caseId/upload — register an already-hosted file (a URL,
// not real bytes) as a case_documents row. Kept as-is for whatever calls it
// with a pre-existing file_url; NOT what the Documents tab's own upload
// widget uses (see below).
router.post('/cases/:caseId/upload', requireAuth, caseGate, async (req, res) => {
  const sup = getSupabase();
  const { file_name, file_type, file_url, file_size, category_id, notes } = req.body;
  const user = req.user;
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
  const user = req.user;
  const { data: docRow } = await sup.from('case_documents').select('case_id').eq('id', parseInt(req.params.id)).maybeSingle();
  if (docRow && !(await canAccessCase(sup, req.user, docRow.case_id))) {
    return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
  }
  const { data, error } = await sup.from('case_documents').update({
    verification_status: 'verified', verified_by: user.id,
    verified_at: new Date().toISOString(),
  }).eq('id', parseInt(req.params.id)).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, document: data });
});

// PUT /api/documents/:id — update document metadata (rename, notes, category, etc.)
// Whitelisted -- req.body used to be passed straight into .update() with no
// field restriction, letting a caller silently reassign case_id, storage_key,
// uploaded_by, or any other column on a request they control.
router.put('/documents/:id', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const allowed = ['original_name', 'description', 'category_id', 'verification_status', 'tags', 'confidentiality'];
  const updates = {};
  for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  const { data: before } = await sup.from('case_documents').select('case_id, original_name, storage_provider, drive_file_id').eq('id', parseInt(req.params.id)).maybeSingle();
  if (before && !(await canAccessCase(sup, req.user, before.case_id))) {
    return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
  }
  const { data, error } = await sup.from('case_documents').update(updates).eq('id', parseInt(req.params.id)).select().single();
  if (error) return res.status(400).json({ error: error.message });

  if (before?.storage_provider === 'google_drive' && before.drive_file_id && updates.original_name) {
    await gdrive.renameFile(before.drive_file_id, updates.original_name).catch(e => console.error('[documents] Drive rename failed:', e.message));
  }

  if (before && updates.original_name && updates.original_name !== before.original_name) {
    await sup.from('activity_logs').insert({
      user_id: req.user?.id, user_name: req.user?.name,
      action_type: 'document_renamed', target_type: 'case', target_id: before.case_id,
      target_title: `✏️ ${before.original_name} → ${updates.original_name}`,
    }).catch(e => console.error('[documents] rename activity log failed:', e.message));
  }

  res.json({ success: true, document: data });
});

// GET /api/documents/:id/download — signed URL for download/preview
router.get('/documents/:id/download', requireAuth, async (req, res) => {
  // Previously had no try/catch: a rejected gdrive.getFileLinks() call (e.g.
  // an expired/invalid token, or Google's API hanging) was an unhandled
  // promise rejection in an async Express handler -- neither res.json() nor
  // res.status() ever ran, so the request hung indefinitely with no error
  // and no response. The click looked like it "just doesn't work".
  try {
    const sup = getSupabase();
    const { data: doc } = await sup.from('case_documents').select('case_id, storage_key, file_path, original_name, storage_provider, drive_file_id').eq('id', parseInt(req.params.id)).maybeSingle();
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (!(await canAccessCase(sup, req.user, doc.case_id))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }

    if (doc.storage_provider === 'google_drive' && doc.drive_file_id) {
      // Bound the Drive call so a hung/slow Google API request surfaces as a
      // clear timeout error instead of hanging the whole request forever.
      const withTimeout = (promise, ms) => Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Google Drive لم يستجب في الوقت المناسب')), ms)),
      ]);
      const { downloadUrl, viewUrl } = await withTimeout(gdrive.getFileLinks(doc.drive_file_id), 15000);
      return res.json({ success: true, url: downloadUrl || viewUrl || doc.file_path, filename: doc.original_name });
    }

    const key = doc.storage_key || doc.file_path;
    if (!key || !key.includes('/')) return res.status(404).json({ error: 'No storage key on this document' });
    const [bucket, ...pathParts] = key.split('/');
    const url = await storage.getSignedUrl(bucket, pathParts.join('/'));
    if (!url) return res.status(500).json({ error: 'Could not generate download URL' });
    res.json({ success: true, url, filename: doc.original_name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/documents/:id — soft delete
router.delete('/documents/:id', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data: docRow } = await sup.from('case_documents').select('case_id').eq('id', parseInt(req.params.id)).maybeSingle();
  if (docRow && !(await canAccessCase(sup, req.user, docRow.case_id))) {
    return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
  }
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
router.get('/imap/compare/:accountId', requireAuth, requirePermission('email_accounts', 'manage'), async (req, res) => {
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
router.post('/imap/fix-credentials/:accountId', requireAuth, requirePermission('email_accounts', 'manage'), async (req, res) => {
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
router.post('/cases/:caseId/compose', requireAuth, caseGate, composeUpload.array('attachments', 10), async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.caseId);
    const { to, cc, bcc, subject, body, account_id, agency_id, request_id, reply_to_id, expected_response_days } = req.body;
    if (!to || !subject || !account_id) return res.status(400).json({ error: 'to, subject, account_id مطلوبون' });

    const { data: account } = await sup.from('email_accounts').select('email').eq('id', parseInt(account_id)).single();
    if (!account) return res.status(404).json({ error: 'Email account not found' });

    // Once this account has emailed this agency for another case, block
    // reusing it here too (unless a permissioned user explicitly unlocked
    // it) -- keeps inbound replies filtering to exactly one case instead of
    // being ambiguous between two. Only applies when an agency is actually
    // selected; a reply/forward with no agency picked is unaffected.
    if (agency_id) {
      const lockCheck = await checkLock(sup, parseInt(account_id), parseInt(agency_id), caseId);
      if (lockCheck.locked) {
        return res.status(409).json({
          error: `هذا الحساب مستخدم بالفعل لمراسلة هذه الجهة في قضية "${lockCheck.lockedByCase?.title || '#' + lockCheck.lockedByCase?.id}" — اختر حسابًا آخر، أو اطلب فك القيد من صاحب الصلاحية.`,
        });
      }
    }

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

    // Upload attachments to Google Drive AND attach them to the outgoing
    // email itself (nodemailer accepts a raw Buffer for `content`). Also
    // register each one as a real Case Document -- sent attachments should
    // show up in the Files tab too, not only in the email thread.
    const storedAttachments = [];
    const mailAttachments = [];
    for (const file of req.files || []) {
      const dotIdx = file.originalname?.lastIndexOf('.') ?? -1;
      const ext = dotIdx >= 0 ? file.originalname.slice(dotIdx) : '';
      const fileType = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext.toLowerCase()) ? 'image'
        : ['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext.toLowerCase()) ? 'video'
        : ['.mp3', '.wav', '.ogg', '.flac'].includes(ext.toLowerCase()) ? 'audio' : 'document';
      mailAttachments.push({ filename: file.originalname, content: file.buffer, contentType: file.mimetype });

      try {
        const driveFields = await caseFileStorage.saveCaseFile({
          caseId, buffer: file.buffer, fileName: file.originalname, mimeType: file.mimetype, category: 'outgoing',
        });
        storedAttachments.push({ filename: file.originalname, size: file.size, mimeType: file.mimetype, driveFileId: driveFields.drive_file_id, viewUrl: driveFields.file_path });

        const { error: docErr } = await sup.from('case_documents').insert({
          case_id: caseId,
          filename: file.originalname, original_name: file.originalname,
          mime_type: file.mimetype, size: file.size,
          file_type: fileType, uploaded_by: req.user?.id,
          source: 'email',
          ...driveFields, url: driveFields.file_path,
        });
        if (docErr) console.error(`[compose] case_documents insert failed for "${file.originalname}":`, docErr.message);
      } catch (uploadErr) {
        console.error(`[compose] Drive upload failed for "${file.originalname}":`, uploadErr.message);
        storedAttachments.push({ filename: file.originalname, size: file.size, mimeType: file.mimetype, uploadError: uploadErr.message });
      }
    }

    const emailService = require('../services/emailService');
    const info = await emailService.sendEmail(parseInt(account_id), { to, cc, bcc, subject, text: body, inReplyTo, references, attachments: mailAttachments });

    // Create communication record. The email is already sent at this point
    // (SMTP accepted it) -- an unchecked error here would mean the message
    // reached the recipient but silently never showed up in the case's own
    // thread view, with the API still reporting success either way.
    // agency_id/request_id were already being received above (line 319) and
    // used transiently for deadline-tracking below, but never actually
    // stamped onto the row itself -- inbound matching (mailPoller.js) relies
    // on this same column and sets it correctly, so a SENT email had no
    // reliable way to surface in the per-agency/per-request correspondence
    // log (AgenciesTab.jsx) unless a later reply happened to backfill it.
    const { error: commErr } = await sup.from('communications').insert({
      case_id: caseId,
      type: 'email', direction: 'outbound',
      subject, body: body || '', sender: account.email, recipient: to,
      message_id: info.messageId,
      thread_id: threadId || info.messageId,
      created_at: new Date().toISOString(),
      email_account_id: parseInt(account_id),
      agency_id: agency_id ? parseInt(agency_id) : null,
      request_id: request_id ? parseInt(request_id) : null,
      // A message we just sent is read by definition -- is_read defaults to
      // false in the schema, which fed the "unread" badge with our own sent
      // mail (see /inbox/unread-count).
      is_read: true,
      metadata: storedAttachments.length ? JSON.stringify({ attachments: storedAttachments }) : null,
    });
    if (commErr) console.error('[compose] communications insert failed (email was still sent):', commErr.message);

    // Create timeline event (best-effort)
    try {
      await sup.from('activity_logs').insert({
        user_id: req.user?.id, user_name: req.user?.name,
        action_type: reply_to_id ? 'email_reply' : 'email_sent',
        target_type: 'case', target_id: caseId, target_title: `📧 ${subject}`,
      });
    } catch (tlErr) { console.error('Timeline insert error:', tlErr.message); }

    // Deadline tracking: set/refresh the expected response date on the
    // matching request so overdue agencies surface automatically instead of
    // being tracked by memory.
    if (expected_response_days) {
      try {
        let targetRequestId = request_id ? parseInt(request_id) : null;
        if (!targetRequestId && agency_id) {
          const { data: req_ } = await sup.from('requests').select('id')
            .eq('case_id', caseId).eq('agency_id', parseInt(agency_id))
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          targetRequestId = req_?.id || null;
        }
        if (targetRequestId) {
          const days = parseInt(expected_response_days);
          const due = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const { error: dlUpdateErr } = await sup.from('requests').update({ expected_response_date: due, sent_date: new Date().toISOString().split('T')[0] }).eq('id', targetRequestId);
          if (dlUpdateErr) console.error('Deadline tracking update failed:', dlUpdateErr.message);
        }
      } catch (dlErr) { console.error('Deadline tracking update failed:', dlErr.message); }
    }

    // Attachment archival failures (Drive upload / case_documents insert)
    // were only ever console.error'd -- the email itself still sends fine
    // (mailAttachments was built before this), but the admin had no way to
    // know a specific file never made it into the case's own Files tab.
    const attachmentWarnings = storedAttachments.filter(a => a.uploadError).map(a => `تعذر أرشفة "${a.filename}": ${a.uploadError}`);
    res.json({ success: true, messageId: info.messageId, warnings: attachmentWarnings.length ? attachmentWarnings : undefined });
  } catch (ex) {
    res.json({ success: false, error: ex.message });
  }
});

// POST /api/cases/:caseId/portal-log — log a correspondence event submitted
// through the agency's own portal (no SMTP send, just a record + deadline),
// mirrors the deadline-tracking block in /compose above.
router.post('/cases/:caseId/portal-log', requireAuth, caseGate, async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.caseId);
    const { agency_id, request_id, note, expected_response_days, confirmation_number } = req.body;
    if (!agency_id) return res.status(400).json({ error: 'agency_id مطلوب' });

    const { data: agency } = await sup.from('agencies').select('name_ar, name_en, portal_url').eq('id', parseInt(agency_id)).maybeSingle();

    let targetRequestId = request_id ? parseInt(request_id) : null;
    if (!targetRequestId) {
      const { data: req_ } = await sup.from('requests').select('id')
        .eq('case_id', caseId).eq('agency_id', parseInt(agency_id))
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      targetRequestId = req_?.id || null;
    }

    const subject = confirmation_number ? `تقديم عبر البوابة — رقم التأكيد: ${confirmation_number}` : 'تقديم عبر البوابة';
    await sup.from('communications').insert({
      case_id: caseId, request_id: targetRequestId, agency_id: parseInt(agency_id),
      type: 'portal', direction: 'outbound',
      subject, body: note || '',
      sender: req.user?.name || 'النظام', recipient: agency?.portal_url || agency?.name_en || '',
      created_at: new Date().toISOString(),
    });

    try {
      await sup.from('activity_logs').insert({
        user_id: req.user?.id, user_name: req.user?.name,
        action_type: 'portal_submission', target_type: 'case', target_id: caseId,
        target_title: `🌐 ${subject}`,
      });
    } catch (tlErr) { console.error('Timeline insert error:', tlErr.message); }

    if (expected_response_days && targetRequestId) {
      const days = parseInt(expected_response_days);
      const due = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const { error: dlUpdateErr } = await sup.from('requests').update({ expected_response_date: due, sent_date: new Date().toISOString().split('T')[0], channel_method: 'portal' }).eq('id', targetRequestId);
      if (dlUpdateErr) console.error('Deadline tracking update failed:', dlUpdateErr.message);
    }

    res.json({ success: true });
  } catch (ex) {
    res.status(500).json({ error: ex.message });
  }
});

// GET /api/communications/:id/attachments/:index/download — signed URL for an attachment
router.get('/communications/:id/attachments/:index/download', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { data: comm } = await sup.from('communications').select('case_id, metadata').eq('id', parseInt(req.params.id)).maybeSingle();
    // A standalone inbox message (case_id null) isn't case-scoped -- the
    // org-wide inbox itself has no per-case visibility boundary to enforce
    // here. One that IS linked to a case must respect that case's scope.
    if (comm?.case_id && !(await canAccessCase(sup, req.user, comm.case_id))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }
    const attachments = parseMetadata(comm?.metadata).attachments || [];
    const att = attachments[parseInt(req.params.index)];
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    if (att.driveFileId) {
      const { downloadUrl, viewUrl } = await gdrive.getFileLinks(att.driveFileId);
      return res.json({ success: true, url: downloadUrl || viewUrl || att.viewUrl, filename: att.filename });
    }
    if (!att.storageKey) return res.status(404).json({ error: 'Attachment not found' });
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
    const { data: comm } = await sup.from('communications').select('case_id, metadata').eq('id', commId).maybeSingle();
    if (comm?.case_id && !(await canAccessCase(sup, req.user, comm.case_id))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }
    const meta = parseMetadata(comm?.metadata);
    const attachments = meta.attachments || [];
    const att = attachments[index];
    if (!att) return res.status(404).json({ error: 'Attachment not found' });

    if (att.driveFileId) await gdrive.deleteFile(att.driveFileId).catch(e => console.warn('Drive delete failed:', e.message));
    else if (att.storageKey) await storage.deleteByKey(att.storageKey).catch(e => console.warn('Storage delete failed:', e.message));

    const updatedAttachments = attachments.filter((_, i) => i !== index);
    const { error: metaErr } = await sup.from('communications').update({ metadata: JSON.stringify({ ...meta, attachments: updatedAttachments }) }).eq('id', commId);
    if (metaErr) return res.status(400).json({ error: metaErr.message });

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
    const { status, account_id, direction, date_from, date_to, search, limit = 50, offset = 0 } = req.query;

    // Resolve free-text search to a set of matching ids via 3 separate
    // single-column ilike queries instead of a hand-rolled
    // .or("subject.ilike.%x%,sender.ilike.%x%,...") string -- PostgREST
    // parses that string's own commas/parens as ITS filter-grammar syntax,
    // so a search term that happens to contain either (a sender "Smith,
    // John", a subject with "(Re:)") broke the ENTIRE query with a 500
    // instead of just not matching. A plain .ilike() call passes the value
    // as a normal parameter -- nothing hand-rolled, nothing to break.
    let searchIds = null;
    if (search) {
      const [bySubject, bySender, byBody] = await Promise.all([
        sup.from('communications').select('id').ilike('subject', `%${search}%`),
        sup.from('communications').select('id').ilike('sender', `%${search}%`),
        sup.from('communications').select('id').ilike('body', `%${search}%`),
      ]);
      searchIds = new Set([...(bySubject.data || []), ...(bySender.data || []), ...(byBody.data || [])].map(r => r.id));
      // Email number -- an exact lookup (`.eq`, indexed, no scale limit),
      // not the fetch-every-id-and-substring-match approach cases.js uses
      // for case numbers. communications already has 1200+ rows and grows
      // constantly from live mail ingestion; an unbounded `.select('id')`
      // silently truncates at PostgREST's default 1000-row cap, so anything
      // past that row would never match no matter what was typed -- confirmed
      // live (1219 rows, only 1000 returned). cases.js's identical pattern
      // hasn't hit this yet (181 rows) but has the same latent ceiling.
      if (/^\d+$/.test(search.trim())) searchIds.add(parseInt(search.trim()));
    }

    // migrations/012 (is_archived/reviewed_by) may not have been run yet in
    // this environment -- build the query with archive support, but if it
    // fails specifically because that column doesn't exist, retry once
    // without it rather than hard-failing the entire inbox (every tab, not
    // just أرشيف) until the migration lands.
    const buildQuery = (withArchiveSupport) => {
      let q = sup.from('communications').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
      if (status === 'archived') {
        if (withArchiveSupport) q = q.eq('is_archived', true);
      } else {
        // Archived messages have their own tab -- every other tab
        // (all/unread/unlinked/linked) should exclude them, otherwise
        // "أرشفة" would keep a message showing up in the main list forever,
        // identical to before this migration when it was just an is_read
        // alias. .not(col, 'is', true) rather than .eq(col, false) so a row
        // that somehow has NULL here still counts as "not archived" instead
        // of silently vanishing.
        if (withArchiveSupport) q = q.not('is_archived', 'is', true);
        if (status === 'unread') q = q.is('is_read', false);
        if (status === 'read') q = q.is('is_read', true);
        if (status === 'unlinked') q = q.is('case_id', null);
        if (status === 'linked') q = q.not('case_id', 'is', null);
      }
      if (account_id) q = q.eq('email_account_id', parseInt(account_id));
      if (date_from) q = q.gte('created_at', date_from);
      // date_to is a plain "YYYY-MM-DD" from a <input type="date">, meaning
      // "through the end of that day" -- compared as-is it would exclude
      // every message from that day itself (anything after 00:00:00).
      if (date_to) q = q.lt('created_at', `${date_to}T23:59:59.999`);
      if (direction === 'inbound' || direction === 'outbound') q = q.eq('direction', direction);
      if (searchIds) q = q.in('id', searchIds.size ? [...searchIds] : [-1]);
      return q;
    };

    let archiveSupported = true;
    let { data: messages, count, error } = await buildQuery(true);
    if (error && /is_archived/.test(error.message)) {
      archiveSupported = false;
      ({ data: messages, count, error } = await buildQuery(false));
    }
    if (error) return res.status(500).json({ error: error.message });

    // Batch-resolve reviewer names ("تم الفحص") -- no reliance on a
    // PostgREST embedded-relationship join (see portals.js's earlier fix for
    // why that's fragile), just a second query keyed by the distinct ids.
    const reviewerIds = [...new Set((messages || []).map(m => m.reviewed_by).filter(Boolean))];
    let reviewerNames = {};
    if (reviewerIds.length) {
      const { data: reviewers } = await sup.from('users').select('id, name').in('id', reviewerIds);
      reviewerNames = Object.fromEntries((reviewers || []).map(u => [u.id, u.name]));
    }

    const parsed = (messages || []).map(m => {
      let metadata = {};
      if (m.metadata) {
        if (typeof m.metadata !== 'string') metadata = m.metadata;
        else { try { metadata = JSON.parse(m.metadata); } catch { metadata = {}; } }
      }
      return { ...m, metadata, reviewed_by_name: m.reviewed_by ? (reviewerNames[m.reviewed_by] || null) : null };
    });

    // If searching outside the archive, tell the user whether the same
    // search also has hits INSIDE the archive -- otherwise an archived
    // match is invisible with no indication it exists at all.
    let archivedMatches = 0;
    if (archiveSupported && search && status !== 'archived') {
      const { count: archCount } = await sup.from('communications').select('id', { count: 'exact', head: true })
        .eq('is_archived', true).in('id', searchIds.size ? [...searchIds] : [-1]);
      archivedMatches = archCount || 0;
    }

    res.json({ success: true, data: parsed, total: count || 0, archivedMatches });
  } catch (ex) { res.status(500).json({ error: ex.message }); }
});

// POST /api/inbox/compose — send a standalone email from صندوق البريد, not
// tied to any case. The only compose path before this was /cases/:caseId/compose,
// which hard-requires a case; general correspondence unrelated to any
// investigation had nowhere to go through this system's own accounts.
router.post('/inbox/compose', requireAuth, composeUpload.array('attachments', 10), async (req, res) => {
  try {
    const { account_id, to, cc, bcc, subject, body, case_id, reply_to_id } = req.body;
    if (!account_id || !to || !subject) return res.status(400).json({ error: 'account_id, to, subject مطلوبون' });

    const sup = getSupabase();
    const { data: account } = await sup.from('email_accounts').select('email').eq('id', parseInt(account_id)).maybeSingle();
    if (!account) return res.status(404).json({ error: 'Email account not found' });

    // Replying/forwarding from the standalone message tab: thread against
    // the original so both our own matching (thread_id) and the
    // recipient's mail client (In-Reply-To/References) group it into the
    // same conversation, and keep the same case link if the original had one.
    let inReplyTo, references, threadId, linkedCaseId = case_id ? parseInt(case_id) : null, linkedAgencyId = null;
    if (reply_to_id) {
      const { data: original } = await sup.from('communications').select('message_id, thread_id, case_id, agency_id').eq('id', parseInt(reply_to_id)).maybeSingle();
      if (original) {
        inReplyTo = original.message_id;
        references = original.message_id;
        threadId = original.thread_id || original.message_id;
        if (!linkedCaseId) linkedCaseId = original.case_id || null;
        linkedAgencyId = original.agency_id || null;
      }
    }
    // Same class of gap the earlier case-scoping audit fixed on every other
    // compose/link route -- an unchecked case_id here (whether passed
    // directly or inherited from a replied-to message) would let a
    // restricted-role user fabricate a communications row on any case.
    if (linkedCaseId && !(await canAccessCase(sup, req.user, linkedCaseId))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }

    // Attached straight to the outgoing email only -- there's no case here
    // to file a Drive copy under (unlike /cases/:id/compose), so just the
    // filename/size get recorded for display, not the bytes themselves.
    const mailAttachments = (req.files || []).map(f => ({ filename: f.originalname, content: f.buffer, contentType: f.mimetype }));
    const storedAttachments = (req.files || []).map(f => ({ filename: f.originalname, size: f.size, mimeType: f.mimetype }));

    const emailService = require('../services/emailService');
    const info = await emailService.sendEmail(parseInt(account_id), { to, cc, bcc, subject, text: body, inReplyTo, references, attachments: mailAttachments });

    const { data, error } = await sup.from('communications').insert({
      type: 'email', direction: 'outbound',
      subject, body: body || '', sender: account.email, recipient: to,
      message_id: info.messageId,
      thread_id: threadId || info.messageId,
      created_at: new Date().toISOString(),
      email_account_id: parseInt(account_id),
      is_read: true,
      case_id: linkedCaseId,
      agency_id: linkedAgencyId,
      metadata: storedAttachments.length ? JSON.stringify({ attachments: storedAttachments }) : null,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json({ success: true, data, messageId: info.messageId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/inbox/:id/link — Link email to case + agency
router.put('/inbox/:id/link', requireAuth, async (req, res) => {
  const sup = getSupabase();
  try {
    const { case_id, agency_id } = req.body;
    // A restricted-role user could otherwise link a message onto (or read
    // metadata for) a case they don't otherwise have access to, just by
    // supplying its id here -- same class of gap the case-scoping audit
    // fixed elsewhere.
    if (case_id && !(await canAccessCase(sup, req.user, case_id))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }
    const updates = {};
    if (case_id) updates.case_id = parseInt(case_id);
    if (agency_id) updates.agency_id = parseInt(agency_id);
    updates.is_read = true;
    // A manual link is just as much a "why is this linked" fact as an
    // automatic one -- previously only automatic matches carried any reason
    // at all, and even those were thrown away once resolved.
    if (case_id) updates.match_reason = { tier_key: 'manual', label_ar: 'تم الربط يدويًا بواسطة موظف' };

    // A manual link resolves whatever ambiguity the automatic matcher
    // flagged (see mailPoller.js's possibleMatches) -- clear it so a
    // resolved message doesn't keep showing a stale "might also be case X/Y"
    // hint after the user already picked one.
    const { data: existing } = await sup.from('communications').select('metadata, subject, sender, case_id').eq('id', parseInt(req.params.id)).maybeSingle();
    if (existing?.case_id && !(await canAccessCase(sup, req.user, existing.case_id))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }
    if (existing) {
      let meta = {};
      try { meta = existing.metadata ? JSON.parse(existing.metadata) : {}; } catch { meta = {}; }
      if (meta.possible_matches) { delete meta.possible_matches; updates.metadata = JSON.stringify(meta); }
    }

    let { error } = await sup.from('communications').update(updates).eq('id', parseInt(req.params.id));
    // migrations/033 (match_reason column) may not have been run yet --
    // retry without it rather than failing the link entirely.
    if (error && /match_reason/.test(error.message)) {
      delete updates.match_reason;
      ({ error } = await sup.from('communications').update(updates).eq('id', parseInt(req.params.id)));
    }
    if (error) return res.status(400).json({ error: error.message });

    // A manually-linked email is exactly the same "email arrived on this
    // case" event the automatic matcher already notifies for in
    // mailPoller.js -- this route just never fired it, so linking an email
    // by hand was invisible on the case's activity badge even though the
    // automatic path for the same outcome wasn't.
    if (updates.case_id) {
      try {
        const recipients = await getCaseActivityRecipients(sup, updates.case_id, { excludeUserId: req.user?.id });
        await notifyUsers(sup, recipients, {
          type: 'email_received', title: '📩 بريد مرتبط بالقضية',
          body: `${req.user?.name || 'أحد الموظفين'} ربط بريدًا (${existing?.sender || ''}: ${existing?.subject || ''}) بالقضية`,
          target_type: 'case', target_id: updates.case_id,
        });
      } catch (e) { console.error('[inbox] link notification failed:', e.message); }
    }

    res.json({ success: true });
  } catch (ex) { res.status(500).json({ error: ex.message }); }
});

// PUT /api/inbox/:id/read — opening a message in the list previously never
// called anything at all, so a message the user had actually read stayed
// counted as "unread" forever unless separately linked or archived.
router.put('/inbox/:id/read', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data: comm } = await sup.from('communications').select('case_id').eq('id', parseInt(req.params.id)).maybeSingle();
  if (comm?.case_id && !(await canAccessCase(sup, req.user, comm.case_id))) {
    return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
  }
  const { error } = await sup.from('communications').update({ is_read: true }).eq('id', parseInt(req.params.id));
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// PUT /api/inbox/:id/archive -- previously just an is_read alias with no
// real archived state at all (see the migration note in
// migrations/012_communications_review_archive.sql); this now actually
// removes the message from the main inbox tabs into its own أرشيف tab.
router.put('/inbox/:id/archive', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data: comm } = await sup.from('communications').select('case_id').eq('id', parseInt(req.params.id)).maybeSingle();
  if (comm?.case_id && !(await canAccessCase(sup, req.user, comm.case_id))) {
    return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
  }
  const { error } = await sup.from('communications').update({ is_archived: true, archived_at: new Date().toISOString() }).eq('id', parseInt(req.params.id));
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// PUT /api/inbox/:id/unarchive -- restore a message back to the main inbox.
router.put('/inbox/:id/unarchive', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data: comm } = await sup.from('communications').select('case_id').eq('id', parseInt(req.params.id)).maybeSingle();
  if (comm?.case_id && !(await canAccessCase(sup, req.user, comm.case_id))) {
    return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
  }
  const { error } = await sup.from('communications').update({ is_archived: false, archived_at: null }).eq('id', parseInt(req.params.id));
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// PUT /api/inbox/:id/review -- "تم الفحص": records which employee reviewed
// this message. Distinct from is_read (which just means "opened") -- a
// message can be opened without anyone having actually verified its content.
router.put('/inbox/:id/review', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data: comm } = await sup.from('communications').select('case_id').eq('id', parseInt(req.params.id)).maybeSingle();
  if (comm?.case_id && !(await canAccessCase(sup, req.user, comm.case_id))) {
    return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
  }
  const { error } = await sup.from('communications')
    .update({ reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
    .eq('id', parseInt(req.params.id));
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, reviewed_by: req.user.id, reviewed_by_name: req.user.name, reviewed_at: new Date().toISOString() });
});

// PUT /api/inbox/:id/unlink -- detach a message from whatever case/agency
// it's currently linked to, without deleting it, so it can be manually
// relinked to a DIFFERENT case that actually matches (e.g. after the
// automatic matcher's fuzzy tiers guessed wrong, or flagged more than one
// plausible case as `possible_matches` in metadata).
router.put('/inbox/:id/unlink', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data: comm } = await sup.from('communications').select('case_id').eq('id', parseInt(req.params.id)).maybeSingle();
  if (comm?.case_id && !(await canAccessCase(sup, req.user, comm.case_id))) {
    return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
  }
  let { error } = await sup.from('communications')
    .update({ case_id: null, agency_id: null, request_id: null, match_reason: null })
    .eq('id', parseInt(req.params.id));
  if (error && /match_reason/.test(error.message)) {
    ({ error } = await sup.from('communications').update({ case_id: null, agency_id: null, request_id: null }).eq('id', parseInt(req.params.id)));
  }
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// PUT /api/inbox/:id/reject-match -- "هذا الربط غير صحيح": same effect as
// unlink, but also tells the matching-criteria system the reason that
// produced this link was wrong, so an admin reviewing "معايير ربط
// الإيميلات" can see which tiers are actually noisy instead of guessing.
// Structural tiers (thread_reply/thread_references) and manual links aren't
// heuristics to tune, so rejecting one just unlinks without affecting any
// criterion's stats.
router.put('/inbox/:id/reject-match', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data: comm } = await sup.from('communications').select('case_id, match_reason').eq('id', parseInt(req.params.id)).maybeSingle();
  if (!comm) return res.status(404).json({ error: 'Message not found' });
  if (comm.case_id && !(await canAccessCase(sup, req.user, comm.case_id))) {
    return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
  }
  let { error } = await sup.from('communications')
    .update({ case_id: null, agency_id: null, request_id: null, match_reason: null })
    .eq('id', parseInt(req.params.id));
  if (error && /match_reason/.test(error.message)) {
    ({ error } = await sup.from('communications').update({ case_id: null, agency_id: null, request_id: null }).eq('id', parseInt(req.params.id)));
  }
  if (error) return res.status(400).json({ error: error.message });

  const tierKey = comm.match_reason?.tier_key;
  if (tierKey && !['thread_reply', 'thread_references', 'manual'].includes(tierKey)) {
    try {
      const { data: crit } = await sup.from('email_matching_criteria').select('rejected_count').eq('tier_key', tierKey).maybeSingle();
      if (crit) await sup.from('email_matching_criteria').update({ rejected_count: (crit.rejected_count || 0) + 1 }).eq('tier_key', tierKey);
    } catch (e) { /* migrations/033 may not have been run yet */ }
  }
  res.json({ success: true });
});

// ---- معايير ربط الإيميلات: self-service control over mailPoller.js's
// matching heuristics, mirroring intake.js's /intake/criteria-definitions
// CRUD pattern exactly. Built-in tiers are pre-seeded by migrations/033 and
// can only be toggled/relabeled (they map to real code paths, not
// admin-invented rules); custom keyword rules are fully admin-managed.

// GET /api/inbox/matching-criteria — list built-in tiers with their
// confirmed/rejected stats, so an admin can see which ones are noisy.
router.get('/inbox/matching-criteria', requireAuth, requirePermission('email_matching', 'manage_criteria'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { data, error } = await sup.from('email_matching_criteria').select('*').order('id', { ascending: true });
    if (error) return res.status(400).json({ error: /does not exist|could not find the table/i.test(error.message) ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (email_matching_criteria)' : error.message });
    res.json({ success: true, data: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/inbox/matching-criteria/:tierKey — toggle on/off, edit label.
router.put('/inbox/matching-criteria/:tierKey', requireAuth, requirePermission('email_matching', 'manage_criteria'), async (req, res) => {
  try {
    const { is_active, label_ar, description } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (is_active !== undefined) updates.is_active = is_active;
    if (label_ar !== undefined) updates.label_ar = label_ar;
    if (description !== undefined) updates.description = description;
    const sup = getSupabase();
    const { error } = await sup.from('email_matching_criteria').update(updates).eq('tier_key', req.params.tierKey);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET/POST/DELETE /api/inbox/matching-keywords — custom global keyword
// rules (the "ضيف معيار فلترة" ask). No PUT -- edited via delete+recreate,
// same as case_agency_channels' own channel rows.
router.get('/inbox/matching-keywords', requireAuth, requirePermission('email_matching', 'manage_criteria'), async (req, res) => {
  try {
    const sup = getSupabase();
    let query = sup.from('email_matching_custom_keywords').select('*, cases(title)').order('created_at', { ascending: false });
    // email_matching:manage_criteria is a separate, independently-grantable
    // permission from cases:view_all -- without this, a role granted only
    // this one permission could see the title of every case in the system
    // just by listing keyword rules, bypassing the case-visibility model
    // canAccessCase/getVisibleCaseIds enforces everywhere else.
    if (!(await canViewAllCases(sup, req.user.role))) {
      const visibleIds = await getVisibleCaseIds(sup, req.user.id);
      if (!visibleIds.length) return res.json({ success: true, data: [] });
      query = query.in('case_id', visibleIds);
    }
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: /does not exist|could not find the table/i.test(error.message) ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (email_matching_custom_keywords)' : error.message });
    res.json({ success: true, data: (data || []).map(r => ({ ...r, case_title: r.cases?.title || null, cases: undefined })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/inbox/matching-keywords', requireAuth, requirePermission('email_matching', 'manage_criteria'), async (req, res) => {
  try {
    const { keyword_phrase, case_id } = req.body;
    if (!keyword_phrase || !keyword_phrase.trim()) return res.status(400).json({ error: 'keyword_phrase مطلوب' });
    if (!case_id) return res.status(400).json({ error: 'case_id مطلوب -- كلمة مفتاحية بلا قضية محددة لن تربط أي شيء' });
    const sup = getSupabase();
    if (!(await canAccessCase(sup, req.user, parseInt(case_id)))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }
    const { data, error } = await sup.from('email_matching_custom_keywords').insert({
      keyword_phrase: keyword_phrase.trim(), case_id: parseInt(case_id), created_by: req.user.id,
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/inbox/matching-keywords/:id', requireAuth, requirePermission('email_matching', 'manage_criteria'), async (req, res) => {
  try {
    const sup = getSupabase();
    const id = parseInt(req.params.id);
    // Unlike POST above (which already checks this before inserting), this
    // route deleted by id with no case lookup at all -- a role with
    // manage_criteria but restricted case visibility could silently disable
    // a rule tied to a case outside their assignment.
    const { data: existing } = await sup.from('email_matching_custom_keywords').select('case_id').eq('id', id).maybeSingle();
    if (existing && !(await canAccessCase(sup, req.user, existing.case_id))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }
    const { error } = await sup.from('email_matching_custom_keywords').delete().eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/communications/:id — a single message's full detail, for
// opening one in a standalone tab (صندوق البريد "فتح في تاب جديد").
router.get('/communications/:id', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { data, error } = await sup.from('communications').select('*').eq('id', parseInt(req.params.id)).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Message not found' });
    // Standalone inbox messages (case_id null) have no case boundary to
    // enforce; a message linked to a case must respect that case's scope.
    if (data.case_id && !(await canAccessCase(sup, req.user, data.case_id))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }
    res.json({ success: true, data: { ...data, metadata: parseMetadata(data.metadata) } });
  } catch (ex) { res.status(500).json({ error: ex.message }); }
});

// DELETE /api/communications/:id — delete a single email (inbound or
// outbound), from the Inbox or the case's Communications tab. Also trashes
// any Drive-stored attachments so deleting the message doesn't leave
// orphaned files behind.
router.delete('/communications/:id', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const commId = parseInt(req.params.id);
    const { data: comm } = await sup.from('communications').select('case_id, metadata, subject').eq('id', commId).maybeSingle();
    if (!comm) return res.status(404).json({ error: 'Message not found' });
    if (comm.case_id && !(await canAccessCase(sup, req.user, comm.case_id))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }

    const meta = parseMetadata(comm.metadata);
    for (const att of meta.attachments || []) {
      if (att.driveFileId) {
        await gdrive.deleteFile(att.driveFileId).catch(e => console.warn('[communications] Drive attachment delete failed:', e.message));
      }
    }

    const { error } = await sup.from('communications').delete().eq('id', commId);
    if (error) throw error;

    try {
      await sup.from('activity_logs').insert({
        user_id: req.user?.id, user_name: req.user?.name,
        action_type: 'communication_deleted', target_type: 'communication', target_id: commId,
        target_title: `🗑️ ${comm.subject || 'رسالة بدون عنوان'}`,
      });
    } catch (e) { console.error('[communications] delete activity log failed:', e.message); }

    res.json({ success: true });
  } catch (ex) {
    res.status(500).json({ error: ex.message });
  }
});

// POST /api/imap/poll — Trigger IMAP polling
router.post('/imap/poll', requireAuth, async (req, res) => {
  try {
    const mailPoller = require('../services/mailPoller');
    const { total, errors } = await mailPoller.pollAll();
    res.json({ success: true, newMessages: total, errors: errors.length ? errors : undefined });
  } catch (ex) { res.json({ success: false, error: ex.message }); }
});

// POST /api/imap/backfill-html — one-time enrichment for emails that
// arrived before body_html existed. Admin-only: re-fetches each account's
// mailbox from before its earliest still-missing message, which can be
// slow (a real IMAP round trip per account, potentially many messages) and
// isn't something to trigger from a regular user action.
router.post('/imap/backfill-html', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const mailPoller = require('../services/mailPoller');
    const results = await mailPoller.backfillHtmlBodies();
    res.json({ success: true, results });
  } catch (ex) { res.status(500).json({ success: false, error: ex.message }); }
});

// POST /api/imap/backfill-attachments — one-time enrichment for attachments
// that arrived before the email was matched/linked to a case (so they were
// never uploaded to Drive, only their name/size recorded). Admin-only, same
// re-fetch-and-let-dedup-backfill-in-place approach as backfill-html above.
router.post('/imap/backfill-attachments', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const mailPoller = require('../services/mailPoller');
    const results = await mailPoller.backfillMissingAttachments();
    res.json({ success: true, results });
  } catch (ex) { res.status(500).json({ success: false, error: ex.message }); }
});

// DIAGNOSTIC — GET /api/imap/raw-fetch/:accountId
// Calls pollAccount directly (no insert) and returns exactly what IMAP
// fetch returned, to compare against what should be there. Only ever
// required requireAuth -- any authenticated user of any role could pull raw
// subject/sender/date data from any mailbox by id, unlike every sibling IMAP
// route (/imap/compare, /imap/fix-credentials both require
// email_accounts:manage).
router.get('/imap/raw-fetch/:accountId', requireAuth, requirePermission('email_accounts', 'manage'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { data: account } = await sup.from('email_accounts').select('*').eq('id', parseInt(req.params.accountId)).single();
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const mailPoller = require('../services/mailPoller');
    const messages = await mailPoller.pollAccount(account);
    res.json({
      success: true,
      count: messages.length,
      messages: messages.map(m => ({ messageId: m.messageId, subject: m.subject, from: m.from, date: m.date, uid: m.uid })),
    });
  } catch (ex) { res.status(500).json({ success: false, error: ex.message }); }
});

// GET /api/inbox/unread-count
router.get('/inbox/unread-count', requireAuth, async (req, res) => {
  const sup = getSupabase();
  try {
    // Was counting is_read=false across BOTH directions -- every outbound
    // (sent) message defaults to is_read=false too (no insert path ever set
    // it), so every email this system ever sent inflated its own "unread"
    // badge. You don't read your own sent mail; only inbound counts.
    //
    // Also was missing the same archive exclusion GET /inbox's own "unread"
    // tab already applies -- an unread message that gets archived without
    // ever being opened (archiving doesn't require reading first) stayed
    // counted in this badge forever, while never appearing under the
    // "غير مقروء" tab itself (excluded there because archived), only under
    // "الأرشيف". Badge and tab permanently disagreed on the same message.
    let { count, error } = await sup.from('communications').select('*', { count: 'exact', head: true })
      .is('is_read', false).eq('direction', 'inbound').not('is_archived', 'is', true);
    if (error && /is_archived/.test(error.message)) {
      ({ count, error } = await sup.from('communications').select('*', { count: 'exact', head: true })
        .is('is_read', false).eq('direction', 'inbound'));
    }
    if (error) return res.json({ unread: 0 });
    res.json({ unread: count || 0 });
  } catch (ex) { res.json({ unread: 0 }); }
});

// composeUpload (multer) throws inside its own middleware layer, BEFORE any
// route handler's try/catch runs -- an oversized file or too many files
// produced Express's default non-JSON error page instead of this app's
// normal {error: "..."} shape. Registered last so it only intercepts errors
// from this router's own middleware/routes.
router.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'حجم الملف أكبر من الحد المسموح (25 ميجابايت)'
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'عدد الملفات أكبر من الحد المسموح'
      : err.message;
    return res.status(400).json({ error: message });
  }
  next(err);
});

module.exports = router;
