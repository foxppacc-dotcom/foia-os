/**
 * UploadManager — Enterprise upload queue with pause/resume/retry/cancel.
 * Provider-agnostic: works with any backend endpoint.
 */
import { API } from '../../../api';
import {
  UPLOAD_STATUS, MAX_CHUNK_RETRIES, MAX_QUEUE_SIZE, MAX_CONCURRENT, RETRY_DELAY_MS,
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
    // Baseline for this attempt's speed calc -- resuming a paused chunked
    // upload (or retrying) must measure bytes moved SINCE THIS ATTEMPT, not
    // since the file's original start, or the bar reports an instant,
    // physically-impossible speed the moment it resumes (e.g. 40MB already
    // uploaded before a pause, divided by the ~0.1s since resume = "400 MB/s").
    item.uploadedBytesAtStart = item.uploadedBytes;
    item.abortController = new AbortController();
    this._notify();

    try {
      await this._uploadToServer(item);
      item.status = UPLOAD_STATUS.PROCESSING;
      this._notify();
      await new Promise(r => setTimeout(r, 300)); // brief processing step
      item.status = UPLOAD_STATUS.COMPLETED;
      item.progress = 100;
      item.completedAt = Date.now();
    } catch (err) {
      if (err.name === 'AbortError') {
        // pause()/cancel() already set the definitive status synchronously
        // (PAUSED or CANCELED) before aborting -- don't clobber a pause with
        // "canceled" just because aborting the request throws the same
        // AbortError either way.
        if (item.status !== UPLOAD_STATUS.PAUSED && item.status !== UPLOAD_STATUS.CANCELED) {
          item.status = UPLOAD_STATUS.CANCELED;
        }
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

  /**
   * Upload the whole file to our own server in one request (any size), which
   * relays it to Drive server-to-server and deletes its local temp copy the
   * moment Drive confirms success. Replaces the old design (browser PUTs
   * chunks directly to Drive's own resumable endpoint) -- confirmed live
   * that a real upload attempt failed with a generic cross-origin
   * `net::ERR_FAILED` reaching googleapis.com directly from the browser, on
   * a session a direct server-to-server PUT of the same bytes completed
   * instantly. Routing through our own domain (same-origin, already proven
   * reliable) removes that entire class of failure. XHR (not fetch) so
   * upload progress against OUR server is tracked continuously via
   * xhr.upload.onprogress, giving smoother, more accurate readings than the
   * old fixed 5MB-chunk-boundary updates.
   */
  async _uploadToServer(item) {
    const formData = new FormData();
    formData.append('file', item.file);
    formData.append('case_id', item.caseId);
    formData.append('original_name', item.metadata.originalName || item.file.name);
    formData.append('file_type', item.metadata.fileType || 'document');
    formData.append('description', item.metadata.description || '');
    formData.append('category', item.metadata.category || 'attachments');
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
        else {
          let message = xhr.responseText || `HTTP ${xhr.status}`;
          try { message = JSON.parse(xhr.responseText).error || message; } catch { /* not JSON */ }
          reject(new Error(message));
        }
      };
      xhr.onerror = () => reject(new Error('خطأ شبكة أثناء الرفع'));
      // Without this, calling xhr.abort() (pause()/cancel()) never fires
      // onload or onerror -- the promise just hangs forever, silently
      // orphaning the whole _uploadItem() chain (and permanently leaking one
      // activeCount slot every time).
      xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
      xhr.open('POST', `${API}/gdrive/upload-file`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });
  }

  /** Calculate upload speed and ETA, measured against THIS attempt only --
   *  using bytes-since-file-started would report an instant, impossible
   *  speed right after a resume (all the bytes uploaded before the pause,
   *  divided by the ~0.1s since resume). A short elapsed-time floor also
   *  keeps the very first tick of any attempt from spiking on tiny timers. */
  _updateSpeed(item, loadedBytes) {
    const elapsed = (Date.now() - item.startedAt) / 1000;
    const bytesThisAttempt = loadedBytes - (item.uploadedBytesAtStart || 0);
    item.speed = elapsed > 0.2 ? bytesThisAttempt / elapsed : (item.speed || 0);
    const remaining = item.totalBytes - loadedBytes;
    item.eta = item.speed > 0 ? remaining / item.speed : 0;
  }

  /** Pause an upload. activeCount is deliberately left untouched here -- the
   *  SAME .finally() that incremented it (in _processQueue, or resume() for a
   *  restarted simple upload) is the only thing that ever decrements it, once
   *  the aborted request's promise actually settles. Adjusting it here too
   *  used to double-count against that .finally() for a simple upload (whose
   *  abort now properly rejects), or never get released at all for a chunked
   *  upload's between-chunks pause (whose chain doesn't finish until later)
   *  -- both drift the count until the queue silently stops starting new
   *  items once enough pauses/cancels/resumes had happened in a session. */
  pause(id) {
    const item = this.queue.find(i => i.id === id);
    if (item && (item.status === UPLOAD_STATUS.UPLOADING || item.status === UPLOAD_STATUS.QUEUED)) {
      item.status = UPLOAD_STATUS.PAUSED;
      if (item.abortController) item.abortController.abort();
      this._notify();
    }
  }

  /** Resume a paused upload */
  resume(id) {
    const item = this.queue.find(i => i.id === id);
    if (item && item.status === UPLOAD_STATUS.PAUSED) {
      item.abortController = new AbortController();
      // A pause fully aborts the one in-flight request (no partial-resume
      // possible for a single whole-file POST), or the item was paused
      // before it ever started. Rejoin the same managed queue every fresh
      // item uses so activeCount/MAX_CONCURRENT bookkeeping stays correct
      // instead of force-starting a 4th+ upload.
      item.status = UPLOAD_STATUS.QUEUED;
      this._notify();
      this._processQueue();
    }
  }

  /** Cancel an upload */
  cancel(id) {
    const item = this.queue.find(i => i.id === id);
    if (item) {
      item.status = UPLOAD_STATUS.CANCELED;
      if (item.abortController) item.abortController.abort();
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
