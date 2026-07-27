/**
 * Crypto utilities for FOIA OS — AES-256-GCM with key versioning.
 * 
 * KEY ROTATION:
 * 1. Set ENCRYPTION_KEY to a new 32+ char value
 * 2. Create a migration script that re-encrypts all existing records:
 *    - Decrypt with old key (from ENCRYPTION_KEY_PREVIOUS env)
 *    - Re-encrypt with new key
 * 3. Remove ENCRYPTION_KEY_PREVIOUS after full re-encryption
 * 
 * KEY VERSIONING:
 * Current format: "v1:{iv}:{tag}:{ciphertext}"
 * Future versions: "v2:{...}" with different algorithm/parameters
 * The decrypt function reads the version prefix to select the right key.
 */
const crypto = require('crypto');
const CONFIG = require('../config');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const CURRENT_VERSION = 'v1';

function getKey(version = 'v1') {
  let secret;
  if (version === 'v1') {
    secret = CONFIG.encryption?.secret || process.env.ENCRYPTION_KEY;
  } else if (version === 'v1_prev') {
    secret = process.env.ENCRYPTION_KEY_PREVIOUS;
  }
  if (!secret || secret.length < 32) {
    throw new Error(`ENCRYPTION_KEY${version !== 'v1' ? '_PREVIOUS' : ''} must be at least 32 characters`);
  }
  return crypto.scryptSync(secret, 'foia-os-salt-v1', 32);
}

function encrypt(plaintext) {
  if (!plaintext) return null;
  const key = getKey(CURRENT_VERSION);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${CURRENT_VERSION}:${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decrypt(encoded) {
  if (!encoded) return null;
  try {
    const parts = encoded.split(':');
    const version = parts[0];
    if (!version || !['v1'].includes(version)) return null;
    const key = getKey(version);
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const encrypted = parts.slice(3).join(':');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

module.exports = { encrypt, decrypt, CURRENT_VERSION };
