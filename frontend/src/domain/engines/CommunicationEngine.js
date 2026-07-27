// FOIA OS v2 — CommunicationEngine
// Pure business logic for investigation communications (email, phone, portal, letter, meeting).

import { DomainEngine } from './engine';

const COMMUNICATION_TYPES = ['email', 'phone', 'portal', 'letter', 'meeting', 'internal'];
const DIRECTIONS = ['inbound', 'outbound'];
const STATUSES = ['sent', 'draft', 'failed', 'delivered', 'replied'];

class CommunicationEngineClass extends DomainEngine {
  constructor() {
    super('CommunicationEngine');
  }

  getTypes() { return [...COMMUNICATION_TYPES]; }

  getLabel(type, lang = 'ar') {
    const LABELS = {
      email: { ar: 'بريد إلكتروني', en: 'Email' },
      phone: { ar: 'مكالمة هاتفية', en: 'Phone Call' },
      portal: { ar: 'بوابة حكومية', en: 'Government Portal' },
      letter: { ar: 'خطاب رسمي', en: 'Official Letter' },
      meeting: { ar: 'اجتماع', en: 'Meeting' },
      internal: { ar: 'ملاحظة داخلية', en: 'Internal Note' },
    };
    return LABELS[type]?.[lang] || type;
  }

  validate(context = {}) {
    const errors = [];
    if (!context.type || !COMMUNICATION_TYPES.includes(context.type)) errors.push('Invalid communication type');
    if (!context.direction || !DIRECTIONS.includes(context.direction)) errors.push('Invalid direction');
    if (!context.investigationId) errors.push('Communication must belong to an investigation');
    return { valid: errors.length === 0, errors };
  }

  createTimelineEntry(comm) {
    const directionIcon = comm.direction === 'inbound' ? '📥' : '📤';
    const typeLabel = this.getLabel(comm.type);
    return {
      title: `${directionIcon} ${typeLabel} - ${comm.subject || 'No subject'}`,
      description: `${comm.direction === 'inbound' ? 'من' : 'إلى'}: ${comm.recipient || comm.sender || 'N/A'}`,
      timestamp: comm.sentAt || new Date().toISOString(),
      type: 'communication',
      communicationId: comm.id,
    };
  }

  shouldAutoFollowUp(lastCommDate, slaDays = 7) {
    if (!lastCommDate) return true;
    const last = new Date(lastCommDate);
    const now = new Date();
    const daysSince = Math.floor((now - last) / (1000 * 60 * 60 * 24));
    return daysSince > slaDays;
  }

  generateThreadSubject(baseSubject, sequence) {
    if (sequence <= 1) return baseSubject;
    const prefix = baseSubject.startsWith('Re:') ? '' : 'Re: ';
    return `${prefix}${baseSubject}`;
  }
}

export const CommunicationEngine = new CommunicationEngineClass();
