const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const gdrive = require('../services/googleDriveService');

// GET /api/gdrive/status — is real Drive integration configured yet?
router.get('/status', requireAuth, (req, res) => {
  res.json({ configured: gdrive.configured });
});

// POST /api/gdrive/link — link a Drive file to a case
router.post('/link', requireAuth, async (req, res) => {
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
router.get('/case/:caseId', requireAuth, async (req, res) => {
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
router.post('/folder', requireAuth, async (req, res) => {
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
router.post('/case/:caseId/create-folder', requireAuth, async (req, res) => {
  try {
    if (!gdrive.configured) return res.status(503).json({ error: 'Google Drive is not configured yet — set GOOGLE_CLIENT_ID/SECRET/DRIVE_ROOT_FOLDER' });
    const result = await gdrive.createCaseFolder(parseInt(req.params.caseId));
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/gdrive/list/:folderId — list files in a Drive folder
router.get('/list/:folderId', requireAuth, async (req, res) => {
  try {
    const result = await gdrive.listFolder(req.params.folderId);
    res.json({ success: true, configured: result.configured, data: result.files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
