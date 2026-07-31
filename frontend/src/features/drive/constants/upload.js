/**
 * Upload lifecycle states
 */
export const UPLOAD_STATUS = {
  QUEUED: 'queued',
  UPLOADING: 'uploading',
  PAUSED: 'paused',
  RETRYING: 'retrying',
  SCANNING: 'scanning',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELED: 'canceled',
};

export const UPLOAD_STATUS_LABELS = {
  queued: 'في الانتظار',
  uploading: 'جاري الرفع',
  paused: 'متوقف',
  retrying: 'إعادة محاولة',
  scanning: 'فحص الملف',
  processing: 'معالجة',
  completed: 'تم الرفع',
  failed: 'فشل',
  canceled: 'ملغي',
};

export const UPLOAD_STATUS_COLORS = {
  queued: '#6B7280',
  uploading: '#3B82F6',
  paused: '#F59E0B',
  retrying: '#8B5CF6',
  scanning: '#8B5CF6',
  processing: '#8B5CF6',
  completed: '#10B981',
  failed: '#EF4444',
  canceled: '#6B7280',
};

/** Max retries per chunk */
export const MAX_CHUNK_RETRIES = 3;
/** Chunk size in bytes (5MB) — sent directly to Google Drive's resumable session, not our backend */
export const CHUNK_SIZE = 5 * 1024 * 1024;
/**
 * Files above this size skip the simple single-request upload to our own
 * backend and go straight to Drive via a resumable session instead. Vercel's
 * Node.js serverless functions hard-cap request bodies at ~4.5MB (platform
 * limit, not configurable) — confirmed empirically: a 4.0MB upload succeeds,
 * a 4.4MB upload 413s with FUNCTION_PAYLOAD_TOO_LARGE. 3MB leaves headroom
 * for multipart/form-data overhead on top of the raw file bytes.
 */
export const SIMPLE_UPLOAD_MAX_SIZE = 3 * 1024 * 1024;
/** Max queue items */
export const MAX_QUEUE_SIZE = 50;
/** Concurrent uploads */
export const MAX_CONCURRENT = 3;
/** Retry delay base (ms) */
export const RETRY_DELAY_MS = 2000;
