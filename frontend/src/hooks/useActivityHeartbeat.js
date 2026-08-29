import { useEffect, useRef } from 'react';
import { api } from '../api';

const TICK_MS = 30_000;
const FLUSH_EVERY_N_TICKS = 2; // ~60s between network flushes
const IDLE_MS = 4 * 60_000; // stop accumulating after 4 min with no real input

// Real in-app active-usage time, not just "tab is open" -- accumulates
// locally in 30s ticks (only while the tab is actually visible AND the
// user did something recently), flushes to the backend roughly every
// minute, and force-flushes on tab-hide/unload so a quick visit isn't lost
// waiting for the next scheduled flush. Mounted once for the whole
// authenticated session (see App.jsx), not per-page, so navigating between
// pages never resets or double-counts it.
export default function useActivityHeartbeat(enabled) {
  const lastActionAt = useRef(Date.now());
  const pendingSeconds = useRef(0);
  const tickCount = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const markActive = () => { lastActionAt.current = Date.now(); };
    const events = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'];
    events.forEach(e => window.addEventListener(e, markActive, { passive: true }));

    const flush = () => {
      const seconds = pendingSeconds.current;
      if (!seconds) return;
      pendingSeconds.current = 0;
      // Best-effort -- a lost heartbeat is an approximate metric losing a
      // minute of precision, never something the user is waiting on.
      api.post('/activity/heartbeat', { seconds }).catch(() => {});
    };

    const tick = () => {
      const isVisible = document.visibilityState === 'visible';
      const isIdle = Date.now() - lastActionAt.current > IDLE_MS;
      if (isVisible && !isIdle) pendingSeconds.current += TICK_MS / 1000;
      tickCount.current += 1;
      if (tickCount.current % FLUSH_EVERY_N_TICKS === 0) flush();
    };
    const interval = setInterval(tick, TICK_MS);

    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    // sendBeacon can't carry the Authorization header this API needs, so a
    // keepalive fetch is used instead -- not guaranteed to complete after
    // the page is gone, but best-effort is the right tradeoff for a
    // background usage metric, not worth a bespoke unauthenticated endpoint.
    const onPageHide = () => {
      const seconds = pendingSeconds.current;
      if (!seconds) return;
      pendingSeconds.current = 0;
      fetch('/api/activity/heartbeat', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('foia_token') || ''}` },
        body: JSON.stringify({ seconds }),
      }).catch(() => {});
    };
    window.addEventListener('pagehide', onPageHide);

    return () => {
      events.forEach(e => window.removeEventListener(e, markActive));
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      flush();
    };
  }, [enabled]);
}
