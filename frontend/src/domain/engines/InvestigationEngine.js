// FOIA OS v2 — InvestigationEngine
// Pure business logic. No React, No Express, No SQL, No HTTP.

import { DomainEngine, validateLinearTransition, deriveLegacyStatus } from './engine';

const STAGES = ['planning', 'research', 'requests', 'waiting', 'collection', 'verification', 'ready', 'archived'];

const STAGE_LABELS = {
  planning: { ar: 'تخطيط', en: 'Planning' },
  research: { ar: 'بحث أولي', en: 'Research' },
  requests: { ar: 'إرسال الطلبات', en: 'Requests Sent' },
  waiting: { ar: 'بانتظار الردود', en: 'Waiting' },
  collection: { ar: 'جمع الأدلة', en: 'Collection' },
  verification: { ar: 'مراجعة الأدلة', en: 'Verification' },
  ready: { ar: 'جاهز للإنتاج', en: 'Ready' },
  archived: { ar: 'مؤرشف', en: 'Archived' },
};

const ENTRY_CONDITIONS = {
  research: (ctx) => ctx.checklistCount >= 3 && ctx.teamCount >= 1,
  requests: (ctx) => ctx.sourcedItems > 0,
  verification: (ctx) => ctx.receivedPercent >= 70,
  ready: (ctx) => ctx.allResolved,
};

const AUTO_TRANSITIONS = {
  evidence_complete: { from: 'planning', to: 'research' },
  sources_identified: { from: 'research', to: 'requests' },
  request_sent: { from: 'requests', to: 'waiting' },
  document_received: { from: 'waiting', to: 'collection' },
  progress_threshold_met: { from: 'collection', to: 'verification' },
  all_evidence_resolved: { from: 'verification', to: 'ready' },
  production_confirmed: { from: 'ready', to: 'archived' },
};

class InvestigationEngineClass extends DomainEngine {
  constructor() {
    super('InvestigationEngine');
  }

  getStages() { return [...STAGES]; }

  getStageLabels() { return { ...STAGE_LABELS }; }

  getLabel(stage, lang = 'ar') {
    return STAGE_LABELS[stage]?.[lang] || stage;
  }

  canTransition(current, target, userRole = 'investigator') {
    const linear = validateLinearTransition(current, target, STAGES);
    if (!linear.valid) return linear;

    const entryCheck = ENTRY_CONDITIONS[target];
    if (entryCheck) {
      return { valid: false, reason: `Stage ${target} has entry conditions that must be validated` };
    }

    if (target === 'archived' && userRole !== 'case_owner') {
      return { valid: false, reason: 'Only Case Owner can archive' };
    }

    return { valid: true };
  }

  getAutoTransition(trigger) {
    return AUTO_TRANSITIONS[trigger] || null;
  }

  getEntryCondition(stage) {
    return ENTRY_CONDITIONS[stage] || null;
  }

  executeTransition(current, target) {
    const result = validateLinearTransition(current, target, STAGES, true);
    if (!result.valid) return { success: false, error: result.reason };
    return {
      success: true,
      stage: target,
      isForward: STAGES.indexOf(target) >= STAGES.indexOf(current),
      derivedLegacyStatus: deriveLegacyStatus(target),
    };
  }

  getCompatibilityLayer(stage) {
    return { stage, legacyStatus: deriveLegacyStatus(stage), label: this.getLabel(stage) };
  }
}

export const InvestigationEngine = new InvestigationEngineClass();
