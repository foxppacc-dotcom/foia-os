const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { getSupabase } = require('./supabase');
const CONFIG = require('./config');
const storage = require('./services/storage');

const app = express();
app.use(cors());
const PORT = CONFIG.server.port;

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// All routes
const routes = [
  'auth', 'cases', 'requests', 'pipeline', 'agencies', 'communications',
  'dashboard', 'intake', 'email', 'emailProduction', 'aiAssistant', 'users',
  'automation', 'gdrive', 'phoneAndMail', 'portals', 'production',
  'settings', 'activity', 'classifier', 'cleanup', 'migration',
  'case_detail.routes', 'checklist', 'assignees', 'teamManagement', 'team.routes',
  'teams', 'permissions', 'pipelineLists', 'cron',
];

// Try each route, skip if it fails
const working = [];
const failed = [];
for (const name of routes) {
  try {
    const route = require(`./routes/${name}`);
    if (route) {
      app.use('/api', route);
      working.push(name);
    }
  } catch (e) {
    failed.push({ name, error: e.message });
  }
}

// Also try documentCenter
try {
  const docCenter = require('./routes/documentCenter');
  if (docCenter) app.use('/api', docCenter);
  working.push('documentCenter');
} catch (e) {
  failed.push({ name: 'documentCenter', error: e.message });
}

app.get('/api/debug/routes', (req, res) => {
  res.json({ working, failed, totalRoutes: routes.length + 1 });
});

module.exports = app;
