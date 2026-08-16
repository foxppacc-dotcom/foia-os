const crypto = require('crypto');
const gdrive = require('./googleDriveService');

/**
 * Forum attachments aren't tied to any one case, so they can't use
 * caseFileStorage's per-case folder tree -- everything lands in one shared
 * top-level "Forum Attachments" folder instead (via ensureSystemFolder,
 * the same mechanism used for other non-case bulk uploads).
 */
async function saveForumFile({ buffer, fileName, mimeType }) {
  const folderId = await gdrive.ensureSystemFolder('Forum Attachments');
  const driveFile = await gdrive.uploadBytes(buffer, fileName, mimeType, folderId);
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const isImage = (mimeType || '').startsWith('image/');

  return {
    // webViewLink opens Drive's HTML viewer page, not raw bytes -- unusable
    // as an <img src>. A direct drive.google.com/uc?export=view link DOES
    // serve raw bytes, but drive.usercontent.google.com (where it redirects)
    // sends `Cross-Origin-Resource-Policy: same-site`, which the browser
    // enforces and silently blocks once embedded cross-origin from our own
    // app -- it only "worked" when navigated to directly. Routing through
    // our own backend (/api/gdrive/image/:fileId) makes the request
    // same-origin instead. Non-image attachments keep the normal viewer link.
    attachment_url: isImage ? `/api/gdrive/image/${driveFile.id}` : driveFile.webViewLink,
    attachment_type: isImage ? 'image' : 'file',
    attachment_name: fileName,
    checksum,
  };
}

module.exports = { saveForumFile };
