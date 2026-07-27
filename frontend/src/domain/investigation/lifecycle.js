// FOIA OS v2 — Investigation Lifecycle Engine
// Separates Stage Definition, Transition Rules, and Validation Rules
// Allows future workflow configuration without rewriting business logic

// ========================================
// 1. STAGE DEFINITION
// ========================================
const STAGES = {
  PLANNING: 'planning',
  RESEARCH: 'research',
  REQUESTS: 'requests',
  WAITING: 'waiting',
  COLLECTION: 'collection',
  VERIFICATION: 'verification',
  READY: 'ready',
  ARCHIVED: 'archived',
};

const STAGE_ORDER = [
  STAGES.PLANNING,
  STAGES.RESEARCH,
  STAGES.REQUESTS,
  STAGES.WAITING,
  STAGES.COLLECTION,
  STAGES.VERIFICATION,
  STAGES.READY,
  STAGES.ARCHIVED,
];

const STAGE_LABELS = {
  [STAGES.PLANNING]: { ar: 'تخطيط', en: 'Planning' },
  [STAGES.RESEARCH]: { ar: 'بحث أولي', en: 'Research' },
  [STAGES.REQUESTS]: { ar: 'إرسال الطلبات', en: 'Requests Sent' },
  [STAGES.WAITING]: { ar: 'بانتظار الردود', en: 'Waiting' },
  [STAGES.COLLECTION]: { ar: 'جمع الأدلة', en: 'Collection' },
  [STAGES.VERIFICATION]: { ar: 'مراجعة الأدلة', en: 'Verification' },
  [STAGES.READY]: { ar: 'جاهز للإنتاج', en: 'Ready' },
  [STAGES.ARCHIVED]: { ar: 'مؤرشف', en: 'Archived' },
};

// ========================================
// 2. TRANSITION RULES
// ========================================
// Each rule defines: fromStage, toStage, trigger (business event type), condition function

const TRANSITIONS = [
  { from: STAGES.PLANNING, to: STAGES.RESEARCH, trigger: 'evidence_plan_complete' },
  { from: STAGES.RESEARCH, to: STAGES.REQUESTS, trigger: 'sources_identified' },
  { from: STAGES.REQUESTS, to: STAGES.WAITING, trigger: 'request_sent' },
  { from: STAGES.WAITING, to: STAGES.COLLECTION, trigger: 'document_received' },
  { from: STAGES.COLLECTION, to: STAGES.VERIFICATION, trigger: 'collection_threshold_met' },
  { from: STAGES.VERIFICATION, to: STAGES.READY, trigger: 'all_evidence_resolved' },
  { from: STAGES.READY, to: STAGES.ARCHIVED, trigger: 'production_confirmed' },
  // Special transitions (manual)
  { from: '*', to: STAGES.ARCHIVED, trigger: 'force_archive', requires: 'case_owner' },
  { from: '*', to: STAGES.PLANNING, trigger: 'reset', requires: 'case_owner' },
];

// ========================================
// 3. VALIDATION RULES
// ========================================
const VALIDATIONS = {
  [STAGES.RESEARCH]: {
    entry: (ctx) => ctx.checklistCount >= 3 && ctx.teamCount >= 1,
    entryMessage: 'يجب أن تحتوي القضية على 3 أدلة على الأقل ومحقق واحد على الأقل',
  },
  [STAGES.REQUESTS]: {
    entry: (ctx) => ctx.sourcedItems > 0,
    entryMessage: 'يجب تحديد مصدر واحد على الأقل',
  },
  [STAGES.VERIFICATION]: {
    entry: (ctx) => ctx.receivedPercent >= 70,
    entryMessage: 'يجب استلام 70% من الأدلة على الأقل قبل المراجعة',
  },
  [STAGES.READY]: {
    entry: (ctx) => ctx.allResolved,
    entryMessage: 'جميع الأدلة يجب أن تكون موثقة أو مرفوضة',
  },
};

// ========================================
// 4. LEGACY COMPATIBILITY MAPPER
// ========================================
const LEGACY_MAP = {
  [STAGES.PLANNING]: 'open',
  [STAGES.RESEARCH]: 'open',
  [STAGES.REQUESTS]: 'in_progress',
  [STAGES.WAITING]: 'in_progress',
  [STAGES.COLLECTION]: 'in_progress',
  [STAGES.VERIFICATION]: 'in_progress',
  [STAGES.READY]: 'in_progress',
  [STAGES.ARCHIVED]: 'closed',
};

function deriveLegacyStatus(investigationStage) {
  return LEGACY_MAP[investigationStage] || 'open';
}

// ========================================
// 5. ENGINE FUNCTIONS
// ========================================

// Check if a transition is valid
function canTransition(currentStage, targetStage, trigger, userRole, context) {
  const transition = TRANSITIONS.find(t => {
    const fromMatch = t.from === '*' || t.from === currentStage;
    const toMatch = t.to === targetStage;
    const triggerMatch = !trigger || t.trigger === trigger;
    return fromMatch && toMatch && triggerMatch;
  });
  if (!transition) return { allowed: false, reason: 'الانتقال غير مسموح به' };
  if (transition.requires && transition.requires !== userRole) {
    return { allowed: false, reason: 'هذا الانتقال يتطلب صلاحية أعلى' };
  }
  const validation = VALIDATIONS[targetStage];
  if (validation && validation.entry && !validation.entry(context)) {
    return { allowed: false, reason: validation.entryMessage };
  }
  return { allowed: true };
}

// Execute a transition
function executeTransition(currentStage, targetStage) {
  const fromIdx = STAGE_ORDER.indexOf(currentStage);
  const toIdx = STAGE_ORDER.indexOf(targetStage);
  return {
    stage: targetStage,
    isForward: toIdx >= fromIdx,
    isBackward: toIdx < fromIdx,
    derivedLegacyStatus: deriveLegacyStatus(targetStage),
  };
}

// Get available transitions from a stage
function getAvailableTransitions(currentStage, userRole) {
  return TRANSITIONS
    .filter(t => t.from === '*' || t.from === currentStage)
    .filter(t => !t.requires || t.requires === userRole)
    .map(t => ({
      to: t.to,
      label: STAGE_LABELS[t.to]?.ar || t.to,
      trigger: t.trigger,
      requires: t.requires || null,
    }));
}

export {
  STAGES, STAGE_ORDER, STAGE_LABELS,
  TRANSITIONS, VALIDATIONS, LEGACY_MAP,
  deriveLegacyStatus,
  canTransition, executeTransition, getAvailableTransitions,
};
