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

// GET /api/gdrive/oauth-callback — Google redirects the browser here after consent
router.get('/gdrive/oauth-callback', async (req, res) => {
  const frontendBase = process.env.FRONTEND_URL || 'https://frontend-six-flax-84.vercel.app';
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
    res.redirect(`${frontendBase}/gdrive?gdrive=success`);
  } catch (err) {
    res.redirect(`${frontendBase}/gdrive?gdrive=error&msg=${encodeURIComponent(err.message)}`);
  }
});

// POST /api/gdrive/disconnect — remove the stored connection (admin only)
router.post('/gdrive/disconnect', requireAuth, requireRole('admin'), async (req, res) => {
  await gdrive.clearConnection();
  res.json({ success: true });
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

// POST /api/gdrive/case/:caseId/create-folder — create a per-case Drive folder (requires real credentials)
router.post('/gdrive/case/:caseId/create-folder', requireAuth, async (req, res) => {
  try {
    if (!gdrive.configured) return res.status(503).json({ error: 'Google Drive is not configured yet — set GOOGLE_CLIENT_ID/SECRET/DRIVE_ROOT_FOLDER' });
    const result = await gdrive.createCaseFolder(parseInt(req.params.caseId));
    res.json({ success: true, ...result });
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
