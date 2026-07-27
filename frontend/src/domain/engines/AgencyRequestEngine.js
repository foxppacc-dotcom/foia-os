// FOIA OS v2 — AgencyRequestEngine
// Pure business logic for agency request lifecycle and follow-up scheduling.

import { DomainEngine } from './engine';

const REQUEST_STATUSES = ['draft', 'sent', 'awaiting_response', 'follow_up', 'response_received', 'evidence_linked', 'closed'];

const REQUEST_CHANNELS = ['email', 'letter', 'portal', 'phone', 'meeting'];

const DEFAULT_SLA_DAYS = 15;

const STATUS_LABELS = {
  draft: { ar: 'مسودة', en: 'Draft' },
  sent: { ar: 'أرسلت', en: 'Sent' },
  awaiting_response: { ar: 'بانتظار الرد', en: 'Awaiting Response' },
  follow_up: { ar: 'متابعة', en: 'Follow-up' },
  response_received: { ar: 'وصل الرد', en: 'Response Received' },
  evidence_linked: { ar: 'ربط الأدلة', en: 'Evidence Linked' },
  closed: { ar: 'مغلق', en: 'Closed' },
};

class AgencyRequestEngineClass extends DomainEngine {
  constructor() {
    super('AgencyRequestEngine');
    this.addValidator(ctx => {
      if (!ctx.agencyId) return 'Agency is required';
      return true;
    });
    this.addValidator(ctx => {
      if (!ctx.channel || !REQUEST_CHANNELS.includes(ctx.channel)) return 'Invalid channel';
      return true;
    });
  }

  getStatuses() { return [...REQUEST_STATUSES]; }
  getChannels() { return [...REQUEST_CHANNELS]; }

  getLabel(status, lang = 'ar') {
    return STATUS_LABELS[status]?.[lang] || status;
  }

  calculateNextFollowUp(sentDate, slaDays = DEFAULT_SLA_DAYS) {
    const sent = new Date(sentDate);
    const due = new Date(sent);
    due.setDate(due.getDate() + Math.ceil(slaDays * 0.7)); // First follow-up at 70% of SLA
    return due.toISOString().split('T')[0];
  }

  calculateDaysWaiting(sentDate) {
    const sent = new Date(sentDate);
    const now = new Date();
    return Math.floor((now - sent) / (1000 * 60 * 60 * 24));
  }

  isOverdue(sentDate, slaDays = DEFAULT_SLA_DAYS) {
    return this.calculateDaysWaiting(sentDate) > slaDays;
  }

  isEscalationRequired(sentDate, escalationDays = 30) {
    return this.calculateDaysWaiting(sentDate) > escalationDays;
  }

  nextAction(context = {}) {
    const { status, sentDate, followUpDate } = context;
    if (status === 'draft') return { action: 'send', urgency: 'info' };
    if (status === 'sent' || status === 'awaiting_response') {
      const waiting = this.calculateDaysWaiting(sentDate);
      if (this.isEscalationRequired(sentDate)) return { action: 'escalate', urgency: 'danger', days: waiting };
      if (this.isOverdue(sentDate)) return { action: 'follow_up', urgency: 'warning', days: waiting };
      return { action: 'wait', urgency: 'neutral', days: waiting };
    }
    if (status === 'follow_up') return { action: 'follow_up', urgency: 'warning' };
    if (status === 'response_received') return { action: 'link_evidence', urgency: 'accent' };
    return { action: 'none', urgency: 'neutral' };
  }

  transition(current, target, context = {}) {
    const validTransitions = {
      draft: ['sent'],
      sent: ['awaiting_response', 'follow_up'],
      awaiting_response: ['follow_up', 'response_received'],
      follow_up: ['awaiting_response', 'response_received'],
      response_received: ['evidence_linked'],
      evidence_linked: ['closed'],
      closed: ['sent'], // Reopen
    };

    const allowed = validTransitions[current] || [];
    if (!allowed.includes(target)) {
      return { success: false, error: `Cannot transition from ${current} to ${target}` };
    }
    return { success: true, status: target };
  }
}

export const AgencyRequestEngine = new AgencyRequestEngineClass();
