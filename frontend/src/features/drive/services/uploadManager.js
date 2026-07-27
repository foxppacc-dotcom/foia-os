/**
 * UploadManager — Enterprise upload queue with pause/resume/retry/cancel.
 * Provider-agnostic: works with any backend endpoint.
 */
import { API } from '../../../api';
import {
  UPLOAD_STATUS, MAX_CHUNK_RETRIES, CHUNK_SIZE,
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
      if (item.file.size > CHUNK_SIZE) {
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
          item.uploadedBytes = e.loaded;
          item.progress = Math.round((e.loaded / e.total) * 100);
          this._updateSpeed(item, e.loaded);
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

  /** Large file upload (chunked with retry per chunk) */
  async _chunkedUpload(item) {
    const file = item.file;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const token = localStorage.getItem('foia_token');

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
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
          const formData = new FormData();
          formData.append('file', chunk, file.name);
          formData.append('original_name', item.metadata.originalName || file.name);
          formData.append('file_type', item.metadata.fileType || 'document');
          formData.append('chunk_index', chunkIndex.toString());
          formData.append('total_chunks', totalChunks.toString());
          const res = await fetch(`${API}/cases/${item.caseId}/documents/chunk`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
          });
          if (!res.ok) throw new Error(`Chunk ${chunkIndex} failed`);
          item.uploadedBytes += chunk.size;
          item.progress = Math.round((item.uploadedBytes / item.totalBytes) * 100);
          this._updateSpeed(item, item.uploadedBytes);
          this._notify();
          break; // chunk uploaded
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
