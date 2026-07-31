const crypto = require('crypto');
const gdrive = require('./googleDriveService');

/**
 * Single entry point for persisting an uploaded file against a case.
 * Google Drive is the only permanent storage backend for new uploads —
 * bytes never touch local/Vercel disk beyond the multer memory buffer
 * already held in the request, and never go to Supabase Storage.
 *
 * category picks the per-case subfolder: 'attachments' | 'incoming' | 'outgoing'.
 * Returns fields ready to spread directly into a case_documents insert.
 */
async function saveCaseFile({ caseId, buffer, fileName, mimeType, category = 'attachments' }) {
  const subfolderName = { attachments: 'Attachments', incoming: 'Incoming', outgoing: 'Outgoing' }[category] || 'Attachments';
  const folderId = await gdrive.ensureSubfolder(caseId, subfolderName);
  const driveFile = await gdrive.uploadBytes(buffer, fileName, mimeType, folderId);
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    drive_file_id: driveFile.id,
    storage_provider: 'google_drive',
    file_path: driveFile.webViewLink,
    storage_key: null,
    checksum,
    file_hash: driveFile.md5Checksum || null,
  };
}

module.exports = { saveCaseFile };
