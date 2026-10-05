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
    // Applies to every request every Google API client makes from here on --
    // without it, a stalled connection to Google (as opposed to a fast
    // rejection like invalid_grant) has no bound and a route can hang
    // forever even inside a try/catch, since try/catch only catches
    // rejections, not requests that never settle. Set once; safe to call
    // repeatedly (idempotent global default).
    google.options({ timeout: 20000 });
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

  /**
   * A stored refresh token doesn't mean it still WORKS -- Google revokes/
   * expires it silently (e.g. an OAuth consent screen left in "Testing"
   * publishing status auto-expires refresh tokens after 7 days), and
   * isConnected() above would keep reporting "connected" forever since it
   * only checks presence, not validity. This makes one cheap real call
   * (about.get) so the status page can tell "متصل" from "متصل لكن معطّل".
   */
  async verifyConnection() {
    const drive = await this.initRealDrive();
    if (!drive) return { ok: false, reason: 'not_configured' };
    try {
      const res = await drive.about.get({ fields: 'user(emailAddress)' });
      return { ok: true, email: res.data?.user?.emailAddress || null };
    } catch (err) {
      const invalidGrant = /invalid_grant/i.test(err.message || '');
      return { ok: false, reason: invalidGrant ? 'invalid_grant' : 'error', error: err.message };
    }
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
      q: `'${String(folderId).replace(/'/g, "\\'")}' in parents and trashed=false`,
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
   * Idempotent top-level folder directly under the root, for content that
   * isn't tied to any one case (e.g. archived agency/case bulk-import
   * Excel files). Not cached in folder_cache (that table is keyed by
   * case_id) since this is a rare, low-frequency operation.
   */
  async ensureSystemFolder(name) {
    const drive = await this.initRealDrive();
    if (!drive) throw new Error('Google Drive غير متصل');
    const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER;
    // Only ever called with hardcoded names today, but escape anyway to match
    // findExistingFileRetrying's same defensive pattern below, rather than
    // leaving an unescaped-interpolation habit to be copy-pasted into a
    // future caller that DOES accept a user-controlled name.
    const safeName = String(name).replace(/'/g, "\\'");
    const res = await drive.files.list({
      q: `'${rootId}' in parents and name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
    });
    if (res.data.files?.length) return res.data.files[0].id;
    const created = await drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [rootId] },
      fields: 'id',
    });
    return created.data.id;
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
      .eq('case_id', caseId).eq('file_type', 'gdrive_link').is('deleted_at', null)
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
  // Same unlocked check-then-create race ensureSubfolder used to have, one
  // level up: two concurrent uploads to a case with no Drive folder yet
  // (routine now that the public FileFetch link can run concurrently with
  // an authenticated teammate's own upload) would each read
  // cases.drive_folder_id as null, each create a SEPARATE top-level case
  // folder, and the final plain UPDATE would let the last writer silently
  // orphan the other folder -- and everything created inside it, including
  // whatever subfolder + bytes had just landed there. Reuses folder_cache's
  // same insert-claim + poll pattern as ensureSubfolder (reserved key
  // '__case_root__', since folder_cache is keyed by (case_id, folder_key)
  // and a case's own root folder isn't a "subfolder"), then mirrors the
  // winning id onto cases.drive_folder_id so getCaseDriveFolder's direct
  // read keeps working unchanged for every other caller.
  async ensureCaseFolder(caseId) {
    const existing = await this.getCaseDriveFolder(caseId);
    if (existing?.folderId) return existing.folderId;

    const sup = getSupabase();
    const PENDING = GoogleDriveService.FOLDER_CACHE_PENDING;
    const ROOT_KEY = '__case_root__';

    const mirrorToCase = async (folderId) => {
      try { await sup.from('cases').update({ drive_folder_id: folderId, drive_folder_status: 'ready' }).eq('id', caseId); }
      catch (e) { /* best-effort -- folder_cache stays the source of truth either way */ }
    };

    for (let round = 0; round < 3; round++) {
      const { data: cached } = await sup.from('folder_cache')
        .select('drive_folder_id').eq('case_id', caseId).eq('folder_key', ROOT_KEY).maybeSingle();
      if (cached?.drive_folder_id && cached.drive_folder_id !== PENDING) {
        await mirrorToCase(cached.drive_folder_id);
        return cached.drive_folder_id;
      }

      if (!cached) {
        const { error: claimErr } = await sup.from('folder_cache')
          .insert({ case_id: caseId, folder_key: ROOT_KEY, drive_folder_id: PENDING });
        if (!claimErr) {
          try {
            const created = await this.createCaseFolder(caseId);
            if (!created.configured) throw new Error('Google Drive غير متصل');
            await sup.from('folder_cache').update({ drive_folder_id: created.folderId })
              .eq('case_id', caseId).eq('folder_key', ROOT_KEY);
            return created.folderId;
          } catch (e) {
            try {
              await sup.from('folder_cache').delete().eq('case_id', caseId).eq('folder_key', ROOT_KEY).eq('drive_folder_id', PENDING);
            } catch (e2) { /* best-effort rollback */ }
            throw e;
          }
        }
      }

      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(r => setTimeout(r, 500));
        const { data: row } = await sup.from('folder_cache')
          .select('drive_folder_id').eq('case_id', caseId).eq('folder_key', ROOT_KEY).maybeSingle();
        if (row?.drive_folder_id && row.drive_folder_id !== PENDING) {
          await mirrorToCase(row.drive_folder_id);
          return row.drive_folder_id;
        }
        if (!row) break;
      }
    }
    throw new Error('تعذر تجهيز مجلد القضية -- حاول مرة أخرى');
  }

  // Not a real Drive id -- a claim marker written to folder_cache so a
  // concurrent racer can tell "someone is creating this right now" apart
  // from "not created yet" without a second column.
  static FOLDER_CACHE_PENDING = '__pending__';

  /**
   * Idempotent per-case subfolder (Incoming/Outgoing/Attachments/Reports),
   * cached in folder_cache so repeat uploads don't re-list/re-create it.
   *
   * Race-safe by construction: multiple files uploaded together (the public
   * FileFetch page starts every dropped file's upload concurrently) each
   * call this for the SAME (case_id, folder_key) at the same moment. The
   * previous check-then-create had no locking -- every one of them read
   * "not cached yet", each created its OWN separate Drive folder, and only
   * the LAST one's id survived the final upsert. Every other file's bytes
   * had already landed in one of the now-orphaned folders, which nothing
   * ever looked in again -- finalize's `meta.parents.includes(folderId)`
   * check permanently rejected them with "الملف غير موجود في مجلد هذه
   * القضية", and every retry repeated the exact same mismatch (confirmed
   * live: one of several files uploaded together succeeds, the rest fail
   * and stay stuck on retry). An INSERT claim (relying on folder_cache's
   * real UNIQUE(case_id, folder_key) constraint) makes exactly one caller
   * win the right to create the real folder; everyone else polls for it.
   */
  async ensureSubfolder(caseId, subfolderKey) {
    const sup = getSupabase();
    const PENDING = GoogleDriveService.FOLDER_CACHE_PENDING;

    // One outer loop instead of a single claim-then-poll pass: if the
    // winner's OWN folder creation fails (a transient Drive hiccup, not
    // just the concurrency case), it deletes its PENDING claim below rather
    // than leaving it stuck forever -- which means a poller can find the
    // row gone entirely and needs to be able to re-attempt the claim
        // itself, not just give up.
    for (let round = 0; round < 3; round++) {
      const { data: cached } = await sup.from('folder_cache')
        .select('drive_folder_id').eq('case_id', caseId).eq('folder_key', subfolderKey).maybeSingle();
      if (cached?.drive_folder_id && cached.drive_folder_id !== PENDING) return cached.drive_folder_id;

      if (!cached) {
        const { error: claimErr } = await sup.from('folder_cache')
          .insert({ case_id: caseId, folder_key: subfolderKey, drive_folder_id: PENDING });
        if (!claimErr) {
          // Won the claim -- we're the one that actually creates the folder.
          try {
            const drive = await this.initRealDrive();
            if (!drive) throw new Error('Google Drive غير متصل');
            const parentId = await this.ensureCaseFolder(caseId);
            const res = await drive.files.create({
              requestBody: { name: subfolderKey, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
              fields: 'id',
            });
            await sup.from('folder_cache').update({ drive_folder_id: res.data.id })
              .eq('case_id', caseId).eq('folder_key', subfolderKey);
            return res.data.id;
          } catch (e) {
            // Don't leave a permanently-stuck PENDING row behind -- that
            // would block EVERY future upload to this case's subfolder,
            // not just this one, until someone manually clears the row.
            // Supabase's query builder is a bare thenable (only .then(),
            // no .catch()/.finally()) -- a real try/catch, not a chained
            // .catch(), is required to swallow a failure here.
            try {
              await sup.from('folder_cache').delete().eq('case_id', caseId).eq('folder_key', subfolderKey).eq('drive_folder_id', PENDING);
            } catch (e2) { /* best-effort rollback */ }
            throw e;
          }
        }
        // Lost the claim -- someone else's insert won a moment earlier; fall
        // through to polling for their result below.
      }

      // cached.drive_folder_id === PENDING, or we just lost the claim race --
      // the winner is creating the real folder right now (a single Drive
      // folder-create call, well under the poll window below).
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(r => setTimeout(r, 500));
        const { data: row } = await sup.from('folder_cache')
          .select('drive_folder_id').eq('case_id', caseId).eq('folder_key', subfolderKey).maybeSingle();
        if (row?.drive_folder_id && row.drive_folder_id !== PENDING) return row.drive_folder_id;
        if (!row) break; // winner rolled back its failed claim -- retry the outer loop
      }
    }
    throw new Error('تعذر تجهيز مجلد الرفع -- حاول مرة أخرى');
  }

  /**
   * Find an existing, non-trashed file in a folder by name (and optionally
   * exact size). This is the storage-level idempotency guard: if the exact
   * file already landed in Drive (e.g. a previous attempt succeeded but its
   * response was lost and the client retried), return its ID instead of
   * creating a second copy. Returns null when no match.
   */
  async findExistingFile(folderId, fileName, fileSize = null) {
    const drive = await this.initRealDrive();
    if (!drive) return null;
    try {
      const q = `'${String(folderId).replace(/'/g, "\\'")}' in parents and name='${String(fileName).replace(/'/g, "\\'")}' and trashed=false`;
      const res = await drive.files.list({ q, fields: 'files(id, name, size)', pageSize: 10 });
      const files = res.data.files || [];
      if (fileSize != null) {
        const bySize = files.find(f => String(f.size) === String(fileSize));
        return bySize || null;
      }
      return files[0] || null;
    } catch (e) {
      console.error('[googleDriveService] findExistingFile failed:', e.message);
      return null;
    }
  }

  /**
   * Same lookup as findExistingFile, but retried with growing delays -- Drive's
   * own indexing can lag well behind a chunk upload that just finished (files.list
   * not reflecting a file for 10+ seconds, confirmed live on a multi-GB transfer).
   * A finalize call that gives up too fast reports a false "file not found" for a
   * file that landed successfully seconds later. Shared by both the public
   * FileFetch finalize handler and the authenticated /gdrive/finalize handler --
   * the latter used to have its own, much shorter (~3s total) retry loop, which
   * caused visible retry/failure flicker on ordinary authenticated uploads (traced
   * to a real case: an 18MB PDF that eventually landed fine but took ~2 minutes
   * and several visible "retrying" cycles first).
   */
  async findExistingFileRetrying(folderId, fileName, fileSize, delaysMs = [1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000]) {
    let existing = null;
    for (let attempt = 0; attempt <= delaysMs.length && !existing; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, delaysMs[attempt - 1]));
      existing = await this.findExistingFile(folderId, fileName, fileSize);
    }
    return existing;
  }

  /**
   * Upload real bytes to a Drive folder. Returns Drive's file metadata.
   * Dedupes against an existing same-name+same-size file in the folder.
   */
  async uploadBytes(buffer, fileName, mimeType, folderId) {
    const drive = await this.initRealDrive();
    if (!drive) throw new Error('Google Drive غير متصل');

    // Idempotency: if this exact file already exists in the folder, reuse it —
    // never write a second copy (client retries after lost responses land here).
    const existing = await this.findExistingFile(folderId, fileName, buffer.length);
    if (existing) {
      const { data: meta } = await drive.files.get({ fileId: existing.id, fields: 'id, name, size, mimeType, webViewLink, webContentLink, md5Checksum' });
      return meta;
    }

    const { Readable } = require('stream');
    const res = await drive.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType: mimeType || 'application/octet-stream', body: Readable.from(buffer) },
      fields: 'id, name, size, mimeType, webViewLink, webContentLink, md5Checksum',
    });
    return res.data;
  }

  /**
   * Upload a file already sitting on local disk to Drive, streaming it
   * straight from the filesystem (never loading the whole file into memory,
   * unlike uploadBytes above) -- the googleapis client library handles
   * resumable upload internally for large files, with its own retry
   * behavior, so this is used instead of manually managing PUT chunks.
   *
   * Exists specifically because relying on the BROWSER to PUT chunks
   * directly to Drive's resumable endpoint turned out to be unreliable for
   * real external senders on unpredictable networks/browsers (confirmed
   * live: a real upload attempt failed with a generic cross-origin
   * `net::ERR_FAILED` reaching googleapis.com directly from the browser,
   * even though the exact same session and a direct server-to-server PUT of
   * real bytes succeeded immediately). Routing bytes browser -> our own
   * server -> Drive means the browser only ever needs to reach our own
   * domain (same-origin, already proven reliable), and the actual Drive
   * upload happens server-to-server, which is what already works.
   */
  async uploadFileFromPath(localPath, fileName, mimeType, folderId, fileSize) {
    const drive = await this.initRealDrive();
    if (!drive) throw new Error('Google Drive غير متصل');

    const existing = await this.findExistingFile(folderId, fileName, fileSize);
    if (existing) {
      const { data: meta } = await drive.files.get({ fileId: existing.id, fields: 'id, name, size, mimeType, webViewLink, webContentLink, md5Checksum, parents' });
      return meta;
    }

    const fs = require('fs');
    const res = await drive.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType: mimeType || 'application/octet-stream', body: fs.createReadStream(localPath) },
      fields: 'id, name, size, mimeType, webViewLink, webContentLink, md5Checksum, parents',
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

  /** A short-lived access token, exchanged from the stored refresh token. Only ever used server-side. */
  async getAccessToken() {
    const auth = this.newOAuthClient();
    const refreshToken = await this.getStoredRefreshToken();
    if (!refreshToken) throw new Error('Google Drive غير متصل');
    auth.setCredentials({ refresh_token: refreshToken });
    const { token } = await auth.getAccessToken();
    if (!token) throw new Error('تعذر الحصول على access token من جوجل');
    return token;
  }

  /**
   * Open a Drive resumable-upload session. The browser then PUTs raw bytes
   * directly to the returned URL in chunks -- bypassing our own backend (and
   * Vercel's hard ~4.5MB serverless request-body limit) entirely. The
   * session URL is itself the credential for those PUTs; our OAuth token
   * never reaches the client.
   */
  /**
   * Ask Google Drive how many bytes of a resumable session have already been
   * accepted. Sends the documented status query (PUT with a wildcard
   * Content-Range); Drive answers 308 + `Range: bytes=0-N` when incomplete,
   * or 200/201 when complete. Returns { completed, offset }.
   */
  async checkSessionProgress(sessionUrl, totalSize) {
    const res = await fetch(sessionUrl, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes */${totalSize}` },
    });
    if (res.status === 200 || res.status === 201) return { completed: true, offset: totalSize };
    if (res.status === 308) {
      const range = res.headers.get('range');
      // Range header looks like "bytes=0-10485759" → offset = end + 1
      if (range) {
        const m = range.match(/bytes=(\d+)-(\d+)/);
        if (m) return { completed: false, offset: parseInt(m[2], 10) + 1 };
      }
      return { completed: false, offset: 0 };
    }
    // Session gone/expired (404/410) or any other failure → not resumable.
    throw new Error(`لا يمكن استئناف الجلسة: HTTP ${res.status}`);
  }

  async createResumableSession(fileName, mimeType, folderId, fileSize) {
    // Idempotency: if the file already exists in the target folder (same name
    // + same size — e.g. a previous chunked attempt finished but its response
    // was lost and the browser retried), return a flag so the client reuses
    // the existing file instead of creating a second Drive copy.
    const existing = await this.findExistingFile(folderId, fileName, fileSize);
    if (existing) {
      const { data: meta } = await this.initRealDrive().then(d => d.files.get({
        fileId: existing.id, fields: 'id, name, size, mimeType, webViewLink, md5Checksum',
      }));
      return { __existing: meta };
    }

    const accessToken = await this.getAccessToken();
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType || 'application/octet-stream',
        ...(fileSize ? { 'X-Upload-Content-Length': String(fileSize) } : {}),
      },
      body: JSON.stringify({ name: fileName, parents: [folderId] }),
    });
    if (!res.ok) throw new Error(`فشل بدء جلسة الرفع: ${res.status} ${await res.text()}`);
    const sessionUrl = res.headers.get('location');
    if (!sessionUrl) throw new Error('لم يتم استلام رابط جلسة الرفع من جوجل');
    return sessionUrl;
  }

  /** Authoritative Drive metadata for a file -- never trust client-supplied size/mimeType when finalizing an upload. `parents` is included so callers can verify a client-supplied drive_file_id actually lives in the folder they expect, instead of trusting it blindly. */
  async getFileMetadata(fileId) {
    const drive = await this.initRealDrive();
    if (!drive) throw new Error('Google Drive غير متصل');
    const res = await drive.files.get({ fileId, fields: 'id, name, size, mimeType, webViewLink, webContentLink, md5Checksum, parents' });
    return res.data;
  }

  /**
   * Stream a file's raw bytes via the Drive API (alt=media), for the image
   * proxy route -- embedding a Drive URL directly in an <img src> looked
   * fine on direct navigation but was silently blocked by the browser once
   * embedded cross-origin from our own app: drive.usercontent.google.com
   * sends `Cross-Origin-Resource-Policy: same-site`, which Chrome enforces
   * regardless of Access-Control-Allow-Origin. Proxying through our own
   * backend makes the image same-origin from the browser's point of view,
   * sidestepping CORP entirely.
   */
  async getFileStream(fileId) {
    const drive = await this.initRealDrive();
    if (!drive) throw new Error('Google Drive غير متصل');
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    return res.data;
  }

  /**
   * "Anyone with the link can view" -- the secure-enough default this app
   * relies on everywhere (matches the old Supabase signed-URL behavior:
   * whoever holds the link can open it, nothing indexable/public beyond
   * that). Files/folders created inside an already-shared folder inherit
   * the same access automatically, so this only ever needs to run once on
   * the root folder, not per case or per file.
   */
  async shareAnyoneWithLink(fileId) {
    const drive = await this.initRealDrive();
    if (!drive) throw new Error('Google Drive غير متصل');
    await drive.permissions.create({ fileId, requestBody: { type: 'anyone', role: 'reader' } });
    return { success: true };
  }

  /**
   * Share an EXISTING Drive file "anyone with the link" with a configurable
   * role (reader | commenter | writer), then return the live shareable link.
   * Reuses the file already stored in Drive — no re-upload, no duplicate copy.
   *
   * Most files live inside the shared root folder ("FOIA OS"), which is
   * already shared "anyone with the link". Drive then REJECTS adding a direct
   * permission on a child whose inherited access is equal-or-higher
   * ("Cannot modify a permission on an item to be less than the inherited
   * access from a direct or indirect parent"). In that case the link already
   * works through inheritance — we simply return it. Files outside the root
   * get a real direct permission.
   */
  async shareFileWithLink(fileId, role = 'reader') {
    const drive = await this.initRealDrive();
    if (!drive) throw new Error('Google Drive غير متصل');
    const valid = ['reader', 'commenter', 'writer'];
    if (!valid.includes(role)) role = 'reader';

    try {
      // Upsert the "anyone with link" permission at the requested role.
      const { data: existingPerms } = await drive.permissions.list({
        fileId, fields: 'permissions(id, type, role)',
      });
      const anyone = (existingPerms?.permissions || []).find(p => p.type === 'anyone');
      if (anyone) {
        if (anyone.role !== role) {
          await drive.permissions.update({ fileId, permissionId: anyone.id, requestBody: { role } });
        }
      } else {
        await drive.permissions.create({ fileId, requestBody: { type: 'anyone', role } });
      }
    } catch (err) {
      // Inherited access from the shared parent already grants the link —
      // that is not a failure, the file is already shareable.
      if (!/less than the inherited access/i.test(err.message)) throw err;
    }

    const { data: meta } = await drive.files.get({ fileId, fields: 'webViewLink, id, name' });
    return { success: true, shareUrl: meta.webViewLink, fileId: meta.id, name: meta.name, role, inherited: true };
  }

  async isSharedWithAnyone(fileId) {
    const drive = await this.initRealDrive();
    if (!drive) throw new Error('Google Drive غير متصل');
    const res = await drive.permissions.list({ fileId, fields: 'permissions(type, role)' });
    return (res.data.permissions || []).some(p => p.type === 'anyone');
  }
}

module.exports = new GoogleDriveService();
