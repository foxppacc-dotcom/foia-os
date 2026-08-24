// Captures the browser's `beforeinstallprompt` event as early as possible
// (imported once from main.jsx, before any route renders) so it isn't lost
// if it fires before the install button's page (Forum) has even mounted --
// the event only fires once per page load and there is no way to re-request
// it later.
let deferredPrompt = null;
const listeners = new Set();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    listeners.forEach((cb) => cb(deferredPrompt));
  });
  // Once installed, the prompt can never fire again for this session --
  // clearing it lets the UI reflect "already installed" instead of holding
  // a stale, now-useless reference.
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    listeners.forEach((cb) => cb(null));
  });
}

export function getDeferredInstallPrompt() {
  return deferredPrompt;
}

// Returns an unsubscribe function, same convention as every other
// subscribe-style helper in this codebase (e.g. useEffect cleanup).
export function onInstallPromptChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
}
