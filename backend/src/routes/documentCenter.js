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
const { canViewAllEmailAccounts, getVisibleEmailAccountIds, canAccessEmailAccount } = require('../services/emailAccountAccess');
const { notifyUsers, getCaseRecipients, getCaseActivityRecipients } = require('../services/notificationService');
const { checkLock, getLockingCase } = require('../services/emailAccountLock');
const trash = require('../services/trash');
const { logActivity } = require('../services/activityLogger');
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

// RFC 5322 References header must list EVERY ancestor Message-ID in the
// thread (oldest first), not just the immediate parent -- a References
// header that only ever repeats the last parent is indistinguishable from a
// broken chain to Gmail/Outlook once a thread goes 3+ messages deep, and
// they silently fall back to subject-line grouping (unreliable once a
// subject gets a stray "RE: RE:" or a translated prefix). thread_id already
// groups every message (inbound + outbound) in this conversation, so the
// full chain is just every message_id in that group, oldest first.
async function buildReferencesChain(sup, threadId, fallbackMessageId) {
  if (!threadId) return fallbackMessageId;
  const { data } = await sup.from('communications')
    .select('message_id')
    .eq('thread_id', threadId)
    .not('message_id', 'is', null)
    .order('created_at', { ascending: true });
  const chain = (data || []).map(r => r.message_id).filter(Boolean);
  return chain.length ? chain.join(' ') : fallbackMessageId;
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
  const { data, error } = await sup.from('case_documents').select('*').eq('id', parseInt(req.params.id)).is('deleted_at', null).single();
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
  const { data, error } = await sup.from('case_documents').select('*').eq('case_id', parseInt(req.params.caseId)).is('deleted_at', null).order('created_at', { ascending: false });
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
  // Timeline entry, not case_comments -- a document-registered auto-note
  // isn't real team discussion, it belongs in الخط الزمني.
  logActivity({
    user_id: user.id, user_name: user.name,
    action_type: 'document_registered', target_type: 'document', target_id: parseInt(req.params.caseId),
    target_title: `📄 ${file_name}`,
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
    // Supabase's query builder is a bare thenable (only .then(), no
    // .catch()/.finally()) -- chaining .catch() directly on it throws "not
    // a function" instead of swallowing the error. With no async-error
    // middleware in this app, that throw becomes an unhandled rejection and
    // the response below never gets sent -- the rename (DB update + Drive
    // rename above) had already succeeded, but the request just hangs/times
    // out, showing as a failure for something that actually worked.
    try {
      await sup.from('activity_logs').insert({
        user_id: req.user?.id, user_name: req.user?.name,
        action_type: 'document_renamed', target_type: 'case', target_id: before.case_id,
        target_title: `✏️ ${before.original_name} → ${updates.original_name}`,
      });
    } catch (e) { console.error('[documents] rename activity log failed:', e.message); }
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
  const { error } = await trash.softDelete(sup, { table: 'case_documents', id: parseInt(req.params.id), userId: req.user?.id });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// GET /api/email-accounts — list email accounts
router.get('/email-accounts', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { data, error } = await sup.from('email_accounts').select('*').is('deleted_at', null);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ accounts: data || [] });
});

// GET /api/imap/diagnose/:accountId — production IMAP diagnostic (instrumented)
router.get('/imap/diagnose/:accountId', requireAuth, requirePermission('email_accounts', 'manage'), async (req, res) => {
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
router.get('/imap/connectivity/:accountId', requireAuth, requirePermission('email_accounts', 'manage'), async (req, res) => {
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
// never showed up actually landed in Spam instead). Was requireAuth-only,
// unlike its siblings /imap/compare and /imap/fix-credentials -- meant any
// authenticated employee, regardless of case assignment, could read real
// subject/sender lines from ANY account's Spam/All Mail folders, including
// mail tied to cases they have no access to.
router.get('/imap/folders/:accountId', requireAuth, requirePermission('email_accounts', 'manage'), async (req, res) => {
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
    const { to, cc, bcc, subject, body, html, account_id, agency_id, request_id: requestIdRaw, reply_to_id, expected_response_days } = req.body;
    if (!to || !subject || !account_id) return res.status(400).json({ error: 'to, subject, account_id مطلوبون' });

    const { data: account } = await sup.from('email_accounts').select('email').eq('id', parseInt(account_id)).single();
    if (!account) return res.status(404).json({ error: 'Email account not found' });
    // Sending as a mailbox needs access to THAT mailbox (email.js's own send route
    // already enforces this; the compose routes here did not).
    if (!(await canAccessEmailAccount(sup, req.user, account_id))) {
      return res.status(403).json({ error: 'Forbidden — لا تملك صلاحية استخدام هذا الحساب' });
    }
    const request_id = await ownedRequestId(sup, requestIdRaw, caseId);

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
      const { data: original } = await sup.from('communications').select('message_id, thread_id, case_id').eq('id', parseInt(reply_to_id)).is('deleted_at', null).maybeSingle();
      if (original && (!original.case_id || original.case_id === caseId)) {
        inReplyTo = original.message_id;
        threadId = original.thread_id || original.message_id;
        references = await buildReferencesChain(sup, threadId, original.message_id);
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

    // html was never wired here (unlike email.js's own /send route) --
    // sendEmail has always fully supported it; needed for a FileFetch link's
    // styled button (and any other rich-formatted email sent through either
    // compose path).
    const emailService = require('../services/emailService');
    const info = await emailService.sendEmail(parseInt(account_id), { to, cc, bcc, subject, text: body, html, inReplyTo, references, attachments: mailAttachments });

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
      subject, body: body || '', body_html: html || null, sender: account.email, recipient: to,
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

    // The lock check above and this insert straddle a real SMTP send (real
    // network time, not just a couple of DB round-trips) -- two people
    // composing to the same agency from the same account for two DIFFERENT
    // cases at nearly the same moment could both pass the check before
    // either's row lands, silently defeating the one-account-per-agency-
    // per-case invariant this lock exists for (a later inbound reply from
    // that agency would then have two candidate cases to file under instead
    // of one). Can't undo an email that's already sent, and this SAME
    // request's own send/insert already succeeded either way -- but re-
    // checking now means the rare collision becomes a visible admin alert
    // instead of a silent, hard-to-diagnose routing ambiguity later.
    if (agency_id) {
      try {
        const raceCheck = await getLockingCase(sup, parseInt(account_id), parseInt(agency_id), caseId);
        if (raceCheck) {
          const { data: admins } = await sup.from('users').select('id').eq('role', 'admin');
          await notifyUsers(sup, (admins || []).map(a => a.id), {
            type: 'email_lock_race_detected',
            title: '⚠️ تعارض في استخدام حساب بريد لنفس الجهة',
            body: `حساب "${account.email}" استُخدم لمراسلة نفس الجهة في القضية #${caseId} والقضية "${raceCheck.title || '#' + raceCheck.id}" في وقت متقارب جدًا -- ردود هذه الجهة لاحقًا قد لا تُصنّف تلقائيًا لقضية واحدة بدقة.`,
            target_type: 'case', target_id: caseId,
          });
        }
      } catch (raceErr) { console.error('[compose] lock race re-check failed:', raceErr.message); }
    }

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
    const { agency_id, request_id: requestIdRaw, note, expected_response_days, confirmation_number } = req.body;
    if (!agency_id) return res.status(400).json({ error: 'agency_id مطلوب' });
    const request_id = await ownedRequestId(sup, requestIdRaw, caseId);

    const { data: agency } = await sup.from('agencies').select('name_ar, name_en, portal_url').eq('id', parseInt(agency_id)).maybeSingle();

    let targetRequestId = request_id ? parseInt(request_id) : null;
    if (!targetRequestId) {
      const { data: req_ } = await sup.from('requests').select('id')
        .eq('case_id', caseId).eq('agency_id', parseInt(agency_id))
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      targetRequestId = req_?.id || null;
    }

    const subject = confirmation_number ? `تقديم عبر البوابة — رقم التأكيد: ${confirmation_number}` : 'تقديم عبر البوابة';
    const { error: portalErr } = await sup.from('communications').insert({
      case_id: caseId, request_id: targetRequestId, agency_id: parseInt(agency_id),
      type: 'portal', direction: 'outbound',
      subject, body: note || '',
      sender: req.user?.name || 'النظام', recipient: agency?.portal_url || agency?.name_en || '',
      created_at: new Date().toISOString(),
    });
    if (portalErr) return res.status(500).json({ error: portalErr.message });

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

// Can `user` open / act on this ONE message? The inbox LIST already applies both
// scopes (case visibility + assigned mailboxes); every single-message route used
// to check only the case, so a mailbox-restricted employee could read, archive,
// link, delete or pull attachments from another mailbox's mail just by id.
// Same rules as the list: an account the user isn't assigned to is off-limits
// even for their own cases; their OWN mailbox stays accessible even when the
// message is linked to a case they can't see.
async function canAccessComm(sup, user, comm) {
  const [viewAllCases, viewAllAccounts] = await Promise.all([
    canViewAllCases(sup, user.role), canViewAllEmailAccounts(sup, user.role),
  ]);
  if (viewAllCases && viewAllAccounts) return true;
  if (!viewAllAccounts) {
    const ids = await getVisibleEmailAccountIds(sup, user.id);
    if (comm.email_account_id != null && !ids.includes(comm.email_account_id)) return false;
    if (!viewAllCases && comm.email_account_id != null) return true;
  }
  if (viewAllCases) return true;
  return !comm.case_id || (await canAccessCase(sup, user, comm.case_id));
}

// Loads a live message and enforces canAccessComm; on failure it has ALREADY
// answered (404 / 403) and returns null.
async function loadCommForAccess(sup, user, id, res, extraFields = '') {
  const commId = parseInt(id);
  if (!Number.isInteger(commId)) { res.status(400).json({ error: 'معرّف غير صالح' }); return null; }
  const { data: comm } = await sup.from('communications')
    .select('id, case_id, email_account_id, deleted_at' + (extraFields ? ', ' + extraFields : ''))
    .eq('id', commId).maybeSingle();
  if (!comm || comm.deleted_at) { res.status(404).json({ error: 'Message not found' }); return null; }
  if (!(await canAccessComm(sup, user, comm))) { res.status(403).json({ error: 'Forbidden — لا تملك صلاحية هذه الرسالة' }); return null; }
  return comm;
}

// A request_id coming from the client must belong to THIS case, otherwise one
// case's compose/portal-log could overwrite deadlines on another case's request.
async function ownedRequestId(sup, rawRequestId, caseId) {
  const rid = parseInt(rawRequestId);
  if (!Number.isInteger(rid)) return null;
  const { data } = await sup.from('requests').select('id').eq('id', rid).eq('case_id', caseId).is('deleted_at', null).maybeSingle();
  return data ? data.id : null;
}

// GET /api/communications/:id/attachments/:index/download — signed URL for an attachment
router.get('/communications/:id/attachments/:index/download', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const comm = await loadCommForAccess(sup, req.user, req.params.id, res, 'metadata');
    if (!comm) return;
    const attachments = parseMetadata(comm.metadata).attachments || [];
    const att = attachments[parseInt(req.params.index)];
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    if (att.driveFileId) {
      const { downloadUrl, viewUrl } = await gdrive.getFileLinks(att.driveFileId);
      return res.json({ success: true, url: downloadUrl || viewUrl || att.viewUrl, filename: att.filename });
    }
    if (!att.storageKey) return res.status(404).json({ error: 'Attachment not found' });
    // A storage key must live under THIS message's own case folder -- never sign
    // an arbitrary bucket/path taken from stored metadata.
    if (comm.case_id == null || !String(att.storageKey).startsWith(`case-documents/case_${comm.case_id}/`)) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
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
    const comm = await loadCommForAccess(sup, req.user, commId, res, 'metadata');
    if (!comm) return;
    const meta = parseMetadata(comm.metadata);
    const attachments = meta.attachments || [];
    const att = attachments[index];
    if (!att) return res.status(404).json({ error: 'Attachment not found' });

    if (att.driveFileId) await gdrive.deleteFile(att.driveFileId).catch(e => console.warn('Drive delete failed:', e.message));
    else if (att.storageKey && comm.case_id != null && String(att.storageKey).startsWith(`case-documents/case_${comm.case_id}/`)) await storage.deleteByKey(att.storageKey).catch(e => console.warn('Storage delete failed:', e.message));

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
    const { status, account_id, direction, date_from, date_to, search } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    // Resolve free-text search to a set of matching ids via 3 separate
    // single-column ilike queries instead of a hand-rolled
    // .or("subject.ilike.%x%,sender.ilike.%x%,...") string -- PostgREST
    // parses that string's own commas/parens as ITS filter-grammar syntax,
    // so a search term that happens to contain either (a sender "Smith,
    // John", a subject with "(Re:)") broke the ENTIRE query with a 500
    // instead of just not matching. A plain .ilike() call passes the value
    // as a normal parameter -- nothing hand-rolled, nothing to break.
    let searchIds = null;
    // id -> relevance score, used to sort search results best-match-first
    // instead of the flat created_at-only ordering every other tab uses.
    let searchRelevance = null;
    if (search) {
      const term = search.trim();
      const termLower = term.toLowerCase();
      // `recipient` was never searched before -- a full email address that
      // only ever appears as the recipient (the "To:" side, e.g. searching
      // your OWN account's address, or who an outbound message was sent to)
      // matched nothing at all, guaranteed zero results every time no matter
      // how exact the search was.
      // Capped per source (a well-used org mailbox address can otherwise
      // match a huge fraction of the whole table as sender+recipient
      // combined) -- an uncapped id list here builds a `.in(id, [...])`
      // filter long enough to exceed nginx's own request-URI size limit,
      // turning a broad-but-valid search into a hard 500 instead of just a
      // large result set. Ordered newest-first before the cap so a
      // truncation drops the OLDEST candidate matches, not an arbitrary mix.
      const [bySubject, bySender, byRecipient, byBody] = await Promise.all([
        sup.from('communications').select('id, subject, sender, recipient').ilike('subject', `%${term}%`).is('deleted_at', null).order('created_at', { ascending: false }).limit(300),
        sup.from('communications').select('id, subject, sender, recipient').ilike('sender', `%${term}%`).is('deleted_at', null).order('created_at', { ascending: false }).limit(300),
        sup.from('communications').select('id, subject, sender, recipient').ilike('recipient', `%${term}%`).is('deleted_at', null).order('created_at', { ascending: false }).limit(300),
        sup.from('communications').select('id').ilike('body', `%${term}%`).is('deleted_at', null).order('created_at', { ascending: false }).limit(300),
      ]);
      const rowById = new Map();
      [...(bySubject.data || []), ...(bySender.data || []), ...(byRecipient.data || [])].forEach(r => rowById.set(r.id, r));
      const bodyMatchIds = new Set((byBody.data || []).map(r => r.id));
      searchIds = new Set([...rowById.keys(), ...bodyMatchIds]);
      // Email number -- an exact lookup (`.eq`, indexed, no scale limit),
      // not the fetch-every-id-and-substring-match approach cases.js uses
      // for case numbers. communications already has 1200+ rows and grows
      // constantly from live mail ingestion; an unbounded `.select('id')`
      // silently truncates at PostgREST's default 1000-row cap, so anything
      // past that row would never match no matter what was typed -- confirmed
      // live (1219 rows, only 1000 returned). cases.js's identical pattern
      // hasn't hit this yet (181 rows) but has the same latent ceiling.
      if (/^\d+$/.test(term)) searchIds.add(parseInt(term));

      // Relevance score per matched id: an exact field match ranks above a
      // "starts with" match, which ranks above a plain "contains" substring
      // -- across subject/sender/recipient, taking whichever field scored
      // this row highest. A hit that only came from the body (or the bare
      // numeric-id fallback) has no field text to score, so it sits below
      // every real field match, then falls back to recency like before.
      searchRelevance = new Map();
      for (const id of searchIds) {
        const row = rowById.get(id);
        let score = 0;
        for (const field of ['subject', 'sender', 'recipient']) {
          const v = (row?.[field] || '').toLowerCase();
          if (!v) continue;
          if (v === termLower) score = Math.max(score, 100);
          else if (v.startsWith(termLower)) score = Math.max(score, 70);
          else if (v.includes(termLower)) score = Math.max(score, 40);
        }
        if (score === 0 && bodyMatchIds.has(id)) score = 10;
        searchRelevance.set(id, score);
      }

      // Guard against PostgREST's own silent row cap (see the comment above
      // on the numeric-id lookup -- confirmed live at 1219 rows / only 1000
      // returned on this same table). The combined candidate set here can
      // reach ~1200 ids for a broad term (up to 900 unique across
      // subject+sender+recipient, plus up to 300 more body-only ids) on this
      // fast-growing table -- a `.in(id, [...])` filter with more candidates
      // than that cap can come back silently truncated below, which would
      // then make `count` (set from the truncated result) quietly wrong too.
      // Rank every candidate by the same relevance score used for final
      // sorting BEFORE capping, so if a cut is unavoidable it drops the
      // least-relevant candidates first, not an arbitrary recency-based mix.
      const SEARCH_CANDIDATE_CAP = 900;
      if (searchIds.size > SEARCH_CANDIDATE_CAP) {
        const ranked = [...searchIds].sort((a, b) => (searchRelevance.get(b) || 0) - (searchRelevance.get(a) || 0));
        searchIds = new Set(ranked.slice(0, SEARCH_CANDIDATE_CAP));
      }
    }

    // Case-visibility scope: a role restricted to its own assigned cases
    // (cases.view_all = false) should only see inbox messages that are
    // either still unlinked (case_id null -- anyone doing triage needs to
    // see and link these) or linked to a case they can actually access.
    // Previously ANY authenticated user could read the full content
    // (subject/sender/body) of ANY other case's real government/police
    // correspondence just by opening صندوق البريد, regardless of their own
    // case assignments -- the one boundary every other case-scoped route in
    // this codebase already enforces.
    const viewAllCases = await canViewAllCases(sup, req.user.role);
    const visibleCaseIds = viewAllCases ? null : await getVisibleCaseIds(sup, req.user.id);

    // Mailbox-visibility scope: same idea, one layer down -- a role
    // restricted to specific mailboxes (email_accounts.view_all = false)
    // should only see messages through an account it's been explicitly
    // assigned (services/emailAccountAccess.js), or messages with no
    // account at all. Many communications rows are never tied to any
    // account in the first place (phone/mail logs, portal submissions, the
    // /email/receive simulate route all insert with email_account_id left
    // null) -- those must stay visible to everyone regardless of mailbox
    // assignment, same as an unlinked case_id stays visible above.
    const viewAllAccounts = await canViewAllEmailAccounts(sup, req.user.role);
    const visibleAccountIds = viewAllAccounts ? null : await getVisibleEmailAccountIds(sup, req.user.id);

    // migrations/012 (is_archived/reviewed_by) may not have been run yet in
    // this environment -- build the query with archive support, but if it
    // fails specifically because that column doesn't exist, retry once
    // without it rather than hard-failing the entire inbox (every tab, not
    // just أرشيف) until the migration lands.
    const buildQuery = (withArchiveSupport) => {
      let q = sup.from('communications').select('*', { count: 'exact' }).is('deleted_at', null).order('created_at', { ascending: false });
      // When search is active, relevance (computed above) decides the order,
      // not created_at -- so pagination has to happen AFTER that sort, in
      // JS, rather than as a DB-side .range() here (searchIds already
      // bounds this to a small result set, not the whole table).
      if (!search) q = q.range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
      if (!viewAllCases && !viewAllAccounts && visibleAccountIds.length) {
        // Both scopes restricted at once AND the user has at least one
        // assigned mailbox -- a message through THEIR OWN assigned account
        // must stay visible no matter which case (if any) it's linked to.
        // Confirmed live: a brand-new employee assigned exactly one mailbox
        // still couldn't see a message sitting in that very mailbox, because
        // it happened to already be linked to an unrelated case they weren't
        // assigned to -- the case AND account filters were being ANDed
        // together below, so either restriction alone could hide a message.
        // Managing a mailbox means seeing everything that lands in it, even
        // something mistakenly linked to a case they don't have access to.
        // Only a message with NO account at all still falls back to the
        // plain case-visibility rule (the original "still needs triage"
        // reasoning in the `else` branch below) -- and a message through
        // some OTHER account they're NOT assigned to stays hidden even if
        // it's tied to one of their own cases, since account privacy isn't
        // overridden by case access, only the reverse.
        const caseOr = visibleCaseIds.length
          ? `or(case_id.is.null,case_id.in.(${visibleCaseIds.join(',')}))`
          : 'case_id.is.null';
        q = q.or(`email_account_id.in.(${visibleAccountIds.join(',')}),and(email_account_id.is.null,${caseOr})`);
      } else {
        if (!viewAllCases) {
          q = visibleCaseIds.length ? q.or(`case_id.is.null,case_id.in.(${visibleCaseIds.join(',')})`) : q.is('case_id', null);
        }
        if (!viewAllAccounts) {
          q = visibleAccountIds.length ? q.or(`email_account_id.is.null,email_account_id.in.(${visibleAccountIds.join(',')})`) : q.is('email_account_id', null);
        }
      }
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

    // Best-match-first when searching (closest/most exact hits before
    // looser ones, ties broken by recency), then paginate the now-sorted
    // full result set manually -- the DB-side .range() above was skipped
    // for exactly this case.
    if (search && messages) {
      messages = [...messages].sort((a, b) => {
        const sa = searchRelevance.get(a.id) || 0, sb = searchRelevance.get(b.id) || 0;
        if (sb !== sa) return sb - sa;
        return new Date(b.created_at) - new Date(a.created_at);
      });
      count = messages.length;
      messages = messages.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    }

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

// GET /api/communications/thread/:threadId — every message sharing this
// thread_id (chronological), so opening any one message from صندوق البريد or
// a case's الاتصالات tab can show the whole back-and-forth (sent + received)
// together, like Gmail/Outlook's conversation view -- not just the single
// row that was clicked. Same case-visibility scope as GET /inbox: a message
// still unlinked (case_id null) stays visible to anyone, but a message
// linked to a case the requester can't access is dropped from the result --
// otherwise a thread spanning two different cases (possible via
// PUT /inbox/:id/link re-tagging one message's case_id) could surface a
// case-B message's full content to someone opening a case-A message they
// DO have access to, bypassing the very check GET /communications/:id
// enforces for that same message read individually.
router.get('/communications/thread/:threadId', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { data, error } = await sup.from('communications').select('*')
      .eq('thread_id', req.params.threadId).is('deleted_at', null)
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    const viewAllCases = await canViewAllCases(sup, req.user.role);
    let rows = data || [];
    if (!viewAllCases) {
      const visibleCaseIds = new Set(await getVisibleCaseIds(sup, req.user.id));
      rows = rows.filter(m => !m.case_id || visibleCaseIds.has(m.case_id));
    }
    // ...and the mailbox scope: a thread can span mailboxes the user isn't assigned to.
    const accessibleRows = [];
    for (const m of rows) { if (await canAccessComm(sup, req.user, m)) accessibleRows.push(m); }
    rows = accessibleRows;

    const parsed = rows.map(m => {
      let metadata = {};
      if (m.metadata) {
        if (typeof m.metadata !== 'string') metadata = m.metadata;
        else { try { metadata = JSON.parse(m.metadata); } catch { metadata = {}; } }
      }
      return { ...m, metadata };
    });
    res.json({ success: true, data: parsed });
  } catch (ex) { res.status(500).json({ error: ex.message }); }
});

// POST /api/inbox/compose — send a standalone email from صندوق البريد, not
// tied to any case. The only compose path before this was /cases/:caseId/compose,
// which hard-requires a case; general correspondence unrelated to any
// investigation had nowhere to go through this system's own accounts.
router.post('/inbox/compose', requireAuth, composeUpload.array('attachments', 10), async (req, res) => {
  try {
    const { account_id, to, cc, bcc, subject, body, html, case_id, reply_to_id } = req.body;
    if (!account_id || !to || !subject) return res.status(400).json({ error: 'account_id, to, subject مطلوبون' });

    const sup = getSupabase();
    const { data: account } = await sup.from('email_accounts').select('email').eq('id', parseInt(account_id)).maybeSingle();
    if (!account) return res.status(404).json({ error: 'Email account not found' });
    if (!(await canAccessEmailAccount(sup, req.user, account_id))) {
      return res.status(403).json({ error: 'Forbidden — لا تملك صلاحية استخدام هذا الحساب' });
    }

    // Replying/forwarding from the standalone message tab: thread against
    // the original so both our own matching (thread_id) and the
    // recipient's mail client (In-Reply-To/References) group it into the
    // same conversation, and keep the same case link if the original had one.
    let inReplyTo, references, threadId, linkedCaseId = case_id ? parseInt(case_id) : null, linkedAgencyId = null;
    if (reply_to_id) {
      const { data: original } = await sup.from('communications').select('message_id, thread_id, case_id, agency_id, email_account_id, deleted_at').eq('id', parseInt(reply_to_id)).maybeSingle();
      if (original && !original.deleted_at && (await canAccessComm(sup, req.user, original))) {
        inReplyTo = original.message_id;
        threadId = original.thread_id || original.message_id;
        references = await buildReferencesChain(sup, threadId, original.message_id);
        if (!linkedCaseId) linkedCaseId = original.case_id || null;
        // Only inherit the agency when the reply stays on the SAME case.
        linkedAgencyId = (!case_id || original.case_id === parseInt(case_id)) ? (original.agency_id || null) : null;
      }
    }
    // Same class of gap the earlier case-scoping audit fixed on every other
    // compose/link route -- an unchecked case_id here (whether passed
    // directly or inherited from a replied-to message) would let a
    // restricted-role user fabricate a communications row on any case.
    if (linkedCaseId && !(await canAccessCase(sup, req.user, linkedCaseId))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }

    // /cases/:id/compose enforces the same-account-same-agency-one-case
    // lock (emailAccountLock.js); this second, less obvious send path never
    // did -- sending straight from صندوق البريد's own composer with a
    // case_id/reply_to_id could freely reuse a locked account+agency pair
    // for a different case, bypassing the check entirely rather than just
    // racing it.
    if (linkedCaseId && linkedAgencyId) {
      const lockCheck = await checkLock(sup, parseInt(account_id), linkedAgencyId, linkedCaseId);
      if (lockCheck.locked) {
        return res.status(409).json({
          error: `هذا الحساب مستخدم بالفعل لمراسلة هذه الجهة في قضية "${lockCheck.lockedByCase?.title || '#' + lockCheck.lockedByCase?.id}" — اختر حسابًا آخر، أو اطلب فك القيد من صاحب الصلاحية.`,
        });
      }
    }

    // Attached straight to the outgoing email only -- there's no case here
    // to file a Drive copy under (unlike /cases/:id/compose), so just the
    // filename/size get recorded for display, not the bytes themselves.
    const mailAttachments = (req.files || []).map(f => ({ filename: f.originalname, content: f.buffer, contentType: f.mimetype }));
    const storedAttachments = (req.files || []).map(f => ({ filename: f.originalname, size: f.size, mimeType: f.mimetype }));

    // html was never wired here (unlike email.js's own /send route) --
    // sendEmail has always fully supported it; needed for a FileFetch link's
    // styled button (and any other rich-formatted email sent through either
    // compose path).
    const emailService = require('../services/emailService');
    const info = await emailService.sendEmail(parseInt(account_id), { to, cc, bcc, subject, text: body, html, inReplyTo, references, attachments: mailAttachments });

    const { data, error } = await sup.from('communications').insert({
      type: 'email', direction: 'outbound',
      subject, body: body || '', body_html: html || null, sender: account.email, recipient: to,
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

    // Same race-visibility safety net as /cases/:id/compose -- the lock
    // check above and this insert straddle a real SMTP send, so a
    // near-simultaneous send elsewhere for the same account+agency+a
    // different case could still slip through; can't undo an email that's
    // already sent, but this at least surfaces the collision to admins
    // instead of it silently corrupting future reply-routing.
    if (linkedCaseId && linkedAgencyId) {
      try {
        const raceCheck = await getLockingCase(sup, parseInt(account_id), linkedAgencyId, linkedCaseId);
        if (raceCheck) {
          const { data: admins } = await sup.from('users').select('id').eq('role', 'admin');
          await notifyUsers(sup, (admins || []).map(a => a.id), {
            type: 'email_lock_race_detected',
            title: '⚠️ تعارض في استخدام حساب بريد لنفس الجهة',
            body: `حساب "${account.email}" استُخدم لمراسلة نفس الجهة في القضية #${linkedCaseId} والقضية "${raceCheck.title || '#' + raceCheck.id}" في وقت متقارب جدًا -- ردود هذه الجهة لاحقًا قد لا تُصنّف تلقائيًا لقضية واحدة بدقة.`,
            target_type: 'case', target_id: linkedCaseId,
          });
        }
      } catch (raceErr) { console.error('[inbox/compose] lock race re-check failed:', raceErr.message); }
    }

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
    const existing = await loadCommForAccess(sup, req.user, req.params.id, res, 'metadata, subject, sender');
    if (!existing) return;
    if (case_id) {
      const { data: targetCase } = await sup.from('cases').select('id').eq('id', parseInt(case_id)).is('deleted_at', null).maybeSingle();
      if (!targetCase) return res.status(404).json({ error: 'Case not found' });
      // Re-linking to a DIFFERENT case: the old request_id belongs to the old
      // case and would make the classifier act on the wrong case's request.
      if (existing.case_id !== parseInt(case_id)) updates.request_id = null;
    }
    {
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
  const comm = await loadCommForAccess(sup, req.user, req.params.id, res);
  if (!comm) return;
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
  const comm = await loadCommForAccess(sup, req.user, req.params.id, res);
  if (!comm) return;
  const { error } = await sup.from('communications').update({ is_archived: true, archived_at: new Date().toISOString() }).eq('id', parseInt(req.params.id));
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// PUT /api/inbox/:id/unarchive -- restore a message back to the main inbox.
router.put('/inbox/:id/unarchive', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const comm = await loadCommForAccess(sup, req.user, req.params.id, res);
  if (!comm) return;
  const { error } = await sup.from('communications').update({ is_archived: false, archived_at: null }).eq('id', parseInt(req.params.id));
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// PUT /api/inbox/:id/review -- "تم الفحص": records which employee reviewed
// this message. Distinct from is_read (which just means "opened") -- a
// message can be opened without anyone having actually verified its content.
router.put('/inbox/:id/review', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const comm = await loadCommForAccess(sup, req.user, req.params.id, res);
  if (!comm) return;
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
  const comm = await loadCommForAccess(sup, req.user, req.params.id, res);
  if (!comm) return;
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
  const comm = await loadCommForAccess(sup, req.user, req.params.id, res, 'match_reason');
  if (!comm) return;
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
    // Same guard as case_agency_channels' own POST -- a generic portal label
    // ("Request Number" etc.) instead of the actual unique code silently
    // mass-links every automated confirmation email system-wide to this one
    // case (confirmed live on case 785, see isGenericFilterPhrase's comment).
    const { isGenericFilterPhrase } = require('../services/mailPoller');
    if (isGenericFilterPhrase(keyword_phrase)) {
      return res.status(400).json({ error: `"${keyword_phrase.trim()}" عبارة عامة جدًا وموجودة في رسائل تأكيد أي بوابة تقريبًا -- استخدم الكود/الرقم الفعلي المميز فقط، مش تسمية الحقل` });
    }
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
    const { data, error } = await sup.from('communications').select('*').eq('id', parseInt(req.params.id)).is('deleted_at', null).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Message not found' });
    // Standalone inbox messages (case_id null) have no case boundary to
    // enforce; a message linked to a case must respect that case's scope.
    if (!(await canAccessComm(sup, req.user, data))) {
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
    const comm = await loadCommForAccess(sup, req.user, commId, res, 'metadata, subject');
    if (!comm) return;

    // Soft delete only -- attachment bytes stay on Drive until this is
    // permanently deleted from سلة المحذوفات (see trash.js's communications
    // special-case), so an accidental click here is fully reversible.
    const { error } = await trash.softDelete(sup, { table: 'communications', id: commId, userId: req.user?.id });
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
router.post('/imap/poll', requireAuth, requirePermission('email_accounts', 'manage'), async (req, res) => {
  try {
    const mailPoller = require('../services/mailPoller');
    const { total, errors, warnings } = await mailPoller.pollAll();
    res.json({ success: true, newMessages: total, errors: errors.length ? errors : undefined, warnings: warnings?.length ? warnings : undefined });
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
    // Same case-visibility scope as GET /inbox itself -- otherwise a
    // restricted role's badge count included messages linked to cases they
    // can't even open, disagreeing with what their own inbox list shows.
    const viewAllCases = await canViewAllCases(sup, req.user.role);
    const visibleCaseIds = viewAllCases ? null : await getVisibleCaseIds(sup, req.user.id);
    // Same mailbox-visibility scope as GET /inbox itself (see the long
    // comment there) -- otherwise a mailbox-restricted employee's badge
    // count would include messages from accounts their own inbox list hides.
    const viewAllAccounts = await canViewAllEmailAccounts(sup, req.user.role);
    const visibleAccountIds = viewAllAccounts ? null : await getVisibleEmailAccountIds(sup, req.user.id);
    // Same combined-scope override as GET /inbox's own buildQuery (see its
    // long comment) -- a message through the employee's OWN assigned
    // mailbox must count as visible/unread regardless of case link, or this
    // badge undercounts relative to what their own inbox list now shows.
    const applyVisibility = (q) => {
      if (!viewAllCases && !viewAllAccounts && visibleAccountIds.length) {
        const caseOr = visibleCaseIds.length
          ? `or(case_id.is.null,case_id.in.(${visibleCaseIds.join(',')}))`
          : 'case_id.is.null';
        return q.or(`email_account_id.in.(${visibleAccountIds.join(',')}),and(email_account_id.is.null,${caseOr})`);
      }
      if (!viewAllCases) q = visibleCaseIds.length ? q.or(`case_id.is.null,case_id.in.(${visibleCaseIds.join(',')})`) : q.is('case_id', null);
      if (!viewAllAccounts) q = visibleAccountIds.length ? q.or(`email_account_id.is.null,email_account_id.in.(${visibleAccountIds.join(',')})`) : q.is('email_account_id', null);
      return q;
    };

    let { count, error } = await applyVisibility(sup.from('communications').select('*', { count: 'exact', head: true })
      .is('is_read', false).eq('direction', 'inbound').not('is_archived', 'is', true).is('deleted_at', null));
    if (error && /is_archived/.test(error.message)) {
      ({ count, error } = await applyVisibility(sup.from('communications').select('*', { count: 'exact', head: true })
        .is('is_read', false).eq('direction', 'inbound').is('deleted_at', null)));
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
