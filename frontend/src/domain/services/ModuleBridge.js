/**
 * ModuleBridge — Coordinates data refresh across feature modules.
 *
 * When one module mutates data (e.g. Request module adds a request),
 * it calls ModuleBridge.notify() which triggers subscribers.
 * Each module subscribes with its own refetch function.
 */

import domainEvents from '../events/DomainEvents';

const DOMAIN_EVENTS = {
  CASE_UPDATED: 'case.updated',
  REQUEST_ADDED: 'request.added',
  REQUEST_REMOVED: 'request.removed',
  REQUEST_CLASSIFIED: 'request.classified',
  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_DELETED: 'document.deleted',
  TEAM_CHANGED: 'team.changed',
  CHECKLIST_UPDATED: 'checklist.updated',
};

class ModuleBridge {
  /**
   * Subscribe to refresh events for a specific case.
   * @param {number|string} caseId
   * @param {Function} refetchFn — Called as refetchFn(silent) when any related module changes
   * @returns {Function} unsubscribe
   */
  subscribeCase(caseId, refetchFn) {
    const events = Object.values(DOMAIN_EVENTS);
    const unsubscribers = events.map(event =>
      domainEvents.on(event, (payload) => {
        if (payload && payload.caseId !== undefined && String(payload.caseId) !== String(caseId)) return;
        refetchFn(true); // silent refresh
      })
    );
    // Also subscribe to case-specific event
    const caseEvent = `case:${caseId}`;
    const caseUnsub = domainEvents.on(caseEvent, () => refetchFn(true));
    unsubscribers.push(caseUnsub);
    return () => unsubscribers.forEach(unsub => unsub());
  }

  /**
   * Notify that something changed in a case.
   * All subscribers for that caseId will silently refresh.
   */
  static notifyCaseChanged(caseId, source) {
    domainEvents.emit(source, { caseId });
  }

  static get events() { return DOMAIN_EVENTS; }
}

export { ModuleBridge, DOMAIN_EVENTS };
