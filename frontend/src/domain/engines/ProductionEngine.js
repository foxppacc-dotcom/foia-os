// FOIA OS v2 — ProductionEngine
// Pure business logic for the production handoff pipeline.

import { DomainEngine } from './engine';

const PRODUCTION_STAGES = ['queued', 'in_production', 'review', 'completed', 'delivered'];

const STAGE_LABELS = {
  queued: { ar: 'في الانتظار', en: 'Queued' },
  in_production: { ar: 'قيد الإنتاج', en: 'In Production' },
  review: { ar: 'مراجعة', en: 'Review' },
  completed: { ar: 'مكتمل', en: 'Completed' },
  delivered: { ar: 'تم التسليم', en: 'Delivered' },
};

class ProductionEngineClass extends DomainEngine {
  constructor() {
    super('ProductionEngine');
  }

  getStages() { return [...PRODUCTION_STAGES]; }

  getLabel(stage, lang = 'ar') {
    return STAGE_LABELS[stage]?.[lang] || stage;
  }

  canStartProduction(investigation) {
    if (!investigation) return { allowed: false, reason: 'No investigation provided' };
    if (investigation.investigation_stage !== 'ready') {
      return { allowed: false, reason: 'Investigation must be in Ready stage' };
    }
    return { allowed: true };
  }

  canDeliver(evidenceItems = []) {
    const unresolved = evidenceItems.filter(i => i.evidence_stage !== 'verified' && i.evidence_stage !== 'rejected');
    if (unresolved.length > 0) {
      return { allowed: false, reason: `${unresolved.length} evidence items not resolved`, unresolved };
    }
    return { allowed: true };
  }

  transition(current, target) {
    const idx = PRODUCTION_STAGES.indexOf(current);
    const targetIdx = PRODUCTION_STAGES.indexOf(target);
    if (idx === -1 || targetIdx === -1) return { success: false, error: 'Invalid stage' };
    if (targetIdx !== idx + 1 && targetIdx <= idx) return { success: false, error: 'Stage must advance sequentially' };
    return { success: true, stage: target };
  }

  estimatePackageSize(evidenceItems = [], documents = []) {
    const evidenceCount = evidenceItems.filter(i => i.evidence_stage === 'verified').length;
    const docCount = documents.length;
    return { evidenceCount, docCount, totalFiles: evidenceCount + docCount };
  }
}

export const ProductionEngine = new ProductionEngineClass();
