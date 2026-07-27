/**
 * DomainEvents — Lightweight publish/subscribe for cross-module communication.
 *
 * Feature modules emit events (e.g. "request.added") and other modules
 * subscribe to react without direct coupling.
 *
 * Usage:
 *   import domainEvents from '../../domain/events/DomainEvents';
 *   // Subscribe
 *   const unsub = domainEvents.on('case.updated', (payload) => refetch());
 *   // Emit
 *   domainEvents.emit('request.added', { caseId: 123, requestId: 456 });
 *   // Unsubscribe
 *   unsub();
 */

class DomainEvents {
  constructor() {
    this._listeners = new Map();
    this._eventHistory = [];
  }

  /**
   * Subscribe to a domain event.
   * @param {string} event — Event name (e.g. 'case.updated', 'document.uploaded')
   * @param {Function} fn — Handler receiving payload
   * @returns {Function} — Call to unsubscribe
   */
  on(event, fn) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(fn);
    return () => this._listeners.get(event)?.delete(fn);
  }

  /**
   * Subscribe for one invocation only.
   */
  once(event, fn) {
    const wrapper = (payload) => {
      fn(payload);
      this._listeners.get(event)?.delete(wrapper);
    };
    return this.on(event, wrapper);
  }

  /**
   * Emit a domain event to all subscribers.
   * @param {string} event
   * @param {*} payload
   */
  emit(event, payload) {
    const handlers = this._listeners.get(event);
    if (handlers) {
      handlers.forEach(fn => {
        try { fn(payload); } catch (e) { console.error('[DomainEvents] Handler error:', e); }
      });
    }
    // Keep last 50 events for debugging
    this._eventHistory.push({ event, payload, time: Date.now() });
    if (this._eventHistory.length > 50) this._eventHistory.shift();
  }

  /** Clear all subscriptions (for testing) */
  clear() { this._listeners.clear(); this._eventHistory = []; }

  /** Recent event history for debugging */
  get history() { return [...this._eventHistory]; }
}

const domainEvents = new DomainEvents();
export default domainEvents;
