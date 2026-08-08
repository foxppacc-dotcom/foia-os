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
  'teams', 'permissions', 'pipelineLists',
];

// Diagnostics and truly-public callbacks (no user Bearer token possible) must be
// registered here, BEFORE the per-feature routers below. Several of those
// routers call `router.use(requireAuth)` with no path restriction, and since
// every router is mounted at the same '/api' prefix, the first one reached
// intercepts ANY /api/* request that hasn't already matched an earlier layer
// — including paths that router doesn't itself define. Google's OAuth
// redirect can never carry our Bearer token, so /gdrive/oauth-callback must
// resolve here before it can hit one of those routers and 401.
//
// cron.js is the same story and was previously listed LAST in `routes` above
// -- meaning 'cases' (2nd in the list, right after 'auth') intercepted every
// single /api/cron/* request first with its own blanket requireAuth, and
// rejected it as 401 before cron.js's own CRON_SECRET check ever ran.
// Confirmed live: /api/cron/imap-poll and /api/cron/deadline-check both
// returned "Unauthorized - missing token" even with no test changes to
// either route -- Vercel's actual scheduled invocations (Authorization:
// Bearer <CRON_SECRET>, never a valid signed JWT) would have failed the
// exact same way every single time they fired. Registered here instead so
// it resolves before any blanket-requireAuth router can shadow it.
const working = [];
const failed = [];
app.get('/api/debug/routes', (req, res) => {
  res.json({ working, failed, totalRoutes: routes.length + 2 });
});
try {
  const gdriveRoute = require('./routes/gdrive');
  if (gdriveRoute && gdriveRoute.oauthCallbackHandler) {
    app.get('/api/gdrive/oauth-callback', gdriveRoute.oauthCallbackHandler);
  }
} catch (e) {
  console.error('[index] gdrive oauth-callback mount failed:', e.message);
}
try {
  app.use('/api', require('./routes/cron'));
  working.push('cron');
} catch (e) {
  failed.push({ name: 'cron', error: e.message });
}

// Try each route, skip if it fails
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

module.exports = app;
