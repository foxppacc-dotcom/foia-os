const fs = require('fs');
const path = require('path');
const { getDatabase } = require('../database');

/**
 * Google Drive Service for FOIA OS
 *
 * Two modes:
 * 1. REAL MODE: Uses googleapis library with OAuth2 credentials
 * 2. MOCK MODE: Stores Drive file references locally (for testing / no API keys)
 *
 * To enable REAL mode:
 * - Place credentials.json in backend/config/gdrive-credentials.json
 * - Set FOIA_GDRIVE_MODE=real in environment
 */

const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');
const CREDENTIALS_PATH = path.join(CONFIG_DIR, 'gdrive-credentials.json');
const TOKEN_PATH = path.join(CONFIG_DIR, 'gdrive-token.json');
const GDRIVE_STORAGE = path.join(__dirname, '..', '..', 'uploads', 'gdrive-links');

// Ensure storage exists
if (!fs.existsSync(GDRIVE_STORAGE)) {
  fs.mkdirSync(GDRIVE_STORAGE, { recursive: true });
}

class GoogleDriveService {
  constructor() {
    this.realMode = process.env.FOIA_GDRIVE_MODE === 'real' && fs.existsSync(CREDENTIALS_PATH);
    this.drive = null;
  }

  /**
   * Initialize real Google Drive client
   */
  async initRealDrive() {
    if (this.drive) return this.drive;
    if (!this.realMode) return null;

    try {
      const { google } = require('googleapis');
      const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));

      const auth = new google.auth.OAuth2(
        credentials.installed?.client_id || credentials.web?.client_id,
        credentials.installed?.client_secret || credentials.web?.client_secret,
        credentials.installed?.redirect_uris?.[0] || 'http://localhost'
      );

      // Try loading saved token
      if (fs.existsSync(TOKEN_PATH)) {
        const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
        auth.setCredentials(token);
      }

      this.drive = google.drive({ version: 'v3', auth });
      return this.drive;
    } catch (err) {
      console.warn('⚠️ Google Drive real mode failed, falling back to mock:', err.message);
      this.realMode = false;
      return null;
    }
  }

  /**
   * List files in a shared Drive folder
   */
  async listFolder(folderId) {
    if (this.realMode) {
      const drive = await this.initRealDrive();
      if (drive) {
        const res = await drive.files.list({
          q: `'${folderId}' in parents and trashed=false`,
          fields: 'files(id, name, mimeType, size, webViewLink, iconLink,modifiedTime)',
          pageSize: 100,
        });
        return res.data.files || [];
      }
    }

    // Mock mode: return locally stored links
    return this.getMockFiles(folderId);
  }

  /**
   * Upload a local file to Google Drive
   */
  async uploadFile(filePath, fileName, folderId) {
    if (this.realMode) {
      const drive = await this.initRealDrive();
      if (drive) {
        const res = await drive.files.create({
          requestBody: {
            name: fileName,
            parents: [folderId],
          },
          media: {
            body: fs.createReadStream(filePath),
          },
          fields: 'id, name, mimeType, size, webViewLink',
        });
        return res.data;
      }
    }

    // Mock: just create a reference
    return this.addMockLink(fileName, `https://drive.google.com/file/d/mock-${Date.now()}/view`, folderId);
  }

  /**
   * Add a Drive link to a case (metadata + optional download)
   */
  async linkToCase(caseId, driveFileId, fileName, webViewLink, mimeType, fileSize) {
    const db = getDatabase();

    // Verify case exists
    const caseRow = db.prepare('SELECT id FROM cases WHERE id = ?').get(caseId);
    if (!caseRow) throw new Error('Case not found');

    // Check for duplicates
    const existing = db.prepare(
      'SELECT id FROM case_documents WHERE case_id = ? AND original_name = ? AND mime_type = ?'
    ).get(caseId, `[Drive] ${fileName}`, 'application/vnd.google-apps.drive-link');

    if (existing) return { exists: true, id: existing.id };

    const result = db.prepare(`
      INSERT INTO case_documents (case_id, filename, original_name, mime_type, size, file_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      caseId,
      `gdrive_${driveFileId}`,
      `[Drive] ${fileName}`,
      'application/vnd.google-apps.drive-link',
      fileSize || 0,
      webViewLink || `https://drive.google.com/file/d/${driveFileId}/view`
    );

    db.prepare(`
      INSERT INTO case_comments (case_id, content, created_at)
      VALUES (?, ?, datetime('now'))
    `).run(caseId, `☁️ تم ربط ملف من Google Drive: ${fileName}`);

    return { success: true, id: result.lastInsertRowid };
  }

  /**
   * Get all Drive-linked files for a case
   */
  getCaseDriveFiles(caseId) {
    const db = getDatabase();
    return db.prepare(`
      SELECT id, original_name, filename, mime_type, size, file_path as drive_url, created_at
      FROM case_documents
      WHERE case_id = ? AND mime_type = 'application/vnd.google-apps.drive-link'
      ORDER BY created_at DESC
    `).all(caseId);
  }

  /**
   * Save a Drive folder reference for a case
   */
  setCaseDriveFolder(caseId, folderId, folderName) {
    const db = getDatabase();
    // Store in case metadata (using description as JSON for now)
    const c = db.prepare('SELECT description FROM cases WHERE id = ?').get(caseId);
    if (!c) throw new Error('Case not found');

    let meta = {};
    try {
      meta = JSON.parse(c.description || '{}');
    } catch { /* ignore */ }

    meta._gdrive = { folderId, folderName };

    db.prepare('UPDATE cases SET description = ? WHERE id = ?').run(JSON.stringify(meta), caseId);
  }

  /**
   * Get Drive folder for a case
   */
  getCaseDriveFolder(caseId) {
    const db = getDatabase();
    const c = db.prepare('SELECT description FROM cases WHERE id = ?').get(caseId);
    if (!c) return null;

    try {
      const meta = JSON.parse(c.description || '{}');
      return meta._gdrive || null;
    } catch {
      return null;
    }
  }

  // ========== MOCK MODE HELPERS ==========

  getMockFiles(folderId) {
    const filePath = path.join(GDRIVE_STORAGE, `${folderId}.json`);
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  addMockLink(fileName, url, folderId) {
    const filePath = path.join(GDRIVE_STORAGE, `${folderId}.json`);
    const files = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : [];
    const entry = {
      id: `mock-${Date.now()}`,
      name: fileName,
      webViewLink: url,
      mimeType: 'application/vnd.google-apps.file',
      size: null,
      modifiedTime: new Date().toISOString(),
    };
    files.push(entry);
    fs.writeFileSync(filePath, JSON.stringify(files, null, 2));
    return entry;
  }
}

module.exports = new GoogleDriveService();
