// Shared Drive/storage byte-cleanup for permanent deletes -- used by both
// trash.js (single-row permanent delete from سلة المحذوفات) and
// caseCascade.js (bulk case-level permanent delete), so there is exactly one
// place this logic lives instead of two copies that can drift.
const gdrive = require('./googleDriveService');
const storage = require('./storage');

function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

async function deleteDocumentBytes(doc) {
  if (doc?.storage_provider === 'google_drive' && doc?.drive_file_id) {
    await gdrive.deleteFile(doc.drive_file_id).catch(e => console.warn('⚠️ Drive delete failed:', e.message));
  } else if (doc?.storage_key) {
    await storage.deleteByKey(doc.storage_key).catch(e => console.warn('⚠️ Storage delete failed:', e.message));
  }
}

async function deleteCommunicationAttachments(comm) {
  const meta = parseMetadata(comm?.metadata);
  for (const att of meta.attachments || []) {
    if (att.driveFileId) await gdrive.deleteFile(att.driveFileId).catch(e => console.warn('[fileCleanup] Drive attachment delete failed:', e.message));
  }
}

module.exports = { deleteDocumentBytes, deleteCommunicationAttachments };
