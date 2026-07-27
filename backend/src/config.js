/**
 * Safe environment config — all secrets from env vars, NO hardcoded fallbacks.
 */
// Load .env file in development
try {
  const path = require('path');
  const fs = require('fs');
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
} catch(e) {}

const CONFIG = {
  supabase: {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },
  jwt: {
    secret: process.env.JWT_SECRET || '',
  },
  storage: {
    signedUrlExpiry: parseInt(process.env.STORAGE_SIGNED_URL_EXPIRY || '3600', 10), // 1 hour
    publicBucket: process.env.STORAGE_PUBLIC_BUCKET || 'public',
  },
  server: {
    port: parseInt(process.env.PORT || '4001', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  app: {
    url: process.env.APP_URL || process.env.VITE_APP_URL || 'http://localhost:4001',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || '',
    rootFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER || '',
  },
  encryption: {
    secret: process.env.ENCRYPTION_KEY || '',
  },
};

// Validate critical secrets at startup
function validate() {
  const missing = [];
  if (!CONFIG.supabase.url) missing.push('SUPABASE_URL');
  if (!CONFIG.supabase.serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!CONFIG.jwt.secret) missing.push('JWT_SECRET');
  if (missing.length > 0) {
    console.warn(`⚠️ Missing environment variables: ${missing.join(', ')}`);
    console.warn('   The server may not start correctly without these.');
  }
}

validate();

module.exports = CONFIG;
