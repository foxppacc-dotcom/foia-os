// FOIA OS v2 — InformationRequirementEngine
// Information Requirements are the PRIMARY OPERATIONAL OBJECTS in Sprint 11.
// Everything else (evidence, documents, requests, comms) exists to satisfy IRs.
// Pure business logic. No React. No Express. No SQL. No HTTP.

import { DomainEngine } from './engine';

const IR_STATUSES = ['defined', 'in_progress', 'awaiting_response', 'follow_up_needed', 'evidence_received', 'verifying', 'satisfied', 'blocked', 'abandoned'];

const IR_PRIORITIES = ['low', 'medium', 'high', 'critical'];

const IR_LABELS = {
  defined: { ar: 'محدد', en: 'Defined' },
  in_progress: { ar: 'قيد التنفيذ', en: 'In Progress' },
  awaiting_response: { ar: 'بانتظار الرد', en: 'Awaiting Response' },
  follow_up_needed: { ar: 'متابعة مطلوبة', en: 'Follow-up Needed' },
  evidence_received: { ar: 'وصلت الأدلة', en: 'Evidence Received' },
  verifying: { ar: 'قيد التوثيق', en: 'Verifying' },
  satisfied: { ar: 'مكتمل', en: 'Satisfied' },
  blocked: { ar: 'مسدود', en: 'Blocked' },
  abandoned: { ar: 'ملغي', en: 'Abandoned' },
};

const SORT_ORDER = ['blocked', 'follow_up_needed', 'awaiting_response', 'defined', 'in_progress', 'evidence_received', 'verifying', 'satisfied', 'abandoned'];

class InformationRequirementEngineClass extends DomainEngine {
  constructor() {
    super('InformationRequirementEngine');
  }

  getStatuses() { return [...IR_STATUSES]; }
  getPriorities() { return [...IR_PRIORITIES]; }

  getLabel(status, lang = 'ar') {
    return IR_LABELS[status]?.[lang] || status;
  }

  // ═─ Next Action Engine ─═
  // Every IR must expose ONE action. The investigator never decides what to do next.
  getNextAction(ir, context = {}) {
    const status = ir.status || 'defined';
    const daysWaiting = context.daysWaiting || 0;

    if (status === 'blocked') return { action: 'resolve_blocker', label: 'حل العائق', urgency: 'danger', icon: '🚫' };
    if (status === 'follow_up_needed' || (status === 'awaiting_response' && daysWaiting > 14)) {
      if (daysWaiting > 30) return { action: 'escalate', label: 'تصعيد', urgency: 'danger', icon: '🔴' };
      return { action: 'follow_up', label: 'متابعة', urgency: 'warning', icon: '📞' };
    }
    if (status === 'defined') return { action: 'acquire', label: 'بدء الحصول', urgency: 'info', icon: '📨' };
    if (status === 'awaiting_response') return { action: 'wait', label: 'بانتظار الرد', urgency: 'neutral', icon: '⏳', days: daysWaiting };
    if (status === 'evidence_received') return { action: 'verify', label: 'توثيق', urgency: 'accent', icon: '✅' };
    if (status === 'verifying') return { action: 'review', label: 'مراجعة', urgency: 'accent', icon: '📋' };
    if (status === 'satisfied') return { action: 'none', label: 'مكتمل', urgency: 'success', icon: '✔️' };
    if (status === 'abandoned') return { action: 'reopen', label: 'إعادة فتح', urgency: 'neutral', icon: '🔄' };
    return { action: 'none', label: '—', urgency: 'neutral', icon: '•' };
  }

  // ═─ Sort IRs by priority ─═
  sortRequirements(requirements) {
    return [...requirements].sort((a, b) => {
      const aSortIdx = SORT_ORDER.indexOf(a.status || 'defined');
      const bSortIdx = SORT_ORDER.indexOf(b.status || 'defined');
      if (aSortIdx !== bSortIdx) return aSortIdx - bSortIdx;
      const pOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return (pOrder[a.priority] || 99) - (pOrder[b.priority] || 99);
    });
  }

  // ═─ Documentary Readiness ─═
  computeReadiness(requirements = []) {
    const total = requirements.length || 1;
    const satisfied = requirements.filter(r => r.status === 'satisfied').length;
    const blocked = requirements.filter(r => r.status === 'blocked').length;
    const verifying = requirements.filter(r => ['evidence_received', 'verifying'].includes(r.status)).length;
    const inProgress = requirements.filter(r => ['in_progress', 'awaiting_response', 'follow_up_needed', 'defined'].includes(r.status)).length;
    const criticalMissing = requirements.filter(r => r.priority === 'critical' && r.status !== 'satisfied').length;
    const followUpsDue = requirements.filter(r => r.status === 'follow_up_needed').length;

    const coverage = Math.round((satisfied / total) * 100);
    const verificationProgress = total > 0 ? Math.round(((satisfied + verifying) / total) * 100) : 0;

    let overall = 'unknown';
    if (blocked > 0 || criticalMissing > 0) overall = 'at_risk';
    else if (coverage >= 80 && verificationProgress >= 90) overall = 'ready';
    else if (coverage >= 50) overall = 'progressing';
    else overall = 'early_stage';

    return {
      total,
      satisfied,
      blocked,
      verifying,
      inProgress,
      criticalMissing,
      followUpsDue,
      coveragePercent: coverage,
      verificationProgress,
      overall,
      overallLabel: {
        ready: { ar: 'جاهز', en: 'Ready' },
        progressing: { ar: 'قيد التقدم', en: 'Progressing' },
        early_stage: { ar: 'مرحلة مبكرة', en: 'Early Stage' },
        at_risk: { ar: 'في خطر', en: 'At Risk' },
        unknown: { ar: 'غير معروف', en: 'Unknown' },
      }[overall] || { ar: 'غير معروف', en: 'Unknown' },
    };
  }

  // ═─ Build the complete workspace view ─═
  buildWorkspace(requirements = [], context = {}) {
    const sorted = this.sortRequirements(requirements);
    const readiness = this.computeReadiness(requirements);

    return {
      readiness,
      urgent: sorted.filter(r => r.status === 'blocked' || r.status === 'follow_up_needed' || (r.priority === 'critical' && r.status !== 'satisfied')),
      awaiting: sorted.filter(r => r.status === 'awaiting_response'),
      verifying: sorted.filter(r => ['evidence_received', 'verifying'].includes(r.status)),
      pending: sorted.filter(r => ['defined', 'in_progress'].includes(r.status)),
      completed: sorted.filter(r => r.status === 'satisfied'),
      all: sorted,
    };
  }

  // ═─ Default IR skeleton for checklist items ─═
  fromChecklistItem(item) {
    return {
      id: `ir_${item.record_type}`,
      question: `الحصول على ${item.recordMeta?.label || item.record_type}`,
      recordType: item.record_type,
      priority: 'medium',
      status: item.evidence_stage === 'verified' ? 'satisfied'
            : item.evidence_stage === 'received' ? 'evidence_received'
            : item.evidence_stage === 'requested' ? 'awaiting_response'
            : item.evidence_stage === 'waiting_review' ? 'awaiting_response'
            : item.evidence_stage === 'rejected' ? 'abandoned'
            : 'defined',
      assignedTo: item.assigned_to || null,
      sourceType: null,
      sourceName: null,
      strategy: 'email',
      dueDate: null,
      daysWaiting: 0,
      documentCount: 0,
      communicationCount: 0,
      requestCount: 0,
      nextAction: this.getNextAction({
        status: item.evidence_stage === 'verified' ? 'satisfied'
              : item.evidence_stage === 'received' ? 'evidence_received'
              : item.evidence_stage === 'requested' ? 'awaiting_response'
              : 'defined',
        priority: 'medium',
      }, { daysWaiting: 0 }),
    };
  }
}

export const InformationRequirementEngine = new InformationRequirementEngineClass();
