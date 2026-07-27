import { useMemo } from 'react';
import { useCaseContext } from '../context/CaseContext';
import { OperationalDecisionEngine } from '../../domain/engines/OperationalDecisionEngine';
import { AgencyRequestEngine } from '../../domain/engines/AgencyRequestEngine';
import AppBadge from '../../../components/ds/AppBadge';
import { Clock, AlertCircle, Eye, Phone, XCircle, TrendingUp, User, FileText, Calendar, ArrowUpCircle } from 'lucide-react';

const INVESTIGATION_V2 = import.meta.env.VITE_INVESTIGATION_V2 === 'true' || localStorage.getItem('INVESTIGATION_V2') === 'true';

const COLORS = {
  danger: { bg: 'rgba(239,68,68,0.08)', border: '#ef4444', text: '#ef4444' },
  warning: { bg: 'rgba(234,179,8,0.08)', border: '#eab308', text: '#eab308' },
  accent: { bg: 'rgba(139,92,246,0.08)', border: '#8b5cf6', text: '#8b5cf6' },
  success: { bg: 'rgba(34,197,94,0.08)', border: '#22c55e', text: '#22c55e' },
  neutral: { bg: 'var(--ds-bg-secondary)', border: 'var(--ds-border)', text: 'var(--ds-text-muted)' },
};

function Card({ color, icon: Icon, title, value, subtitle }) {
  const c = COLORS[color] || COLORS.neutral;
  return (
    <div className="rounded-lg p-3" style={{ background: c.bg, border: '1px solid var(--ds-border)', borderLeft: `3px solid ${c.border}` }}>
      <div className="flex items-center gap-2 mb-1">
        {Icon && <Icon className="w-4 h-4" style={{ color: c.text }} />}
        <span className="text-[11px] font-medium" style={{ color: c.text }}>{title}</span>
      </div>
      <div className="text-lg font-bold" style={{ color: c.text }}>{value}</div>
      {subtitle && <div className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>{subtitle}</div>}
    </div>
  );
}

export function InvestigatorBriefing() {
  const { c, checklist, requests } = useCaseContext();

  const briefing = useMemo(() => {
    if (!INVESTIGATION_V2 || !checklist) return null;
    const items = checklist.map(item => ({
      id: `ir_${item.record_type}`,
      record_type: item.record_type,
      question: `الحصول على ${item.recordMeta?.label || item.record_type}`,
      priority: 'medium',
      status: item.evidence_stage === 'verified' ? 'satisfied'
            : item.evidence_stage === 'received' ? 'evidence_received'
            : item.evidence_stage === 'requested' ? 'awaiting_response'
            : item.evidence_stage === 'waiting_review' ? 'awaiting_response'
            : item.evidence_stage === 'rejected' ? 'blocked'
            : item.evidence_stage || 'defined',
      daysWaiting: item.days_waiting || 0,
      sourceName: item.source_agency_name || null,
      assignedTo: item.assigned_to || null,
    }));

    const decision = OperationalDecisionEngine.evaluate(items, {});

    // Compute follow-up schedule from AgencyRequestEngine
    const followUps = (requests || []).map(r => {
      const days = AgencyRequestEngine.calculateDaysWaiting(r.created_at);
      const next = AgencyRequestEngine.calculateNextFollowUp(r.created_at);
      const overdue = AgencyRequestEngine.isOverdue(r.created_at);
      return { ...r, daysWaiting: days, nextFollowUp: next, isOverdue: overdue };
    });

    return { decision, followUps };
  }, [checklist, requests]);

  if (!INVESTIGATION_V2) return null;
  if (!briefing) return null;

  const { decision, followUps } = briefing;
  const forecast = decision.forecast;

  return (
    <div className="space-y-4">
      {/* Priority Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Card color="danger" icon={AlertCircle} title="عاجل" value={decision.workQueue.urgent.length} subtitle="يحتاج انتباه فوري" />
        <Card color="warning" icon={Phone} title="متابعة" value={decision.alerts.filter(a => a.type === 'follow_up_overdue').length} subtitle="متابعة مطلوبة" />
        <Card color="accent" icon={Eye} title="توثيق" value={decision.workQueue.urgent.filter(r => r.status === 'evidence_received').length} subtitle="بانتظار التوثيق" />
        <Card color="success" icon={CheckCircle} title="مكتمل" value={decision.workQueue.completed.length} subtitle={forecast.summary.completionRate + '%'} />
      </div>

      {/* Highest Impact Decision */}
      {decision.highestImpactDecision && (
        <div className="rounded-lg p-3" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
          <div className="flex items-center gap-2 mb-1">
            <ArrowUpCircle className="w-4 h-4" style={{ color: '#3b82f6' }} />
            <span className="text-sm font-semibold" style={{ color: '#3b82f6' }}>أعلى تأثير تشغيلي</span>
          </div>
          <div className="text-sm" style={{ color: 'var(--ds-text-primary)' }}>{decision.highestImpactDecision.action}</div>
          <div className="text-[11px]" style={{ color: 'var(--ds-text-muted)' }}>{decision.highestImpactDecision.reason}</div>
          {decision.highestImpactDecision.impact?.unlocksRequirements && (
            <div className="text-[11px] mt-1" style={{ color: '#22c55e' }}>
              يفتح {decision.highestImpactDecision.impact.unlocksRequirements} متطلبات · يحسن الجاهزية {decision.highestImpactDecision.impact.readinessGain || 0}%
            </div>
          )}
        </div>
      )}

      {/* Urgent Items */}
      {decision.workQueue.urgent.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4" style={{ color: '#ef4444' }} />
            <span className="text-sm font-semibold" style={{ color: '#ef4444' }}>ما يجب فعله اليوم</span>
          </div>
          <div className="space-y-1.5">
            {decision.workQueue.urgent.map(r => (
              <div key={r.id} className="rounded-lg p-2.5 flex items-start gap-2" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm" style={{ color: 'var(--ds-text-primary)' }}>{r.question}</div>
                  <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>
                    <span style={{ color: '#ef4444' }}>{r._score} نقطة</span>
                    {r.daysWaiting > 0 && <span>{r.daysWaiting} يوم</span>}
                    {r.sourceName && <span>{r.sourceName}</span>}
                  </div>
                </div>
                <AppBadge variant="danger">عاجل</AppBadge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Follow-up Schedule */}
      {followUps.filter(f => f.daysWaiting > 0).length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-4 h-4" style={{ color: '#eab308' }} />
            <span className="text-sm font-semibold" style={{ color: '#eab308' }}>جدول المتابعة</span>
          </div>
          <div className="space-y-1">
            {followUps.filter(f => f.daysWaiting > 0).slice(0, 5).map(r => (
              <div key={r.id} className="rounded-lg p-2 flex items-center justify-between" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
                <div>
                  <div className="text-[11px]" style={{ color: 'var(--ds-text-primary)' }}>{r.agency_name || `جهة #${r.agency_id}`}</div>
                  <div className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>{r.daysWaiting} يوم · المتابعة: {r.nextFollowUp}</div>
                </div>
                <AppBadge variant={r.isOverdue ? 'danger' : 'warning'}>{r.isOverdue ? 'متأخر' : r.daysWaiting + ' يوم'}</AppBadge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Forecast */}
      <div className="rounded-lg p-3" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4" style={{ color: 'var(--ds-accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>توقعات التحقيق</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <div className="text-lg font-bold" style={{ color: forecast.deadlineRisk === 'high' ? '#ef4444' : '#22c55e' }}>{forecast.estimatedDaysToCompletion}</div>
            <div className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>أيام متبقية</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold" style={{ color: forecast.overall === 'at_risk' ? '#ef4444' : '#3b82f6' }}>{forecast.coverage}%</div>
            <div className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>تغطية</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold" style={{ color: forecast.health >= 70 ? '#22c55e' : '#eab308' }}>{forecast.health}</div>
            <div className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>صحة</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckCircle() {
  return <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>;
}

export default InvestigatorBriefing;
