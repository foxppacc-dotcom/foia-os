// FOIA OS v2 — Operational Decision Engine (ODE)
// The operational brain of FOIA OS.
// Continuously answers: "What is the best operational decision to make right now?"
// Rule-based. No ML. No LLM.
// Pure business logic. No React. No Express. No SQL. No HTTP.

import { DomainEngine } from './engine';

// ── Scoring Weights ──
const WEIGHTS = {
  priority: { critical: 100, high: 60, medium: 30, low: 10 },
  daysWaiting: { perDay: 2, max: 60 },
  overdueDays: { perDay: 5, max: 80 },
  blocked: 80,
  verificationWaiting: 40,
  followUpDue: 50,
  deadlineImminent: { withinDays: 3, score: 70 },
  deadlineOverdue: { perDay: 8, max: 90 },
  sourceResponsive: -20,
  hasDocuments: -15,
};

class OperationalDecisionEngineClass extends DomainEngine {
  constructor() {
    super('OperationalDecisionEngine');
  }

  // ═══════════════════════════════════════════
  // 1. CRITICAL OPERATIONAL ALERTS
  // ═══════════════════════════════════════════

  getAlerts(requirements = [], context = {}) {
    const alerts = [];

    // Critical requirement without owner
    requirements.filter(r => r.priority === 'critical' && r.status !== 'satisfied' && !r.assignedTo)
      .forEach(r => alerts.push({
        type: 'unowned_critical',
        severity: 'critical',
        message: `متطلب حرج بدون مالك: ${r.question}`,
        requirementId: r.id,
      }));

    // Overdue acquisition requests
    requirements.filter(r => (r.daysWaiting || 0) > 30 && r.status === 'awaiting_response')
      .forEach(r => alerts.push({
        type: 'overdue_request',
        severity: 'critical',
        message: `طلب متأخر ${r.daysWaiting} يوم: ${r.question}`,
        requirementId: r.id,
        daysOverdue: r.daysWaiting - 15,
      }));

    // Investigation approaching deadline
    if (context.daysToDeadline !== undefined && context.daysToDeadline >= 0 && context.daysToDeadline <= 3) {
      alerts.push({
        type: 'deadline_approaching',
        severity: 'warning',
        message: `الموعد النهائي يقترب: ${context.daysToDeadline} أيام متبقية`,
      });
    }

    // Evidence awaiting verification too long
    requirements.filter(r => r.status === 'evidence_received' && (r.daysWaiting || 0) > 3)
      .forEach(r => alerts.push({
        type: 'verification_waiting',
        severity: 'warning',
        message: `توثيق معلق منذ ${r.daysWaiting} يوم: ${r.question}`,
        requirementId: r.id,
      }));

    // Blocked requiring manager
    requirements.filter(r => r.status === 'blocked')
      .forEach(r => alerts.push({
        type: 'blocked_requirement',
        severity: 'warning',
        message: `متطلب مسدود: ${r.question} — يحتاج تدخل المدير`,
        requirementId: r.id,
      }));

    // Follow-ups overdue
    requirements.filter(r => r.status === 'follow_up_needed' && (r.daysWaiting || 0) > 7)
      .forEach(r => alerts.push({
        type: 'follow_up_overdue',
        severity: 'warning',
        message: `متابعة متأخرة ${r.daysWaiting} يوم: ${r.question}`,
        requirementId: r.id,
      }));

    return alerts.sort((a, b) => a.severity === 'critical' ? -1 : 1);
  }

  // ═══════════════════════════════════════════
  // 2. OPERATIONAL BOTTLENECKS
  // ═══════════════════════════════════════════

  getBottlenecks(requirements = []) {
    // Group by source to find bottlenecks
    const sourceMap = {};
    requirements.filter(r => r.sourceName).forEach(r => {
      if (!sourceMap[r.sourceName]) {
        sourceMap[r.sourceName] = { source: r.sourceName, requirements: [], blockedCount: 0, waitingCount: 0 };
      }
      sourceMap[r.sourceName].requirements.push(r);
      if (r.status === 'blocked') sourceMap[r.sourceName].blockedCount++;
      if (r.status === 'awaiting_response' || r.status === 'follow_up_needed') sourceMap[r.sourceName].waitingCount++;
    });

    const bottlenecks = Object.values(sourceMap)
      .map(s => ({
        source: s.source,
        totalRequirements: s.requirements.length,
        blockedCount: s.blockedCount,
        waitingCount: s.waitingCount,
        requirements: s.requirements.map(r => ({ id: r.id, question: r.question, status: r.status, daysWaiting: r.daysWaiting })),
        bottleneckScore: (s.blockedCount * 3 + s.waitingCount * 2) / Math.max(s.requirements.length, 1),
      }))
      .sort((a, b) => b.bottleneckScore - a.bottleneckScore);

    return {
      bottlenecks,
      topBottleneck: bottlenecks[0] || null,
      blockingSources: bottlenecks.filter(b => b.blockedCount > 0 || b.waitingCount > 0).length,
    };
  }

  // ═══════════════════════════════════════════
  // 3. HIGHEST IMPACT DECISION
  // ═══════════════════════════════════════════

  getHighestImpactDecision(requirements = [], context = {}) {
    const bottlenecks = this.getBottlenecks(requirements);

    // Option A: Resolve the top bottleneck
    if (bottlenecks.topBottleneck) {
      const b = bottlenecks.topBottleneck;
      const affected = b.requirements.filter(r => r.status !== 'satisfied').length;
      const readinessGain = requirements.length > 0 ? Math.round((affected / requirements.length) * 100) : 0;
      return {
        action: `متابعة ${b.source}`,
        type: 'resolve_bottleneck',
        reason: `${b.source} يمنع ${affected} متطلبات من التقدم`,
        impact: {
          unlocksRequirements: affected,
          readinessGain,
          removesBottleneck: true,
        },
        targetSource: b.source,
        affectedRequirements: b.requirements.filter(r => r.status !== 'satisfied').map(r => r.question),
      };
    }

    // Option B: Find the most urgent unsatisfied requirement
    const unsatisfied = requirements.filter(r => r.status !== 'satisfied');
    if (unsatisfied.length > 0) {
      const scored = unsatisfied.map(r => ({ ...r, _score: this.scoreRequirement(r, context).score }));
      scored.sort((a, b) => b._score - a._score);
      const top = scored[0];
      return {
        action: top.question,
        type: 'highest_priority',
        reason: this._describeUrgency(top, context),
        impact: {
          priorityScore: top._score,
          isBlocked: top.status === 'blocked',
        },
        targetRequirement: top.id,
      };
    }

    return null;
  }

  // ═══════════════════════════════════════════
  // 4. ENHANCED WORK QUEUE
  // ═══════════════════════════════════════════

  buildWorkQueue(requirements = [], context = {}) {
    const scored = requirements.map(ir => {
      const s = this.scoreRequirement(ir, context);
      const dependencyCount = context.dependencyMap?.[ir.id]?.length || 0;
      const delayRisk = (ir.daysWaiting || 0) > 20 ? (ir.daysWaiting || 0) / 2 : 0;
      const readinessGain = context.readinessGainMap?.[ir.id] || 0;

      return {
        ...ir,
        _score: s.score,
        _breakdown: s.breakdown,
        operationalImpact: Math.round(s.score / 100 * 10) / 10,
        unlockScore: dependencyCount > 0 ? dependencyCount * 15 : 0,
        dependencyCount,
        delayRisk: Math.round(Math.min(delayRisk, 90)),
        readinessGain,
        bottleneckScore: ir.sourceName ? (context.sourceBottleneckMap?.[ir.sourceName] || 0) : 0,
      };
    });

    scored.sort((a, b) => b._score - a._score);

    return {
      queue: scored,
      urgent: scored.filter(r => r._score >= 80),
      highPriority: scored.filter(r => r._score >= 50 && r._score < 80),
      normal: scored.filter(r => r._score >= 20 && r._score < 50),
      lowPriority: scored.filter(r => r._score < 20),
      completed: scored.filter(r => r.status === 'satisfied'),
      totalScore: scored.reduce((sum, r) => sum + r._score, 0),
      averageScore: scored.length > 0 ? Math.round(scored.reduce((sum, r) => sum + r._score, 0) / scored.length) : 0,
    };
  }

  // ═══════════════════════════════════════════
  // 5. INVESTIGATION FORECAST
  // ═══════════════════════════════════════════

  getForecast(requirements = [], context = {}) {
    const total = requirements.length || 1;
    const satisfied = requirements.filter(r => r.status === 'satisfied').length;
    const blocked = requirements.filter(r => r.status === 'blocked').length;
    const inProgress = requirements.filter(r => ['awaiting_response', 'follow_up_needed', 'evidence_received', 'verifying', 'in_progress'].includes(r.status)).length;
    const notStarted = requirements.filter(r => r.status === 'defined').length;

    // Estimate days to completion based on blockers
    const avgResolveTime = context.avgSourceResponseDays || 14;
    const blockedPenalty = blocked * 7;
    const inProgressEstimate = Math.round(inProgress * avgResolveTime * 0.7 / Math.max(context.teamSize || 1, 1));
    const notStartedEstimate = notStarted * avgResolveTime;

    const estimatedDays = Math.max(1, Math.round(inProgressEstimate + notStartedEstimate + blockedPenalty));

    // Risk assessment
    const risks = [];
    if (blocked > 0) risks.push({ type: 'blocked', description: `${blocked} متطلبات مسدودة`, severity: 'high' });
    if (notStarted > 2) risks.push({ type: 'not_started', description: `${notStarted} متطلبات لم تبدأ بعد`, severity: 'medium' });
    if (context.daysToDeadline !== undefined && estimatedDays > context.daysToDeadline) {
      risks.push({ type: 'deadline_risk', description: `الموعد النهائي غير كافٍ (متاح ${context.daysToDeadline} يوم، نحتاج ${estimatedDays})`, severity: 'critical' });
    }

    const coverage = Math.round((satisfied / total) * 100);
    const health = coverage - (blocked * 5) + (satisfied * 2);
    const deadlineRisk = context.daysToDeadline !== undefined && estimatedDays > context.daysToDeadline ? 'high' : 'low';

    return {
      estimatedDaysToCompletion: estimatedDays,
      coverage,
      health: Math.max(0, Math.min(100, health)),
      risks: risks.sort((a, b) => a.severity === 'critical' ? -1 : a.severity === 'high' ? -1 : 1),
      deadlineRisk,
      bottleneckReadinessImpact: blocked > 0 ? Math.round((blocked / total) * 100) : 0,
      summary: {
        satisfied, blocked, inProgress, notStarted, total,
        completionRate: Math.round((satisfied / total) * 100),
        blockedRate: Math.round((blocked / total) * 100),
      },
    };
  }

  // ═══════════════════════════════════════════
  // ORCHESTRATED DECISION
  // ═══════════════════════════════════════════

  evaluate(requirements = [], context = {}) {
    const alerts = this.getAlerts(requirements, context);
    const bottlenecks = this.getBottlenecks(requirements);
    const highestImpact = this.getHighestImpactDecision(requirements, context);
    const queue = this.buildWorkQueue(requirements, context);
    const forecast = this.getForecast(requirements, context);

    return {
      evaluatedAt: new Date().toISOString(),
      alerts,
      bottlenecks,
      highestImpactDecision: highestImpact,
      workQueue: queue,
      forecast,
      alertCount: {
        critical: alerts.filter(a => a.severity === 'critical').length,
        warning: alerts.filter(a => a.severity === 'warning').length,
        total: alerts.length,
      },
    };
  }

  // ═══════════════════════════════════════════
  // INTERNAL: Scoring + Urgency
  // ═══════════════════════════════════════════

  scoreRequirement(ir, context = {}) {
    let score = 0;
    const pScore = WEIGHTS.priority[ir.priority || 'medium'] || 30;
    score += pScore;

    const daysWaiting = context.daysWaiting || ir.daysWaiting || 0;
    score += Math.min(daysWaiting * WEIGHTS.daysWaiting.perDay, WEIGHTS.daysWaiting.max);

    if (ir.status === 'blocked') score += WEIGHTS.blocked;
    if (ir.status === 'follow_up_needed') score += WEIGHTS.followUpDue;
    if (ir.status === 'evidence_received' || ir.status === 'verifying') score += WEIGHTS.verificationWaiting;

    if (context.daysToDeadline !== undefined) {
      if (context.daysToDeadline < 0) {
        score += Math.min(Math.abs(context.daysToDeadline) * WEIGHTS.deadlineOverdue.perDay, WEIGHTS.deadlineOverdue.max);
      } else if (context.daysToDeadline <= 3) {
        score += WEIGHTS.deadlineImminent.score;
      }
    }

    const overdueDays = context.overdueDays || 0;
    if (overdueDays > 0) score += Math.min(overdueDays * WEIGHTS.overdueDays.perDay, WEIGHTS.overdueDays.max);

    if (context.sourceResponsive) score += WEIGHTS.sourceResponsive;
    if ((context.documentCount || ir.documentCount || 0) > 0) score += WEIGHTS.hasDocuments;

    return {
      score: Math.max(0, score),
      breakdown: {
        priority: pScore,
        daysWaiting: Math.min(daysWaiting * WEIGHTS.daysWaiting.perDay, WEIGHTS.daysWaiting.max),
        blocked: ir.status === 'blocked' ? WEIGHTS.blocked : 0,
        followUp: ir.status === 'follow_up_needed' ? WEIGHTS.followUpDue : 0,
        verification: ir.status === 'evidence_received' ? WEIGHTS.verificationWaiting : 0,
        deadline: context.daysToDeadline !== undefined ? (context.daysToDeadline < 0 ? Math.min(Math.abs(context.daysToDeadline) * WEIGHTS.deadlineOverdue.perDay, WEIGHTS.deadlineOverdue.max) : context.daysToDeadline <= 3 ? WEIGHTS.deadlineImminent.score : 0) : 0,
        overdue: Math.min(overdueDays * WEIGHTS.overdueDays.perDay, WEIGHTS.overdueDays.max),
      },
    };
  }

  _describeUrgency(ir, context = {}) {
    const days = context.daysWaitingMap?.[ir.id] || ir.daysWaiting || 0;
    if (ir.status === 'blocked') return 'مسدود — يحتاج تدخل المدير';
    if (ir.status === 'follow_up_needed' && days > 30) return `متأخر ${days} يوم — تصعيد مطلوب`;
    if (ir.status === 'follow_up_needed') return `متابعة مطلوبة — ${days} يوم بدون رد`;
    if (ir.status === 'evidence_received') return 'بانتظار التوثيق';
    if (ir.status === 'awaiting_response' && days > 14) return `بانتظار الرد ${days} يوم`;
    if (ir.priority === 'critical' && ir.status !== 'satisfied') return 'أولوية قصوى — حرجة';
    if (days > 0) return `بانتظار الرد ${days} يوم`;
    return 'بحاجة للبدء';
  }
}

export const OperationalDecisionEngine = new OperationalDecisionEngineClass();
