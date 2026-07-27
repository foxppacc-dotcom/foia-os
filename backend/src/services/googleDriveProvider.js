/**
 * GoogleDriveProvider — Full enterprise Google Drive integration.
 * Implements StorageProvider interface with OAuth2, resumable upload, folder automation.
 */
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const StorageProvider = require('./StorageProvider');
const CONFIG = require('../config');

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

class GoogleDriveProvider extends StorageProvider {
  constructor() {
    super();
    this.drive = null;
    this.auth = null;
  }

  /**
   * Initialize OAuth2 client with stored tokens
   */
  async ensureAuth() {
    if (this.drive && this.auth?.credentials?.access_token) return this.drive;
    const { getSupabase } = require('../supabase');
    const sup = getSupabase();
    const { data: tokens } = await sup.from('storage_tokens')
      .select('*').eq('provider', 'google_drive').maybeSingle();
    if (!tokens || !tokens.access_token) {
      throw new Error('GOOGLE_DRIVE_NOT_CONFIGURED');
    }
    this.auth = new google.auth.OAuth2(
      CONFIG.google?.clientId || process.env.GOOGLE_CLIENT_ID,
      CONFIG.google?.clientSecret || process.env.GOOGLE_CLIENT_SECRET,
      CONFIG.google?.redirectUri || process.env.GOOGLE_REDIRECT_URI || `${CONFIG.app.url}/api/gdrive/oauth/callback`
    );
    this.auth.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date).getTime() : null,
    });
    this.auth.on('tokens', async (newTokens) => {
      const update = {};
      if (newTokens.access_token) update.access_token = newTokens.access_token;
      if (newTokens.refresh_token) update.refresh_token = newTokens.refresh_token;
      if (newTokens.expiry_date) update.expiry_date = new Date(newTokens.expiry_date).toISOString();
      if (Object.keys(update).length > 0) {
        await sup.from('storage_tokens').update(update).eq('provider', 'google_drive');
      }
    });
    this.drive = google.drive({ version: 'v3', auth: this.auth });
    return this.drive;
  }

  /** Generate OAuth URL for initial setup */
  getAuthUrl(state) {
    const oauth2 = new google.auth.OAuth2(
      CONFIG.google?.clientId,
      CONFIG.google?.clientSecret,
      CONFIG.google?.redirectUri || `${CONFIG.app.url}/api/gdrive/oauth/callback`
    );
    return oauth2.generateAuthUrl({ access_type: 'offline', scope: SCOPES, state, prompt: 'consent' });
  }

  /** Exchange auth code for tokens */
  async handleCallback(code) {
    const oauth2 = new google.auth.OAuth2(
      CONFIG.google?.clientId,
      CONFIG.google?.clientSecret,
      CONFIG.google?.redirectUri || `${CONFIG.app.url}/api/gdrive/oauth/callback`
    );
    const { tokens } = await oauth2.getToken(code);
    const { getSupabase } = require('../supabase');
    const sup = getSupabase();
    const { error } = await sup.from('storage_tokens').upsert({
      provider: 'google_drive',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      token_type: tokens.token_type || 'Bearer',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'provider' });
    if (error) throw error;
    this.auth = oauth2;
    this.auth.setCredentials(tokens);
    this.drive = google.drive({ version: 'v3', auth: this.auth });
    return { success: true };
  }

  /** Check if Drive is connected */
  async isConnected() {
    try { await this.ensureAuth(); return true; }
    catch { return false; }
  }

  /** 
   * Create folder hierarchy for a case
   * @param {number} caseId
   * @param {Array} template — [{ name_ar, name_en, ... }]
   * @param {string} rootName — e.g. "Case #123 — Title"
   */
  async createFolderHierarchy(caseId, template, rootName) {
    const drive = await this.ensureAuth();
    const { getSupabase } = require('../supabase');
    const sup = getSupabase();

    // Get or create root "FOIA OS Cases" folder
    let rootFolderId = CONFIG.google?.rootFolderId;
    if (!rootFolderId) {
      const res = await drive.files.create({
        requestBody: { name: 'FOIA OS Cases', mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id',
      });
      rootFolderId = res.data.id;
    }

    // Create case folder
    const caseFolder = await drive.files.create({
      requestBody: { name: rootName, parents: [rootFolderId], mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
    });
    const caseFolderId = caseFolder.data.id;

    // Create subfolders from template
    const folderMap = {};
    for (const tpl of (template || [])) {
      const sub = await drive.files.create({
        requestBody: { name: tpl.name_en, parents: [caseFolderId], mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id',
      });
      folderMap[tpl.id || tpl.name_en] = sub.data.id;
    }

    // Update case with drive_folder_id
    await sup.from('cases').update({ drive_folder_id: caseFolderId }).eq('id', caseId);

    // Cache folder IDs
    for (const [key, folderId] of Object.entries(folderMap)) {
      await sup.from('folder_cache').upsert({
        case_id: caseId, folder_key: String(key), drive_folder_id: folderId,
      }, { onConflict: 'case_id,folder_key' });
    }

    return { caseFolderId, folders: folderMap };
  }

  /**
   * Initiate resumable upload session
   */
  async createResumableSession(fileName, mimeType, folderId) {
    const drive = await this.ensureAuth();
    const res = await drive.files.create({
      requestBody: { name: fileName, parents: [folderId], mimeType },
      media: { body: '', mimeType },
      uploadType: 'resumable',
      fields: 'id',
    });
    return { uploadUrl: res.data.uploadUrl || res.config?.url, fileId: res.data.id };
  }

  /**
   * Upload a file (simple, <50MB)
   */
  async upload(file, metadata) {
    const drive = await this.ensureAuth();
    const res = await drive.files.create({
      requestBody: { name: metadata.fileName, parents: [metadata.folderId], description: metadata.description || '' },
      media: { body: file.buffer || fs.createReadStream(file.path), mimeType: metadata.mimeType || 'application/octet-stream' },
      fields: 'id,name,size,mimeType,webViewLink,sha256Checksum',
    });
    return res.data;
  }

  /**
   * Download a file by ID
   */
  async download(fileId) {
    const drive = await this.ensureAuth();
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    return res.data;
  }

  /**
   * Delete a file (move to trash)
   */
  async delete(fileId) {
    const drive = await this.ensureAuth();
    await drive.files.update({ fileId, requestBody: { trashed: true } });
    return { success: true };
  }

  /**
   * Get a download/signed URL
   */
  async getSignedUrl(fileId, expiryMs = 3600000) {
    const drive = await this.ensureAuth();
    const res = await drive.files.get({ fileId, fields: 'webViewLink,webContentLink' });
    return {
      viewUrl: res.data.webViewLink,
      downloadUrl: res.data.webContentLink,
      expiresAt: Date.now() + expiryMs,
    };
  }

  /**
   * List files in a folder
   */
  async listFolder(folderId) {
    const drive = await this.ensureAuth();
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType, size, webViewLink, modifiedTime, sha256Checksum)',
      pageSize: 200,
      orderBy: 'modifiedTime desc',
    });
    return res.data.files || [];
  }

  /**
   * Search files across Drive
   */
  async search(query) {
    const drive = await this.ensureAuth();
    const res = await drive.files.list({
      q: `name contains '${query.replace(/'/g, "\\'")}' and trashed=false`,
      fields: 'files(id, name, mimeType, size, webViewLink, modifiedTime)',
      pageSize: 50,
    });
    return res.data.files || [];
  }

  /**
   * Get file metadata
   */
  async getMetadata(fileId) {
    const drive = await this.ensureAuth();
    const res = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,size,webViewLink,modifiedTime,sha256Checksum,version',
    });
    return res.data;
  }

  /**
   * Sync a case folder — detect new/deleted/renamed files since last sync
   */
  async syncFolder(caseId, folderId) {
    const drive = await this.ensureAuth();
    const { getSupabase } = require('../supabase');
    const sup = getSupabase();
    const driveFiles = await this.listFolder(folderId);
    const { data: dbFiles } = await sup.from('case_documents')
      .select('drive_file_id, filename, updated_at')
      .eq('case_id', caseId)
      .not('drive_file_id', 'is', null);
    const dbMap = new Map((dbFiles || []).map(d => [d.drive_file_id, d]));
    const changes = { new: [], deleted: [], renamed: [], modified: [] };
    for (const df of driveFiles) {
      const existing = dbMap.get(df.id);
      if (!existing) changes.new.push(df);
      else if (existing.filename !== df.name) changes.renamed.push(df);
      else if (new Date(df.modifiedTime) > new Date(existing.updated_at)) changes.modified.push(df);
      dbMap.delete(df.id);
    }
    for (const [, orphan] of dbMap) changes.deleted.push(orphan);
    return changes;
  }
}

module.exports = GoogleDriveProvider;
