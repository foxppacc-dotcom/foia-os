// FOIA OS v2 — EvidenceEngine
// Pure business logic. No React, No Express, No SQL, No HTTP.
// Evidence is THE PRIMARY OPERATIONAL OBJECT of FOIA OS.

import { DomainEngine, validateLinearTransition } from './engine';

const STAGES = ['identified', 'requested', 'waiting_review', 'received', 'verified'];
const EXCEPTION_STAGES = ['rejected'];

const ALL_STAGES = [...STAGES, ...EXCEPTION_STAGES];

const STAGE_LABELS = {
  identified: { ar: 'تم التحديد', en: 'Identified' },
  requested: { ar: 'تم الطلب', en: 'Requested' },
  waiting_review: { ar: 'بانتظار المراجعة', en: 'Waiting Review' },
  received: { ar: 'تم الاستلام', en: 'Received' },
  verified: { ar: 'موثق', en: 'Verified' },
  rejected: { ar: 'مرفوض', en: 'Rejected' },
};

// Business rules for auto transitions
const AUTO_TRANSITIONS = {
  request_sent: { from: '*', to: 'requested' },
  email_received: { from: 'requested', to: 'waiting_review' },
  file_uploaded: { from: '*', to: 'received' },
  investigator_verified: { from: 'received', to: 'verified' },
  agency_rejected: { from: '*', to: 'rejected' },
};

class EvidenceEngineClass extends DomainEngine {
  constructor() {
    super('EvidenceEngine');
  }

  getStages() { return [...STAGES]; }
  getAllStages() { return [...ALL_STAGES]; }

  getLabel(stage, lang = 'ar') {
    return STAGE_LABELS[stage]?.[lang] || stage;
  }

  canTransition(current, target, context = {}) {
    const allStages = [...STAGES, ...EXCEPTION_STAGES];
    const linear = validateLinearTransition(current, target, allStages, true);
    if (!linear.valid) return linear;

    if (target === 'verified') {
      if (!context.hasDocument) {
        return { valid: false, reason: 'Cannot verify without linked document' };
      }
    }

    if (target === 'rejected' && !context.rejectionReason) {
      return { valid: false, reason: 'Rejection requires a reason' };
    }

    return { valid: true };
  }

  getAutoTransition(trigger) {
    return AUTO_TRANSITIONS[trigger] || null;
  }

  executeTransition(current, target, context = {}) {
    const permission = this.canTransition(current, target, context);
    if (!permission.valid) return { success: false, error: permission.reason };

    return {
      success: true,
      evidenceStage: target,
      isProductionReady: target === 'verified' || target === 'rejected',
      derivedStatus: target === 'verified' ? 'completed' : target === 'rejected' ? 'will_not_receive' : target === 'received' ? 'received' : target === 'requested' ? 'requested' : 'pending',
    };
  }

  // Check if all evidence items in an investigation are resolved
  isInvestigationResolved(items) {
    if (!items || items.length === 0) return false;
    return items.every(i => i.evidence_stage === 'verified' || i.evidence_stage === 'rejected');
  }

  // Get collection progress
  getProgress(items) {
    if (!items || items.length === 0) return { total: 0, received: 0, verified: 0, percent: 0 };
    const total = items.length;
    const received = items.filter(i => i.evidence_stage === 'received' || i.evidence_stage === 'verified').length;
    const verified = items.filter(i => i.evidence_stage === 'verified' || i.evidence_stage === 'rejected').length;
    return { total, received, verified, percent: Math.round((received / total) * 100) };
  }
}

export const EvidenceEngine = new EvidenceEngineClass();
