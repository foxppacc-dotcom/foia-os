import { useMemo, useState } from 'react';
import { useCaseContext } from '../context/CaseContext';
import { OperationalDecisionEngine } from '../../domain/engines/OperationalDecisionEngine';
import AppBadge from '../../../components/ds/AppBadge';
import { AlertCircle, Clock, ArrowUpCircle, CheckCircle, Phone, Eye, Send, TrendingUp, User, XCircle } from 'lucide-react';

const INVESTIGATION_V2 = import.meta.env.VITE_INVESTIGATION_V2 === 'true' || localStorage.getItem('INVESTIGATION_V2') === 'true';

const URGENCY_COLORS = {
  danger: { bg: 'rgba(239,68,68,0.08)', border: '#ef4444', text: '#ef4444', label: 'عاجل' },
  warning: { bg: 'rgba(234,179,8,0.08)', border: '#eab308', text: '#eab308', label: 'مهم' },
  accent: { bg: 'rgba(139,92,246,0.08)', border: '#8b5cf6', text: '#8b5cf6', label: 'توثيق' },
  info: { bg: 'rgba(59,130,246,0.08)', border: '#3b82f6', text: '#3b82f6', label: 'جديد' },
  success: { bg: 'rgba(34,197,94,0.08)', border: '#22c55e', text: '#22c55e', label: 'مكتمل' },
  neutral: { bg: 'var(--ds-bg-secondary)', border: 'var(--ds-border)', text: 'var(--ds-text-muted)', label: '—' },
};

const ACTION_ICONS = {
  resolve_blocker: XCircle,
  escalate: AlertCircle,
  follow_up: Phone,
  acquire: Send,
  verify: Eye,
  review: User,
};

function WorkItem({ item }) {
  const action = item.nextAction || {};
  const urgency = action.urgency || 'neutral';
  const colors = URGENCY_COLORS[urgency] || URGENCY_COLORS.neutral;
  const Icon = ACTION_ICONS[action.action] || ArrowUpCircle;
  const score = item._score || 0;

  return (
    <div className="rounded-lg p-3 ds-transition-colors flex items-start gap-3"
      style={{ background: colors.bg, border: '1px solid var(--ds-border)', borderLeft: `3px solid ${colors.border}` }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="font-semibold text-sm" style={{ color: 'var(--ds-text-primary)' }}>{item.question || item.record_type}</span>
          <AppBadge variant={urgency === 'danger' ? 'danger' : urgency === 'warning' ? 'warning' : 'neutral'}>{action.label || item.status}</AppBadge>
          <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-muted)' }}>{score}</span>
        </div>
        <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--ds-text-muted)' }}>
          {item.sourceName && <span>{item.sourceName}</span>}
          {item.daysWaiting > 0 && <span className="flex items-center gap-1" style={{ color: item.daysWaiting > 30 ? '#ef4444' : item.daysWaiting > 14 ? '#eab308' : 'inherit' }}><Clock className="w-3 h-3" />{item.daysWaiting} يوم</span>}
          {item.documentCount > 0 && <span>{item.documentCount} ملف</span>}
          {item._reason && <span style={{ color: colors.text }}>{item._reason}</span>}
        </div>
      </div>
      <div className="shrink-0"><Icon className="w-4 h-4" style={{ color: colors.text }} /></div>
    </div>
  );
}

export default function TodayView() {
  const { c, checklist } = useCaseContext();

  const queue = useMemo(() => {
    if (!INVESTIGATION_V2 || !checklist) return null;

    const requirements = checklist.map(item => ({
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
      documentCount: (item.documents || []).length || 0,
      sourceName: item.source_agency_name || null,
      nextAction: { action: item.evidence_stage === 'verified' ? 'none' : item.evidence_stage === 'received' ? 'verify' : item.evidence_stage === 'rejected' ? 'resolve_blocker' : 'acquire', urgency: item.evidence_stage === 'verified' ? 'success' : item.evidence_stage === 'received' ? 'accent' : item.evidence_stage === 'rejected' ? 'danger' : 'warning', label: item.evidence_stage === 'verified' ? 'مكتمل' : item.evidence_stage === 'received' ? 'توثيق' : item.evidence_stage === 'rejected' ? 'مسدود' : 'مطلوب' },
    }));

    return OperationalDecisionEngine.buildWorkQueue(requirements, {});
  }, [checklist]);

  if (!INVESTIGATION_V2) return null;

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-lg p-2 text-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <div className="text-lg font-bold" style={{ color: '#ef4444' }}>{queue?.urgent?.length || 0}</div>
          <div className="text-[10px]" style={{ color: '#ef4444' }}>عاجل</div>
        </div>
        <div className="rounded-lg p-2 text-center" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
          <div className="text-lg font-bold" style={{ color: '#eab308' }}>{queue?.highPriority?.length || 0}</div>
          <div className="text-[10px]" style={{ color: '#eab308' }}>مهم</div>
        </div>
        <div className="rounded-lg p-2 text-center" style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)' }}>
          <div className="text-lg font-bold" style={{ color: '#8b5cf6' }}>{queue?.normal?.length || 0}</div>
          <div className="text-[10px]" style={{ color: '#8b5cf6' }}>عادي</div>
        </div>
        <div className="rounded-lg p-2 text-center" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
          <div className="text-lg font-bold" style={{ color: '#22c55e' }}>{queue?.completed?.length || 0}</div>
          <div className="text-[10px]" style={{ color: '#22c55e' }}>مكتمل</div>
        </div>
      </div>

      {/* Today's Priority */}
      {queue?.urgent && queue.urgent.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4" style={{ color: '#ef4444' }} />
            <span className="text-sm font-semibold" style={{ color: '#ef4444' }}>ما يجب فعله اليوم</span>
          </div>
          <div className="space-y-1.5">
            {queue.urgent.map(r => <WorkItem key={r.id} item={r} />)}
          </div>
        </div>
      )}

      {/* High Priority */}
      {queue?.highPriority && queue.highPriority.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ArrowUpCircle className="w-4 h-4" style={{ color: '#eab308' }} />
            <span className="text-sm font-semibold" style={{ color: '#eab308' }}>أولوية عالية</span>
          </div>
          <div className="space-y-1.5">
            {queue.highPriority.map(r => <WorkItem key={r.id} item={r} />)}
          </div>
        </div>
      )}
    </div>
  );
}
