// Minimal, no-op service worker. Its only purpose is satisfying the
// installability requirement some browsers still check for the PWA
// "install app" / "add to home screen" prompt (beforeinstallprompt) --
// it deliberately does NOT cache anything or intercept requests, since this
// app is not meant to work offline and a caching layer here would risk
// serving stale API responses or an outdated build to real users.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
