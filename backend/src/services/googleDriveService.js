const { getSupabase } = require('../supabase');

/**
 * Google Drive Service for FOIA OS
 *
 * Real-mode only — no local mock/fake storage. Until GOOGLE_CLIENT_ID /
 * GOOGLE_CLIENT_SECRET / GOOGLE_DRIVE_ROOT_FOLDER are configured, Drive
 * operations return a clear "not configured" result instead of pretending
 * to succeed. Metadata (folder id/status, linked file records) lives in
 * Supabase — cases.drive_folder_id / cases.drive_folder_status, and
 * case_documents for linked files — never in local SQLite.
 */

class GoogleDriveService {
  constructor() {
    this.drive = null;
    this.cachedRefreshToken = null;
  }

  get configured() {
    return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_DRIVE_ROOT_FOLDER);
  }

  newOAuthClient() {
    const { google } = require('googleapis');
    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
  }

  // The refresh token is produced by the one-time OAuth consent flow
  // (/api/gdrive/auth-url -> /api/gdrive/oauth-callback) and persisted in
  // system_settings rather than requiring a Vercel env var + redeploy every
  // time someone (re)connects an account.
  async getStoredRefreshToken() {
    if (process.env.GOOGLE_DRIVE_REFRESH_TOKEN) return process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
    const sup = getSupabase();
    const { data } = await sup.from('system_settings').select('value').eq('key', 'gdrive_refresh_token').maybeSingle();
    return data?.value || null;
  }

  async saveConnection(refreshToken, email) {
    const sup = getSupabase();
    const now = new Date().toISOString();
    const rows = [
      { key: 'gdrive_refresh_token', value: refreshToken },
      { key: 'gdrive_connected_email', value: email || '' },
      { key: 'gdrive_connected_at', value: now },
    ];
    for (const row of rows) {
      const { data: exists } = await sup.from('system_settings').select('key').eq('key', row.key).maybeSingle();
      if (exists) await sup.from('system_settings').update({ value: row.value, updated_at: now }).eq('key', row.key);
      else await sup.from('system_settings').insert({ key: row.key, value: row.value, updated_at: now });
    }
    this.drive = null; // force re-init with the new token
  }

  async clearConnection() {
    const sup = getSupabase();
    await sup.from('system_settings').delete().in('key', ['gdrive_refresh_token', 'gdrive_connected_email', 'gdrive_connected_at']);
    this.drive = null;
  }

  async isConnected() {
    return !!(await this.getStoredRefreshToken());
  }

  async getConnectedEmail() {
    const sup = getSupabase();
    const { data } = await sup.from('system_settings').select('value').eq('key', 'gdrive_connected_email').maybeSingle();
    return data?.value || null;
  }

  /**
   * Initialize the real Google Drive client (OAuth2). Returns null if not configured.
   */
  async initRealDrive() {
    if (this.drive) return this.drive;
    if (!this.configured) return null;

    try {
      const { google } = require('googleapis');
      const auth = this.newOAuthClient();
      const refreshToken = await this.getStoredRefreshToken();
      if (!refreshToken) return null; // no token yet — needs the OAuth consent flow to be completed once
      auth.setCredentials({ refresh_token: refreshToken });

      this.drive = google.drive({ version: 'v3', auth });
      return this.drive;
    } catch (err) {
      console.error('[googleDriveService] init failed:', err.message);
      return null;
    }
  }

  /**
   * List files in a shared Drive folder.
   */
  async listFolder(folderId) {
    const drive = await this.initRealDrive();
    if (!drive) return { configured: false, files: [] };

    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType, size, webViewLink, iconLink, modifiedTime)',
      pageSize: 100,
    });
    return { configured: true, files: res.data.files || [] };
  }

  /**
   * Create a per-case Drive folder under the configured root, recording it on the case.
   */
  async createCaseFolder(caseId) {
    const drive = await this.initRealDrive();
    if (!drive) return { configured: false };

    const sup = getSupabase();
    const { data: caseRow } = await sup.from('cases').select('id, title').eq('id', caseId).maybeSingle();
    if (!caseRow) throw new Error('Case not found');

    const res = await drive.files.create({
      requestBody: {
        name: `Case #${caseId} — ${caseRow.title}`,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [process.env.GOOGLE_DRIVE_ROOT_FOLDER],
      },
      fields: 'id, webViewLink',
    });

    await sup.from('cases').update({ drive_folder_id: res.data.id, drive_folder_status: 'ready' }).eq('id', caseId);
    return { configured: true, folderId: res.data.id, webViewLink: res.data.webViewLink };
  }

  /**
   * Link an already-uploaded Drive file's metadata to a case (as a case_documents row).
   */
  async linkToCase(caseId, driveFileId, fileName, webViewLink, mimeType, fileSize) {
    const sup = getSupabase();

    const { data: caseRow } = await sup.from('cases').select('id').eq('id', caseId).maybeSingle();
    if (!caseRow) throw new Error('Case not found');

    const { data: existing } = await sup.from('case_documents')
      .select('id').eq('case_id', caseId).eq('original_name', `[Drive] ${fileName}`).maybeSingle();
    if (existing) return { exists: true, id: existing.id };

    const { data: created, error } = await sup.from('case_documents').insert({
      case_id: caseId,
      filename: `gdrive_${driveFileId}`,
      original_name: `[Drive] ${fileName}`,
      mime_type: mimeType || 'application/vnd.google-apps.drive-link',
      size: fileSize || 0,
      file_path: webViewLink || `https://drive.google.com/file/d/${driveFileId}/view`,
      file_type: 'gdrive_link',
    }).select().single();
    if (error) throw error;

    return { success: true, id: created.id };
  }

  /**
   * Get all Drive-linked files for a case.
   */
  async getCaseDriveFiles(caseId) {
    const sup = getSupabase();
    const { data, error } = await sup.from('case_documents')
      .select('id, original_name, filename, mime_type, size, file_path, created_at')
      .eq('case_id', caseId).eq('file_type', 'gdrive_link')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(d => ({ ...d, drive_url: d.file_path }));
  }

  /**
   * Save/get a case's Drive folder reference — uses the real cases.drive_folder_id/status columns.
   */
  async setCaseDriveFolder(caseId, folderId, folderName) {
    const sup = getSupabase();
    const { data: caseRow } = await sup.from('cases').select('id').eq('id', caseId).maybeSingle();
    if (!caseRow) throw new Error('Case not found');

    const { error } = await sup.from('cases')
      .update({ drive_folder_id: folderId, drive_folder_status: 'ready' })
      .eq('id', caseId);
    if (error) throw error;
    return { folderId, folderName };
  }

  async getCaseDriveFolder(caseId) {
    const sup = getSupabase();
    const { data } = await sup.from('cases').select('drive_folder_id, drive_folder_status').eq('id', caseId).maybeSingle();
    if (!data || !data.drive_folder_id) return null;
    return { folderId: data.drive_folder_id, status: data.drive_folder_status };
  }

  /**
   * Idempotent: reuse cases.drive_folder_id if a case folder already
   * exists, otherwise create one. This is the entry point every real
   * upload path calls before writing bytes.
   */
  async ensureCaseFolder(caseId) {
    const existing = await this.getCaseDriveFolder(caseId);
    if (existing?.folderId) return existing.folderId;
    const created = await this.createCaseFolder(caseId);
    if (!created.configured) throw new Error('Google Drive غير متصل');
    return created.folderId;
  }

  /**
   * Idempotent per-case subfolder (Incoming/Outgoing/Attachments/Reports),
   * cached in folder_cache so repeat uploads don't re-list/re-create it.
   */
  async ensureSubfolder(caseId, subfolderKey) {
    const sup = getSupabase();
    const { data: cached } = await sup.from('folder_cache')
      .select('drive_folder_id').eq('case_id', caseId).eq('folder_key', subfolderKey).maybeSingle();
    if (cached?.drive_folder_id) return cached.drive_folder_id;

    const drive = await this.initRealDrive();
    if (!drive) throw new Error('Google Drive غير متصل');
    const parentId = await this.ensureCaseFolder(caseId);
    const res = await drive.files.create({
      requestBody: { name: subfolderKey, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id',
    });
    await sup.from('folder_cache').upsert(
      { case_id: caseId, folder_key: subfolderKey, drive_folder_id: res.data.id },
      { onConflict: 'case_id,folder_key' }
    );
    return res.data.id;
  }

  /**
   * Upload real bytes to a Drive folder. Returns Drive's file metadata.
   */
  async uploadBytes(buffer, fileName, mimeType, folderId) {
    const drive = await this.initRealDrive();
    if (!drive) throw new Error('Google Drive غير متصل');
    const { Readable } = require('stream');
    const res = await drive.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType: mimeType || 'application/octet-stream', body: Readable.from(buffer) },
      fields: 'id, name, size, mimeType, webViewLink, webContentLink, md5Checksum',
    });
    return res.data;
  }

  /** Move a Drive file to trash (soft delete on Drive's side). */
  async deleteFile(fileId) {
    const drive = await this.initRealDrive();
    if (!drive) throw new Error('Google Drive غير متصل');
    await drive.files.update({ fileId, requestBody: { trashed: true } });
    return { success: true };
  }

  /** Fresh view/download links for a Drive file (webViewLink can go stale-looking but is stable; kept as a single fetch point for future signed-URL style needs). */
  async getFileLinks(fileId) {
    const drive = await this.initRealDrive();
    if (!drive) throw new Error('Google Drive غير متصل');
    const res = await drive.files.get({ fileId, fields: 'webViewLink, webContentLink' });
    return { viewUrl: res.data.webViewLink, downloadUrl: res.data.webContentLink };
  }

  /** Update a Drive file's display name (used when a document is renamed in FOIA OS). */
  async renameFile(fileId, newName) {
    const drive = await this.initRealDrive();
    if (!drive) throw new Error('Google Drive غير متصل');
    await drive.files.update({ fileId, requestBody: { name: newName } });
    return { success: true };
  }
}

module.exports = new GoogleDriveService();
