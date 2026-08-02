/**
 * UploadManager — Enterprise upload queue with pause/resume/retry/cancel.
 * Provider-agnostic: works with any backend endpoint.
 */
import { API } from '../../../api';
import {
  UPLOAD_STATUS, MAX_CHUNK_RETRIES, CHUNK_SIZE, SIMPLE_UPLOAD_MAX_SIZE,
  MAX_QUEUE_SIZE, MAX_CONCURRENT, RETRY_DELAY_MS,
} from '../constants/upload';

class UploadItem {
  constructor(id, file, caseId, metadata = {}) {
    this.id = id;
    this.file = file;
    this.caseId = caseId;
    this.metadata = metadata;
    this.status = UPLOAD_STATUS.QUEUED;
    this.progress = 0;           // 0-100
    this.uploadedBytes = 0;
    this.totalBytes = file.size;
    this.speed = 0;             // bytes/sec
    this.eta = 0;               // seconds remaining
    this.retryCount = 0;
    this.error = null;
    this.startedAt = null;
    this.completedAt = null;
    this.abortController = null;
    this.priority = metadata.priority || 0;
  }
}

class UploadManager {
  constructor() {
    this.queue = [];
    this.activeCount = 0;
    this._onChange = null;       // callback when queue changes
    this._idCounter = 0;
  }

  /** Subscribe to queue changes */
  onChange(fn) { this._onChange = fn; }

  /** Notify listeners */
  _notify() { if (this._onChange) this._onChange([...this.queue]); }

  /** Add files to the upload queue */
  enqueue(files, caseId, metadata = {}) {
    const items = [];
    for (const file of Array.isArray(files) ? files : [files]) {
      if (this.queue.length >= MAX_QUEUE_SIZE) break;
      const id = `upload_${++this._idCounter}_${Date.now()}`;
      const item = new UploadItem(id, file, caseId, { ...metadata, fileType: metadata.fileType || 'document' });
      this.queue.push(item);
      items.push(item);
    }
    this._notify();
    this._processQueue();
    return items;
  }

  /** Internal: process queued items (up to MAX_CONCURRENT) */
  async _processQueue() {
    const pending = this.queue.filter(i => i.status === UPLOAD_STATUS.QUEUED);
    while (pending.length > 0 && this.activeCount < MAX_CONCURRENT) {
      const sorted = pending.sort((a, b) => b.priority - a.priority);
      const item = sorted[0];
      const idx = pending.indexOf(item);
      if (idx > -1) pending.splice(idx, 1);
      this.activeCount++;
      this._uploadItem(item).finally(() => {
        this.activeCount--;
        this._processQueue();
      });
    }
  }

  /** Upload a single item */
  async _uploadItem(item) {
    item.status = UPLOAD_STATUS.UPLOADING;
    item.startedAt = Date.now();
    item.abortController = new AbortController();
    this._notify();

    try {
      if (item.file.size > SIMPLE_UPLOAD_MAX_SIZE) {
        await this._chunkedUpload(item);
      } else {
        await this._simpleUpload(item);
      }
      item.status = UPLOAD_STATUS.PROCESSING;
      this._notify();
      await new Promise(r => setTimeout(r, 300)); // brief processing step
      item.status = UPLOAD_STATUS.COMPLETED;
      item.progress = 100;
      item.completedAt = Date.now();
    } catch (err) {
      if (err.name === 'AbortError') {
        item.status = UPLOAD_STATUS.CANCELED;
      } else if (item.retryCount < MAX_CHUNK_RETRIES) {
        item.retryCount++;
        item.status = UPLOAD_STATUS.RETRYING;
        this._notify();
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * item.retryCount));
        return this._uploadItem(item); // recursive retry
      } else {
        item.status = UPLOAD_STATUS.FAILED;
        item.error = err.message || 'Upload failed';
      }
    }
    this._notify();
  }

  /** Small file upload (single request) */
  async _simpleUpload(item) {
    const { API } = require('../../../api');
    const formData = new FormData();
    formData.append('file', item.file);
    formData.append('original_name', item.metadata.originalName || item.file.name);
    formData.append('file_type', item.metadata.fileType || 'document');
    formData.append('description', item.metadata.description || '');
    const token = localStorage.getItem('foia_token');
    const xhr = new XMLHttpRequest();
    item.abortController.signal.addEventListener('abort', () => xhr.abort());
    return new Promise((resolve, reject) => {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          // e.total includes multipart/form-data overhead (boundaries + text
          // fields), so it is LARGER than the real file. Measure against the
          // true file size so the bar never overshoots (>100% or uploaded
          // bytes > total bytes shown in the UI).
          item.uploadedBytes = Math.min(e.loaded, item.totalBytes);
          item.progress = Math.round((item.uploadedBytes / item.totalBytes) * 100);
          this._updateSpeed(item, item.uploadedBytes);
          this._notify();
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.open('POST', `${API}/cases/${item.caseId}/documents`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });
  }

  /**
   /** Large file upload: opens a Google Drive resumable-upload session via our
    *  backend (small JSON request, well under Vercel's body-size limit), then
    *  PUTs the file straight to Drive in chunks directly from the browser —
    *  our backend never touches the bytes, so there's no platform size ceiling
    *  beyond Drive's own (5TB). Finishes by registering the result as a real
    *  case_documents row (metadata only) via /gdrive/finalize.
    *
    *  Duplicate-safe: if the chunks already landed in Drive but the finalize
    *  (or its response) failed, a retry reuses the SAME drive_file_id and only
    *  re-runs finalize — it never re-uploads bytes or creates a second Drive
    *  file (the backend finalize route is idempotent by drive_file_id).
    */
   async _chunkedUpload(item) {
     const file = item.file;
     const token = localStorage.getItem('foia_token');

     // If a previous attempt already produced a Drive file (upload finished,
     // finalize failed), skip straight to finalize — do NOT re-upload.
     // A __driveDone marker means the last chunk answered 308 (bytes ARE in
     // Drive) but finalize hadn't succeeded yet — also skip re-uploading and
     // go straight to finalize (backend resolves the file by name+size).
     const driveDone = !!(item.driveFile && item.driveFile.__driveDone);
     let driveFile = driveDone ? null : (item.driveFile || null);

     if (!driveFile && !driveDone) {
       const sessionRes = await fetch(`${API}/gdrive/upload-session`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
         body: JSON.stringify({
           case_id: item.caseId,
           file_name: item.metadata.originalName || file.name,
           mime_type: file.type || 'application/octet-stream',
           size: file.size,
           category: item.metadata.category || 'attachments',
         }),
       });
       if (!sessionRes.ok) throw new Error((await sessionRes.json().catch(() => ({}))).error || 'تعذر بدء جلسة الرفع');
       const sessionData = await sessionRes.json();

       // Backend found the exact file already in Drive (same name + size from
       // an earlier attempt whose response was lost) — skip the upload and
       // finalize against the existing Drive file. Never creates a duplicate.
       if (sessionData.existing && sessionData.drive_file_id) {
         driveFile = { id: sessionData.drive_file_id, webViewLink: sessionData.webViewLink || null };
         item.driveFile = driveFile;
       } else {
         // session_url is the canonical field (newer backend); sessionUrl is
         // kept for older bundles — accept either so uploads never break.
         const sessionUrl = sessionData.session_url ?? sessionData.sessionUrl;
         if (!sessionUrl) throw new Error('تعذر بدء جلسة الرفع');
         // Network-drop resume: the backend may return a resume_offset telling
         // us Google already accepted the first N bytes of a previous attempt.
         // Start from that byte — never re-upload the accepted prefix.
         const startOffset = sessionData.resume_offset || 0;
         if (startOffset > item.uploadedBytes) {
           item.uploadedBytes = startOffset;
           item.progress = Math.round((startOffset / item.totalBytes) * 100);
           this._notify();
         }
         driveFile = await this._uploadChunksToSession(item, file, sessionUrl, startOffset);
         // The final chunk can answer 308 "resume incomplete" instead of the
         // file metadata — the bytes ARE in Drive. Mark the item so a later
         // retry (finalize failure) skips re-uploading and only re-finalizes.
         item.driveFile = driveFile || { __driveDone: true };
       }
     }

     if (!driveFile) {
       // The final chunk can legitimately answer 308 "resume incomplete"
       // instead of the file metadata — the file IS in Drive. Send no
       // drive_file_id and let the backend resolve it by name+size (it will
       // also catch the case where a previous attempt already landed).
       const finalizeBody = {
         case_id: item.caseId,
         original_name: item.metadata.originalName || file.name,
         file_type: item.metadata.fileType || 'document',
         description: item.metadata.description || '',
         size: file.size,
         category: item.metadata.category || 'attachments',
       };
       if (driveFile && driveFile.id) finalizeBody.drive_file_id = driveFile.id;
       const finalizeRes = await fetch(`${API}/gdrive/finalize`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
         body: JSON.stringify(finalizeBody),
       });
       if (!finalizeRes.ok) throw new Error((await finalizeRes.json().catch(() => ({}))).error || 'تعذر تسجيل الملف بعد الرفع');
     } else {
       const finalizeRes = await fetch(`${API}/gdrive/finalize`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
         body: JSON.stringify({
           case_id: item.caseId, drive_file_id: driveFile.id,
           original_name: item.metadata.originalName || file.name,
           file_type: item.metadata.fileType || 'document',
           description: item.metadata.description || '',
         }),
       });
       if (!finalizeRes.ok) throw new Error((await finalizeRes.json().catch(() => ({}))).error || 'تعذر تسجيل الملف بعد الرفع');
       }
       }

       /** PUT all chunks of a file to a Drive resumable session URL (never touches our backend).
        *  startOffset (bytes): Google already accepted the prefix of a previous
        *  attempt — resume from there and skip re-uploading accepted bytes. */
       async _uploadChunksToSession(item, file, sessionUrl, startOffset = 0) {
         const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
         const firstChunk = Math.min(Math.floor(startOffset / CHUNK_SIZE), totalChunks);
         let driveFile = null;

         for (let chunkIndex = firstChunk; chunkIndex < totalChunks; chunkIndex++) {
      if (item.status === UPLOAD_STATUS.CANCELED || item.status === UPLOAD_STATUS.PAUSED) {
        if (item.status === UPLOAD_STATUS.PAUSED) {
          // Wait until resumed
          await new Promise(resolve => {
            const check = setInterval(() => {
              if (item.status === UPLOAD_STATUS.UPLOADING || item.status === UPLOAD_STATUS.CANCELED) {
                clearInterval(check);
                resolve();
              }
            }, 500);
          });
          if (item.status === UPLOAD_STATUS.CANCELED) throw new DOMException('Canceled', 'AbortError');
        } else throw new DOMException('Canceled', 'AbortError');
      }

      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);
      let chunkRetries = 0;

      while (chunkRetries <= MAX_CHUNK_RETRIES) {
        try {
          const result = await this._putChunkToDrive(sessionUrl, chunk, start, end, file.size, item);
          // Ratchet only upward — a chunk retry or a fresh attempt must never
          // drag the bar back (e.g. 100% → 50% → 100% → …).
          item.uploadedBytes = Math.max(item.uploadedBytes, Math.min(end, item.totalBytes));
          item.progress = Math.round((item.uploadedBytes / item.totalBytes) * 100);
          this._updateSpeed(item, end);
          this._notify();
          if (result) driveFile = result; // the final chunk's response is the created Drive file
          break;
        } catch (err) {
          chunkRetries++;
          if (chunkRetries > MAX_CHUNK_RETRIES) throw err;
          item.status = UPLOAD_STATUS.RETRYING;
          this._notify();
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS * chunkRetries));
          item.status = UPLOAD_STATUS.UPLOADING;
          this._notify();
        }
      }
    }
    return driveFile;
  }

  /** PUT one chunk directly to Google Drive's resumable session URL (never touches our backend). */
  _putChunkToDrive(sessionUrl, chunk, start, end, totalSize, item) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      if (item.abortController) item.abortController.signal.addEventListener('abort', () => xhr.abort());
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          // Monotonic guard: when a chunk is retried after a failure, the XHR
          // restarts from 0, which would drag the bar BACK to the chunk's
          // start (e.g. 100% → 50%). Never let progress go backwards — only
          // ever ratchet it upward.
          const loaded = Math.max(item.uploadedBytes, start + e.loaded);
          item.uploadedBytes = Math.min(loaded, item.totalBytes);
          item.progress = Math.round((item.uploadedBytes / item.totalBytes) * 100);
          this._updateSpeed(item, item.uploadedBytes);
          this._notify();
        }
      };
      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 201) {
          try { resolve(JSON.parse(xhr.responseText)); } catch { resolve(null); }
        } else if (xhr.status === 308) {
          resolve(null); // this chunk accepted, Drive expects more
        } else {
          reject(new Error(`فشل رفع جزء من الملف إلى Drive: HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('خطأ شبكة أثناء الرفع إلى Google Drive'));
      xhr.open('PUT', sessionUrl);
      xhr.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${totalSize}`);
      xhr.send(chunk);
    });
  }

  /** Calculate upload speed and ETA */
  _updateSpeed(item, loadedBytes) {
    const elapsed = (Date.now() - item.startedAt) / 1000;
    item.speed = elapsed > 0 ? loadedBytes / elapsed : 0;
    const remaining = item.totalBytes - loadedBytes;
    item.eta = item.speed > 0 ? remaining / item.speed : 0;
  }

  /** Pause an upload */
  pause(id) {
    const item = this.queue.find(i => i.id === id);
    if (item && (item.status === UPLOAD_STATUS.UPLOADING || item.status === UPLOAD_STATUS.QUEUED)) {
      item.status = UPLOAD_STATUS.PAUSED;
      if (item.abortController) item.abortController.abort();
      this.activeCount = Math.max(0, this.activeCount - 1);
      this._notify();
    }
  }

  /** Resume a paused upload */
  resume(id) {
    const item = this.queue.find(i => i.id === id);
    if (item && item.status === UPLOAD_STATUS.PAUSED) {
      item.abortController = new AbortController();
      this.activeCount++;
      this._uploadItem(item);
      this._notify();
    }
  }

  /** Cancel an upload */
  cancel(id) {
    const item = this.queue.find(i => i.id === id);
    if (item) {
      if (item.abortController) item.abortController.abort();
      item.status = UPLOAD_STATUS.CANCELED;
      if (item.status === UPLOAD_STATUS.UPLOADING) this.activeCount = Math.max(0, this.activeCount - 1);
      this._notify();
    }
  }

  /** Retry a failed upload */
  retry(id) {
    const item = this.queue.find(i => i.id === id);
    if (item && item.status === UPLOAD_STATUS.FAILED) {
      item.status = UPLOAD_STATUS.QUEUED;
      item.retryCount = 0;
      item.error = null;
      item.progress = 0;
      item.uploadedBytes = 0;
      this._notify();
      this._processQueue();
    }
  }

  /** Clear completed/failed/canceled items */
  clearCompleted() {
    this.queue = this.queue.filter(i =>
      ![UPLOAD_STATUS.COMPLETED, UPLOAD_STATUS.FAILED, UPLOAD_STATUS.CANCELED].includes(i.status)
    );
    this._notify();
  }

  /** Get queue stats */
  getStats() {
    return {
      total: this.queue.length,
      active: this.activeCount,
      queued: this.queue.filter(i => i.status === UPLOAD_STATUS.QUEUED).length,
      uploading: this.queue.filter(i => i.status === UPLOAD_STATUS.UPLOADING).length,
      completed: this.queue.filter(i => i.status === UPLOAD_STATUS.COMPLETED).length,
      failed: this.queue.filter(i => i.status === UPLOAD_STATUS.FAILED).length,
      paused: this.queue.filter(i => i.status === UPLOAD_STATUS.PAUSED).length,
    };
  }

  /** Pause all active uploads */
  pauseAll() { this.queue.filter(i => i.status === UPLOAD_STATUS.UPLOADING).forEach(i => this.pause(i.id)); }

  /** Resume all paused */
  resumeAll() { this.queue.filter(i => i.status === UPLOAD_STATUS.PAUSED).forEach(i => this.resume(i.id)); }

  /** Cancel all */
  cancelAll() { [...this.queue].forEach(i => this.cancel(i.id)); }

  /** Retry all failed */
  retryAll() { this.queue.filter(i => i.status === UPLOAD_STATUS.FAILED).forEach(i => this.retry(i.id)); }
}

// Singleton
const uploadManager = new UploadManager();
export default uploadManager;
export { UploadItem };
