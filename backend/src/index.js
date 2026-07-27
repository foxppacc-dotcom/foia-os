const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { getSupabase } = require('./supabase');
const CONFIG = require('./config');
const storage = require('./services/storage');

const app = express();
const PORT = CONFIG.server.port;

// Initialize Supabase (skip on Vercel — created lazily on first request)
if (process.env.NODE_ENV !== 'production') {
  getSupabase();
  console.log('✅ Connected to Supabase');
}

// Initialize storage buckets (skip heavy init on serverless cold start)
if (process.env.NODE_ENV !== 'production') {
  storage.ensureBuckets().then(() => {
    console.log('✅ Storage buckets ready');
  }).catch(e => console.warn('⚠️ Storage init:', e.message));
}

// Performance & Security middleware
app.set('trust proxy', 1); // Trust Vercel's proxy for rate-limit X-Forwarded-For
app.use(compression());
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const allowedOrigins = [
  'http://localhost:5173', 'http://localhost:5174',
  'http://localhost:4001',
  'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://127.0.0.1:4001',
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : []),
].filter(Boolean);
// CORS
app.use(cors({ origin: allowedOrigins, credentials: true }));

// Body parsing (json only — multipart handled by multer per-route)
app.use((req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const ct = req.headers['content-type'] || '';
    if (ct.includes('application/json')) {
      express.json({ limit: '10mb' })(req, res, next);
    } else if (ct.includes('application/x-www-form-urlencoded')) {
      express.urlencoded({ extended: true })(req, res, next);
    } else {
      next();
    }
  } else {
    next();
  }
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', limiter);

// Health endpoint (accessible without auth)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes
app.use('/api', require('./routes/auth'));

// All routes
app.use('/api', require('./routes/cases'));
app.use('/api', require('./routes/requests'));
app.use('/api', require('./routes/pipeline'));
app.use('/api', require('./routes/agencies'));
app.use('/api', require('./routes/communications'));
app.use('/api', require('./routes/documents'));
app.use('/api', require('./routes/dashboard'));
app.use('/api', require('./routes/intake'));
app.use('/api', require('./routes/email'));
app.use('/api', require('./routes/aiAssistant'));
app.use('/api', require('./routes/users'));
app.use('/api', require('./routes/automation'));
app.use('/api/gdrive', require('./routes/gdrive'));
app.use('/api/checklist', require('./routes/checklist'));
app.use('/api', require('./routes/phoneAndMail'));
app.use('/api', require('./routes/portals'));
app.use('/api', require('./routes/production'));
app.use('/api', require('./routes/classifier'));
app.use('/api', require('./routes/settings'));
app.use('/api', require('./routes/assignees'));
app.use('/api', require('./routes/activity'));
app.use('/api', require('./routes/pipelineLists'));
app.use('/api', require('./routes/team.routes'));
app.use('/api', require('./routes/case_detail.routes'));
app.use('/api', require('./routes/teams'));
app.use('/api', require('./routes/permissions'));
app.use('/api', require('./routes/teamManagement'));
app.use('/api', require('./routes/documentCenter'));
// emailProduction — lazy nodemailer import to avoid serverless crash
app.use('/api', require('./routes/emailProduction'));
// Temporary migration endpoint (remove after running)
app.use('/api', require('./routes/migration'));
// Production cleanup endpoint (admin only)
app.use('/api', require('./routes/cleanup'));

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Start server only when running locally (not on Vercel serverless)
// On Vercel, module.exports = app is used via @vercel/node build
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`FOIA OS Backend running on http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
  });
}

module.exports = app;
