// FOIA OS v2 — AcquisitionEngine
// Business capability engine for Records Acquisition
// Wraps AgencyRequestEngine, CommunicationEngine, EvidenceEngine behind unified acquisition model
// Pure business logic. No React. No Express. No SQL. No HTTP.

import { DomainEngine } from './engine';

// ── Source Model (broader than Agency) ──
export const SOURCE_TYPES = [
  'government_agency',
  'court',
  'police_department',
  'municipality',
  'muckrock',
  'citizen',
  'witness',
  'internal_archive',
  'website',
  'cloud_repository',
  'other_investigation',
  'other',
];

export const SOURCE_LABELS = {
  government_agency: { ar: 'جهة حكومية', en: 'Government Agency' },
  court: { ar: 'محكمة', en: 'Court' },
  police_department: { ar: 'قسم شرطة', en: 'Police Department' },
  municipality: { ar: 'بلدية', en: 'Municipality' },
  muckrock: { ar: 'MuckRock', en: 'MuckRock' },
  citizen: { ar: 'مواطن', en: 'Citizen' },
  witness: { ar: 'شاهد', en: 'Witness' },
  internal_archive: { ar: 'أرشيف داخلي', en: 'Internal Archive' },
  website: { ar: 'موقع إلكتروني', en: 'Website' },
  cloud_repository: { ar: 'مستودع سحابي', en: 'Cloud Repository' },
  other_investigation: { ar: 'تحقيق آخر', en: 'Other Investigation' },
  other: { ar: 'أخرى', en: 'Other' },
};

// ── Acquisition Strategies ──
export const ACQUISITION_STRATEGIES = [
  { id: 'email', label: { ar: 'بريد إلكتروني', en: 'Direct Email' }, icon: '📧', adapter: 'Email' },
  { id: 'portal', label: { ar: 'بوابة حكومية', en: 'Government Portal' }, icon: '🌐', adapter: 'Portal' },
  { id: 'phone', label: { ar: 'مكالمة هاتفية', en: 'Phone Call' }, icon: '📞', adapter: 'Phone' },
  { id: 'muckrock', label: { ar: 'MuckRock', en: 'MuckRock' }, icon: '📋', adapter: 'MuckRock', future: true },
  { id: 'certified_mail', label: { ar: 'بريد مسجل', en: 'Certified Mail' }, icon: '📬', adapter: 'CertifiedMail', future: true },
  { id: 'manual_visit', label: { ar: 'زيارة يدوية', en: 'Manual Visit' }, icon: '🚶', adapter: 'ManualVisit', future: true },
  { id: 'api', label: { ar: 'API', en: 'API Integration' }, icon: '🔌', adapter: 'API', future: true },
];

export const ACQUISITION_STATUSES = [
  'planned',
  'in_progress',
  'awaiting_response',
  'follow_up_needed',
  'response_received',
  'evidence_linked',
  'completed',
  'failed',
];

const STATUS_LABELS = {
  planned: { ar: 'مخطط', en: 'Planned' },
  in_progress: { ar: 'قيد التنفيذ', en: 'In Progress' },
  awaiting_response: { ar: 'بانتظار الرد', en: 'Awaiting Response' },
  follow_up_needed: { ar: 'متابعة مطلوبة', en: 'Follow-up Needed' },
  response_received: { ar: 'تم الاستلام', en: 'Response Received' },
  evidence_linked: { ar: 'ربط الأدلة', en: 'Evidence Linked' },
  completed: { ar: 'مكتمل', en: 'Completed' },
  failed: { ar: 'فشل', en: 'Failed' },
};

const STATUS_URGENCY = {
  planned: 'neutral',
  in_progress: 'info',
  awaiting_response: 'warning',
  follow_up_needed: 'danger',
  response_received: 'accent',
  evidence_linked: 'success',
  completed: 'success',
  failed: 'danger',
};

class AcquisitionEngineClass extends DomainEngine {
  constructor() {
    super('AcquisitionEngine');
  }

  getSourceTypes() { return [...SOURCE_TYPES]; }
  getStrategies() { return ACQUISITION_STRATEGIES.filter(s => !s.future); }
  getAllStrategies() { return [...ACQUISITION_STRATEGIES]; }
  getStatuses() { return [...ACQUISITION_STATUSES]; }

  getSourceLabel(type, lang = 'ar') {
    return SOURCE_LABELS[type]?.[lang] || type;
  }

  getStrategyLabel(id, lang = 'ar') {
    const s = ACQUISITION_STRATEGIES.find(s => s.id === id);
    return s?.label[lang] || id;
  }

  getStatusLabel(status, lang = 'ar') {
    return STATUS_LABELS[status]?.[lang] || status;
  }

  getStatusUrgency(status) {
    return STATUS_URGENCY[status] || 'neutral';
  }

  getStrategyIcon(id) {
    return ACQUISITION_STRATEGIES.find(s => s.id === id)?.icon || '📄';
  }

  // ── Build an Acquisition Strategy for an Evidence item ──
  buildStrategy(evidenceItem, context = {}) {
    return {
      evidenceId: evidenceItem.id,
      recordType: evidenceItem.record_type,
      status: evidenceItem.evidence_stage === 'verified' ? 'completed'
             : evidenceItem.evidence_stage === 'received' ? 'response_received'
             : evidenceItem.evidence_stage === 'requested' ? 'in_progress'
             : evidenceItem.evidence_stage === 'waiting_review' ? 'awaiting_response'
             : 'planned',
      source: context.source || null,
      sourceType: context.sourceType || null,
      strategy: context.strategy || 'email',
      assignedTo: evidenceItem.assigned_to || context.assignedTo || null,
      dueDate: context.dueDate || null,
      lastActivity: context.lastActivity || null,
      nextAction: this.getNextAction(evidenceItem, context),
      documentCount: context.documentCount || 0,
      communicationCount: context.communicationCount || 0,
      requestCount: context.requestCount || 0,
    };
  }

  // ── Determine the next action for an evidence item ──
  getNextAction(evidenceItem, context = {}) {
    const stage = evidenceItem.evidence_stage || 'identified';
    if (stage === 'identified') return { action: 'acquire', label: 'بدء عملية الحصول', urgency: 'info' };
    if (stage === 'requested' || stage === 'waiting_review') {
      const days = context.daysWaiting || 0;
      if (days > 30) return { action: 'escalate', label: 'تصعيد الطلب', urgency: 'danger', days };
      if (days > 15) return { action: 'follow_up', label: 'متابعة', urgency: 'warning', days };
      return { action: 'wait', label: 'بانتظار الرد', urgency: 'neutral', days };
    }
    if (stage === 'received') return { action: 'verify', label: 'توثيق الاستلام', urgency: 'accent' };
    if (stage === 'verified') return { action: 'complete', label: 'مكتمل', urgency: 'success' };
    if (stage === 'rejected') return { action: 're_acquire', label: 'إعادة المحاولة', urgency: 'danger' };
    return { action: 'none', label: '—', urgency: 'neutral' };
  }

  // ── Build the complete acquisition workspace view ──
  buildWorkspace(evidenceItems = [], requests = [], communications = [], context = {}) {
    const missing = evidenceItems.filter(i =>
      !['verified', 'rejected', 'completed'].includes(i.evidence_stage || '')
    );
    const inProgress = evidenceItems.filter(i =>
      ['requested', 'waiting_review'].includes(i.evidence_stage || '')
    );
    const followUps = requests.filter(r =>
      ['sent', 'awaiting_response'].includes(r.status || '')
    );
    const incoming = communications.filter(c => c.direction === 'inbound');

    return {
      summary: {
        total: evidenceItems.length,
        missing: missing.length,
        inProgress: inProgress.length,
        completed: evidenceItems.filter(i => i.evidence_stage === 'verified').length,
        followUpsNeeded: followUps.length,
        incomingToday: incoming.filter(c => {
          if (!c.created_at) return false;
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const commDate = new Date(c.created_at);
          return commDate >= today;
        }).length,
      },
      items: evidenceItems.map(item => this.buildStrategy(item, {
        source: context.sourceMap?.[item.record_type]?.source,
        sourceType: context.sourceMap?.[item.record_type]?.sourceType,
        strategy: context.strategyMap?.[item.record_type] || 'email',
        assignedTo: item.assigned_to,
        lastActivity: context.lastActivityMap?.[item.record_type],
        documentCount: (context.documentMap?.[item.record_type] || []).length,
        communicationCount: (context.commMap?.[item.record_type] || []).length,
        requestCount: (context.requestMap?.[item.record_type] || []).length,
        daysWaiting: context.daysWaitingMap?.[item.record_type],
      })),
      missingRecords: missing.map(i => ({
        recordType: i.record_type,
        label: i.record_type_label || i.record_type,
        stage: i.evidence_stage || 'identified',
        assignedTo: i.assigned_to,
        nextAction: this.getNextAction(i, {}),
      })),
      activeRequests: followUps.map(r => ({
        id: r.id,
        agency: r.agency_name || r.agency_id,
        status: r.status,
        daysWaiting: r.days_waiting || 0,
        nextAction: r.status === 'sent' ? 'follow_up' : 'wait',
      })),
    };
  }
}

export const AcquisitionEngine = new AcquisitionEngineClass();
