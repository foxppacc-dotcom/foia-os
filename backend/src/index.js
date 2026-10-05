const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { getSupabase } = require('./supabase');
const CONFIG = require('./config');
const storage = require('./services/storage');
const { requireAuth, requireRole } = require('./middleware/auth');

const app = express();
// Behind Traefik/nginx on the VPS -- without this, express-rate-limit (used
// for login/chat throttling below and elsewhere) sees the proxy's own
// address as req.ip for every request instead of the real client, either
// merging every user into one shared bucket or, depending on the installed
// express-rate-limit version's own X-Forwarded-For validation, refusing to
// start at all when it detects that header with no trust-proxy configured.
app.set('trust proxy', 1);
// helmet was already a dependency (required below) but never actually
// applied anywhere -- the app was sending no CSP/HSTS/X-Frame-Options/etc.
// at all. contentSecurityPolicy is left off here rather than guessed at: a
// misconfigured CSP silently breaks real functionality (Google OAuth
// popups, the AI provider fetches, Drive embeds) in ways that are hard to
// diagnose from the frontend alone -- the other headers helmet sets by
// default are safe, additive hardening with no such risk.
app.use(helmet({ contentSecurityPolicy: false }));
// Wide-open cors() (reflects any Origin, allows credentialed requests from
// anywhere) narrowed to the real frontend origin(s) once CORS_ORIGIN is set
// (see config.js) -- falls back to the previous wide-open behavior only
// when that env var is genuinely unset, so an environment that hasn't
// configured it yet doesn't break.
app.use(cors(CONFIG.cors.origins.length ? { origin: CONFIG.cors.origins, credentials: true } : {}));
const PORT = CONFIG.server.port;

// Previously a hardcoded {status:'ok'} with no real dependency check -- it
// would report healthy even with Supabase completely unreachable, which
// defeats the point of a health endpoint for any future uptime monitor.
app.get('/api/health', async (req, res) => {
  try {
    const sup = getSupabase();
    const { error } = await sup.from('users').select('id').limit(1);
    if (error) throw error;
    res.json({ status: 'ok', database: 'ok', timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: 'degraded', database: 'unreachable', error: e.message, timestamp: new Date().toISOString() });
  }
});

// Last-resort guards: an async route/handler that throws outside a try/catch (Express 4
// does not catch those) or a library emitting an unhandled 'error' event must not take
// the whole backend down for every employee. Log loudly and keep serving.
process.on('unhandledRejection', (reason) => { console.error('[unhandledRejection]', reason && reason.stack ? reason.stack : reason); });
process.on('uncaughtException', (err) => { console.error('[uncaughtException]', err && err.stack ? err.stack : err); });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// All routes
const routes = [
  'auth', 'cases', 'requests', 'pipeline', 'agencies', 'communications',
  'dashboard', 'intake', 'email', 'emailProduction', 'aiAssistant', 'users',
  'automation', 'gdrive', 'phoneAndMail', 'portals', 'production',
  'settings', 'activity', 'classifier',
  'case_detail.routes', 'checklist', 'assignees', 'teamManagement', 'team.routes',
  'teams', 'permissions', 'pipelineLists', 'pipelineListMeta', 'aiTasks', 'forum', 'fileFetch', 'activityTracking',
  'trash', 'search', 'messages',
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
// Was reachable by anyone on the public internet with no gate at all --
// `failed` includes each broken router's raw error.message (missing env
// vars, module load failures), which is internal service/config health
// nobody outside the team should see. Unlike the OAuth callback / cron
// routes above, this one is only ever meant to be opened by an admin
// actually using the app -- they always have a real Bearer JWT, so it can
// use the normal requireAuth/requireRole gate directly (registering it
// here, ahead of the other routers, is only so it can see the `working`/
// `failed` closure variables populated below -- unrelated to auth).
app.get('/api/debug/routes', requireAuth, requireRole('admin'), (req, res) => {
  res.json({ working, failed, totalRoutes: routes.length + 2 });
});
try {
  const gdriveRoute = require('./routes/gdrive');
  if (gdriveRoute && gdriveRoute.oauthCallbackHandler) {
    app.get('/api/gdrive/oauth-callback', gdriveRoute.oauthCallbackHandler);
  }
  // Same reasoning as oauth-callback above: an <img src> can never carry our
  // Bearer token, so this must resolve before cases.js's blanket
  // `router.use(requireAuth)` (no path) can intercept and 401 it first.
  if (gdriveRoute && gdriveRoute.imageProxyHandler) {
    app.get('/api/gdrive/image/:fileId', gdriveRoute.imageProxyHandler);
  }
} catch (e) {
  console.error('[index] gdrive oauth-callback mount failed:', e.message);
}
try {
  // FileFetch's public upload endpoints -- an external agency with a link
  // has no account and can never carry a Bearer token, same reasoning as
  // the gdrive block above. Must resolve before cases.js's blanket
  // requireAuth would otherwise 401 every request that reaches it first.
  const fileFetchRoute = require('./routes/fileFetch');
  if (fileFetchRoute.publicLinkInfoHandler) {
    app.get('/api/public/upload/:token', fileFetchRoute.publicUploadLimiter, fileFetchRoute.publicLinkInfoHandler);
    app.post('/api/public/upload/:token/session', fileFetchRoute.publicUploadLimiter, fileFetchRoute.publicUploadSessionHandler);
    app.post('/api/public/upload/:token/finalize', fileFetchRoute.publicUploadLimiter, fileFetchRoute.publicUploadFinalizeHandler);
    app.get('/api/public/upload/:token/status', fileFetchRoute.publicUploadLimiter, fileFetchRoute.publicUploadStatusHandler);
    app.post('/api/public/upload/:token/note', fileFetchRoute.publicUploadLimiter, fileFetchRoute.publicUploadNoteHandler);
    if (fileFetchRoute.publicUploadFileRoute) {
      app.post('/api/public/upload/:token/upload-file', fileFetchRoute.publicUploadLimiter, fileFetchRoute.publicUploadFileRoute);
    }
  }
} catch (e) {
  console.error('[index] fileFetch public routes mount failed:', e.message);
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
