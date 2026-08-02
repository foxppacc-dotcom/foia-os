const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const gdrive = require('../services/googleDriveService');

// GET /api/gdrive/status — is real Drive integration configured + connected?
router.get('/gdrive/status', requireAuth, async (req, res) => {
  const connected = await gdrive.isConnected();
  const email = connected ? await gdrive.getConnectedEmail() : null;
  res.json({ configured: gdrive.configured, connected, email });
});

// GET /api/gdrive/auth-url — build the Google consent screen URL (admin only, one-time setup)
router.get('/gdrive/auth-url', requireAuth, requireRole('admin'), (req, res) => {
  if (!gdrive.configured) return res.status(503).json({ error: 'Google Drive غير معد بعد — أضف GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI/DRIVE_ROOT_FOLDER في متغيرات البيئة أولاً' });
  const auth = gdrive.newOAuthClient();
  const url = auth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token even on re-connect
    scope: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/userinfo.email'],
  });
  res.json({ url });
});

// GET /api/gdrive/oauth-callback — Google redirects the browser here after consent.
// Mounted directly on `app` in index.js, BEFORE the per-feature routers (not
// registered as a router.get(...) here) — several of those routers
// (cases.js, communications.js, etc.) call `router.use(requireAuth)` with no
// path, which — since every router is mounted at the same '/api' prefix —
// intercepts ANY /api/* request that reaches it first, even paths that
// router doesn't itself define. Google's redirect can never carry our Bearer
// token, so this route must resolve before it hits one of those routers.
async function oauthCallbackHandler(req, res) {
  const frontendBase = process.env.FRONTEND_URL || 'https://frontend-five-nu-wgj97r88rl.vercel.app';
  try {
    const { code, error: oauthError } = req.query;
    if (oauthError) throw new Error(oauthError);
    if (!code) throw new Error('missing code');

    const auth = gdrive.newOAuthClient();
    const { tokens } = await auth.getToken(code);
    if (!tokens.refresh_token) throw new Error('Google لم يرسل refresh_token — جرب قطع الاتصال من إعدادات حسابك في Google ثم إعادة الربط');

    auth.setCredentials(tokens);
    const { google } = require('googleapis');
    let email = '';
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth });
      const { data } = await oauth2.userinfo.get();
      email = data.email || '';
    } catch { /* email is cosmetic only */ }

    await gdrive.saveConnection(tokens.refresh_token, email);

    // One-time setup: make the root folder "anyone with the link can view"
    // so files/subfolders created inside it (every case folder, always
    // nested under this root) inherit viewable access automatically instead
    // of being private to only the connected Google account. Non-fatal --
    // the connection itself should still succeed even if this fails.
    if (process.env.GOOGLE_DRIVE_ROOT_FOLDER) {
      gdrive.shareAnyoneWithLink(process.env.GOOGLE_DRIVE_ROOT_FOLDER).catch(e => console.error('[gdrive] root folder sharing failed:', e.message));
    }

    res.redirect(`${frontendBase}/gdrive?gdrive=success`);
  } catch (err) {
    res.redirect(`${frontendBase}/gdrive?gdrive=error&msg=${encodeURIComponent(err.message)}`);
  }
}
router.get('/gdrive/oauth-callback', oauthCallbackHandler);

// POST /api/gdrive/disconnect — remove the stored connection (admin only)
router.post('/gdrive/disconnect', requireAuth, requireRole('admin'), async (req, res) => {
  await gdrive.clearConnection();
  res.json({ success: true });
});

// POST /api/gdrive/share-root — one-time (idempotent) setup: makes the root
// Drive folder "anyone with the link can view" so every case folder nested
// under it inherits viewable access, instead of being private to only the
// connected Google account. Runs automatically on a fresh OAuth connect;
// this exists to fix it for a connection made before that existed, and is
// safe to re-run any time.
router.post('/gdrive/share-root', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!process.env.GOOGLE_DRIVE_ROOT_FOLDER) return res.status(503).json({ error: 'GOOGLE_DRIVE_ROOT_FOLDER غير معد' });
    const already = await gdrive.isSharedWithAnyone(process.env.GOOGLE_DRIVE_ROOT_FOLDER);
    if (!already) await gdrive.shareAnyoneWithLink(process.env.GOOGLE_DRIVE_ROOT_FOLDER);
    res.json({ success: true, alreadyShared: already });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gdrive/migrate-legacy — one-time (idempotent, safe to re-run)
// migration of case_documents rows still backed by Supabase Storage over to
// Google Drive, now that Drive is the primary storage backend. Runs here
// (not as a local script) because it needs the Vercel-only Drive env vars.
router.post('/gdrive/migrate-legacy', requireAuth, requireRole('admin'), async (req, res) => {
  const storage = require('../services/storage');
  const caseFileStorage = require('../services/caseFileStorage');
  if (!(await gdrive.isConnected())) return res.status(503).json({ error: 'Google Drive غير متصل' });

  const { data: rows, error } = await getSupabase().from('case_documents')
    .select('id, case_id, original_name, mime_type, storage_key')
    .neq('storage_provider', 'google_drive')
    .not('storage_key', 'is', null);
  if (error) return res.status(500).json({ error: error.message });

  const results = [];
  for (const row of rows || []) {
    try {
      const sup = getSupabase();
      const [bucket, ...pathParts] = row.storage_key.split('/');
      const { data: blob, error: dlErr } = await sup.storage.from(bucket).download(pathParts.join('/'));
      if (dlErr) throw dlErr;
      const buffer = Buffer.from(await blob.arrayBuffer());

      const driveFields = await caseFileStorage.saveCaseFile({
        caseId: row.case_id, buffer, fileName: row.original_name, mimeType: row.mime_type, category: 'attachments',
      });
      await sup.from('case_documents').update({ ...driveFields, url: driveFields.file_path }).eq('id', row.id);
      await storage.deleteByKey(row.storage_key).catch(() => {});
      results.push({ id: row.id, original_name: row.original_name, success: true });
    } catch (e) {
      results.push({ id: row.id, original_name: row.original_name, success: false, error: e.message });
    }
  }
  res.json({ success: true, migrated: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length, results });
});

const CATEGORY_SUBFOLDER = { attachments: 'Attachments', incoming: 'Incoming', outgoing: 'Outgoing' };

// POST /api/gdrive/upload-session — open a Drive resumable-upload session for
// a large file. The browser then PUTs the bytes directly to the returned
// sessionUrl (in chunks) -- this route only ever handles a small JSON body,
// so it isn't subject to Vercel's ~4.5MB serverless request-body limit that
// the regular /cases/:id/documents upload route runs into on bigger files.
router.post('/gdrive/upload-session', requireAuth, async (req, res) => {
  try {
    const { case_id, file_name, mime_type, size, category } = req.body;
    if (!case_id || !file_name) return res.status(400).json({ error: 'case_id, file_name مطلوبون' });
    if (!(await gdrive.isConnected())) return res.status(503).json({ error: 'Google Drive غير متصل' });

    const folderId = await gdrive.ensureSubfolder(parseInt(case_id), CATEGORY_SUBFOLDER[category] || 'Attachments');
    const session = await gdrive.createResumableSession(file_name, mime_type, folderId, size);
    // The file already exists in Drive (same name+size) — tell the client to
    // skip the upload and finalize against the existing file instead of
    // creating a second copy.
    if (session && typeof session === 'object' && session.__existing) {
      return res.json({ success: true, existing: true, drive_file_id: session.__existing.id, webViewLink: session.__existing.webViewLink });
    }
    res.json({ success: true, sessionUrl: session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gdrive/finalize — register a file the browser already uploaded
// directly to Drive (via the session above) as a real case_documents row.
// Metadata is re-fetched from Drive itself rather than trusted from the
// client, so a tampered request can't forge size/mimeType/ownership.
router.post('/gdrive/finalize', requireAuth, async (req, res) => {
  try {
    const { case_id, drive_file_id, original_name, file_type, description } = req.body;
    if (!case_id || !drive_file_id) return res.status(400).json({ error: 'case_id, drive_file_id مطلوبان' });

    const meta = await gdrive.getFileMetadata(drive_file_id);
    const sup = getSupabase();

    // Idempotency guard: the browser may retry finalize after a lost
    // response even though the chunks already landed in Drive. If a row
    // already references this exact Drive file, return it instead of
    // creating a duplicate case_documents row.
    const { data: existingByDrive } = await sup.from('case_documents')
      .select('id').eq('case_id', parseInt(case_id)).eq('drive_file_id', meta.id).maybeSingle();
    if (existingByDrive) {
      return res.status(200).json({ success: true, data: { ...existingByDrive, duplicate: true } });
    }

    const insertData = {
      case_id: parseInt(case_id),
      filename: meta.name, original_name: original_name || meta.name,
      mime_type: meta.mimeType, size: parseInt(meta.size) || 0,
      file_type: file_type || 'document', description: description || '',
      uploaded_by: req.user.id,
      drive_file_id: meta.id, storage_provider: 'google_drive',
      file_path: meta.webViewLink, url: meta.webViewLink,
      file_hash: meta.md5Checksum || null,
    };
    let { data, error } = await sup.from('case_documents').insert(insertData).select().single();
    while (error && /column .* does not exist|Could not find the '(\w+)' column/.test(error.message)) {
      const m = error.message.match(/'(\w+)' column|column "(\w+)"/);
      const badCol = m && (m[1] || m[2]);
      if (!badCol || !(badCol in insertData)) break;
      delete insertData[badCol];
      ({ data, error } = await sup.from('case_documents').insert(insertData).select().single());
    }
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gdrive/share-file — share an EXISTING Drive-backed case document
// "anyone with the link" at a chosen role (reader/commenter/writer). Reuses the
// file already in Drive — no copy, no re-upload. Works for any case_documents
// row that has a drive_file_id (uploaded manually or received via email).
router.post('/gdrive/share-file', requireAuth, async (req, res) => {
  try {
    const { document_id, role } = req.body;
    if (!document_id) return res.status(400).json({ error: 'document_id مطلوب' });
    if (!(await gdrive.isConnected())) return res.status(503).json({ error: 'Google Drive غير متصل' });

    const sup = getSupabase();
    const { data: doc } = await sup.from('case_documents')
      .select('id, drive_file_id, original_name, storage_provider')
      .eq('id', parseInt(document_id)).maybeSingle();
    if (!doc) return res.status(404).json({ error: 'مستند غير موجود' });
    if (doc.storage_provider !== 'google_drive' || !doc.drive_file_id) {
      return res.status(400).json({ error: 'هذا المستند غير مخزن على Google Drive — المشاركة متاحة للملفات المخزنة على Drive فقط' });
    }

    const result = await gdrive.shareFileWithLink(doc.drive_file_id, role);
    res.json({ success: true, ...result, document_id: doc.id, original_name: doc.original_name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gdrive/link — link a Drive file to a case
router.post('/gdrive/link', requireAuth, async (req, res) => {
  try {
    const { case_id, file_id, file_name, web_link, mime_type, file_size } = req.body;
    if (!case_id || !file_id || !file_name) {
      return res.status(400).json({ error: 'case_id, file_id, file_name مطلوبون' });
    }

    const result = await gdrive.linkToCase(
      parseInt(case_id), file_id, file_name,
      web_link || `https://drive.google.com/file/d/${file_id}/view`,
      mime_type || 'application/vnd.google-apps.file',
      file_size || null
    );

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/gdrive/case/:caseId — list Drive files linked to a case
router.get('/gdrive/case/:caseId', requireAuth, async (req, res) => {
  try {
    const caseId = parseInt(req.params.caseId);
    const files = await gdrive.getCaseDriveFiles(caseId);
    const folder = await gdrive.getCaseDriveFolder(caseId);
    res.json({ success: true, data: files, folder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gdrive/folder — set Drive folder for a case
router.post('/gdrive/folder', requireAuth, async (req, res) => {
  try {
    const { case_id, folder_id, folder_name } = req.body;
    if (!case_id || !folder_id) return res.status(400).json({ error: 'case_id, folder_id required' });

    await gdrive.setCaseDriveFolder(parseInt(case_id), folder_id, folder_name || '');
    res.json({ success: true, message: '✅ تم ربط مجلد Drive بالقضية' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gdrive/case/:caseId/create-folder — idempotent: reuses the
// case's existing Drive folder (cases.drive_folder_id) instead of always
// creating a new one. Calling this twice used to silently orphan the first
// folder (and everything uploaded into it) by overwriting the DB reference
// with a brand new empty folder.
router.post('/gdrive/case/:caseId/create-folder', requireAuth, async (req, res) => {
  try {
    if (!gdrive.configured) return res.status(503).json({ error: 'Google Drive is not configured yet — set GOOGLE_CLIENT_ID/SECRET/DRIVE_ROOT_FOLDER' });
    const caseId = parseInt(req.params.caseId);
    const folderId = await gdrive.ensureCaseFolder(caseId);
    res.json({ success: true, configured: true, folderId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/gdrive/list/:folderId — list files in a Drive folder
router.get('/gdrive/list/:folderId', requireAuth, async (req, res) => {
  try {
    const result = await gdrive.listFolder(req.params.folderId);
    res.json({ success: true, configured: result.configured, data: result.files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/gdrive/file/:id — unlink a Drive-linked file from a case (case_documents row)
router.delete('/gdrive/file/:id', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { error } = await sup.from('case_documents').delete().eq('id', parseInt(req.params.id)).eq('file_type', 'gdrive_link');
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/gdrive/folder/:caseId — unlink a case's Drive folder
router.delete('/gdrive/folder/:caseId', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const { error } = await sup.from('cases').update({ drive_folder_id: null, drive_folder_status: null }).eq('id', parseInt(req.params.caseId));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.oauthCallbackHandler = oauthCallbackHandler;
