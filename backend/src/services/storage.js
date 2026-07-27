/**
 * StorageService — unified file storage via Supabase Storage.
 * Replaces all local multer.diskStorage() calls.
 *
 * Buckets:
 *   case-documents  — uploaded case files (private, signed URLs)
 *   intake-files    — AI Intake uploads (private, signed URLs)
 *   agency-files    — agency Excel imports (private, signed URLs)
 *   public          — publicly accessible assets (public URLs)
 */
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const CONFIG = require('../config');

class StorageService {
  constructor() {
    this.initialized = false;
    this._ready = false;
    if (CONFIG.supabase.url && CONFIG.supabase.serviceKey) {
      this.supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.serviceKey);
      this._ready = true;
    } else {
      console.warn('⚠️ StorageService: SUPABASE_URL or SERVICE_KEY missing — storage disabled');
      this.supabase = null;
    }
  }

  _check() {
    if (!this._ready) throw new Error('StorageService not configured — check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }

  /**
   * Ensure required buckets exist. Called once at startup.
   */
  async ensureBuckets() {
    if (this.initialized) return;
    this._check();
    const required = [
      { name: 'case-documents', public: false },
      { name: 'intake-files', public: false },
      { name: 'agency-files', public: false },
      { name: 'public', public: true },
    ];
    for (const b of required) {
      const { data: existing } = await this.supabase.storage.getBucket(b.name);
      if (!existing) {
        const { error } = await this.supabase.storage.createBucket(b.name, { public: b.public });
        if (error) console.warn(`⚠️ Could not create bucket "${b.name}": ${error.message}`);
        else console.log(`✅ Created storage bucket: ${b.name}`);
      }
    }
    this.initialized = true;
  }

  /**
   * Upload a file buffer to Supabase Storage.
   * @param {string} bucket - bucket name
   * @param {string} filePath - path within bucket (e.g. 'case_63/uuid_filename.ext')
   * @param {Buffer|Uint8Array} buffer - file content
   * @param {string} mimeType - MIME type
   * @returns {Promise<string>} the storage key (bucket + path)
   */
  async upload(bucket, filePath, buffer, mimeType) {
    await this.ensureBuckets();
    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: true,
      });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    return `${bucket}/${filePath}`;
  }

  /**
   * Delete a file from Supabase Storage.
   * @param {string} bucket - bucket name
   * @param {string} filePath - path within bucket
   */
  async delete(bucket, filePath) {
    await this.ensureBuckets();
    const { error } = await this.supabase.storage
      .from(bucket)
      .remove([filePath]);
    if (error) console.warn(`⚠️ Storage delete failed: ${error.message}`);
  }

  /**
   * Delete by full storage key (e.g. "case-documents/case_63/file.png").
   * Parses bucket + path from the key.
   * @param {string} storageKey
   */
  async deleteByKey(storageKey) {
    if (!storageKey) return;
    const parts = storageKey.split('/');
    const bucket = parts[0];
    const filePath = parts.slice(1).join('/');
    if (bucket && filePath) {
      await this.delete(bucket, filePath);
    }
  }

  /**
   * Get a signed URL for temporary access to a private file.
   * @param {string} bucket
   * @param {string} filePath
   * @param {number} [expiresIn] - seconds (default: from config)
   * @returns {Promise<string|null>}
   */
  async getSignedUrl(bucket, filePath, expiresIn) {
    await this.ensureBuckets();
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUrl(filePath, expiresIn || CONFIG.storage.signedUrlExpiry);
    if (error || !data) return null;
    return data.signedUrl;
  }

  /**
   * Get a public URL for a publicly accessible file.
   * @param {string} bucket
   * @param {string} filePath
   * @returns {string}
   */
  getPublicUrl(bucket, filePath) {
    const { data } = this.supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);
    return data?.publicUrl || '';
  }

  /**
   * Parse a storage key to get just the URL (signed for private, public for public).
   * @param {string} storageKey - e.g., "case-documents/case_63/file.png"
   * @param {boolean} [isPublic=false]
   * @returns {Promise<string>}
   */
  async getUrl(storageKey, isPublic = false) {
    if (!storageKey) return '';
    const parts = storageKey.split('/');
    const bucket = parts[0];
    const filePath = parts.slice(1).join('/');
    if (isPublic) return this.getPublicUrl(bucket, filePath);
    return this.getSignedUrl(bucket, filePath) || '';
  }

  /**
   * Upload a file from an Express req.file (multer memoryStorage buffer).
   * Generates a unique path and returns { storageKey, path, url }.
   * @param {object} file - req.file from multer memoryStorage
   * @param {string} bucket
   * @param {string} subdir - e.g., "case_63"
   * @param {boolean} [isPublic=false]
   * @returns {Promise<{storageKey: string, path: string, url: string}>}
   */
  async uploadFromRequest(file, bucket, subdir, isPublic = false) {
    const ext = path.extname(file.originalname) || '.bin';
    const uniqueName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    const storagePath = `${subdir}/${uniqueName}`;

    const storageKey = await this.upload(
      bucket,
      storagePath,
      file.buffer,
      file.mimetype,
    );

    const url = isPublic
      ? this.getPublicUrl(bucket, storagePath)
      : await this.getSignedUrl(bucket, storagePath);

    return { storageKey, path: storagePath, url };
  }
}

// Singleton
const instance = new StorageService();
module.exports = instance;
