import { useMemo } from 'react';
import { useCaseContext } from '../context/CaseContext';
import { OperationalDecisionEngine } from '../../domain/engines/OperationalDecisionEngine';
import AppBadge from '../../../components/ds/AppBadge';
import { AlertCircle, Clock, AlertTriangle, Eye, Phone, XCircle, User, FileText } from 'lucide-react';

const INVESTIGATION_V2 = import.meta.env.VITE_INVESTIGATION_V2 === 'true' || localStorage.getItem('INVESTIGATION_V2') === 'true';

const ALERT_ICONS = {
  unowned_critical: User,
  overdue_request: Clock,
  deadline_approaching: Clock,
  verification_waiting: Eye,
  blocked_requirement: XCircle,
  follow_up_overdue: Phone,
};

const ALERT_COLORS = {
  critical: { bg: 'rgba(239,68,68,0.08)', border: '#ef4444', text: '#ef4444', icon: '#ef4444' },
  warning: { bg: 'rgba(234,179,8,0.08)', border: '#eab308', text: '#eab308', icon: '#eab308' },
};

export default function OperationalInbox() {
  const { c, checklist } = useCaseContext();

  const decision = useMemo(() => {
    if (!INVESTIGATION_V2 || !checklist) return null;
    const requirements = checklist.map(item => ({
      id: `ir_${item.record_type}`,
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
    return OperationalDecisionEngine.evaluate(requirements, {});
  }, [checklist]);

  if (!INVESTIGATION_V2) return null;
  if (!decision?.alerts?.length) return (
    <div className="rounded-lg p-4 text-center text-sm" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#22c55e' }}>
      ✅ لا توجد تنبيهات — كل شيء على ما يرام
    </div>
  );

  return (
    <div className="space-y-2">
      {decision.alerts.map((alert, i) => {
        const colors = ALERT_COLORS[alert.severity] || ALERT_COLORS.warning;
        const Icon = ALERT_ICONS[alert.type] || AlertCircle;
        return (
          <div key={i} className="rounded-lg p-3 flex items-start gap-3 ds-transition-colors"
            style={{ background: colors.bg, border: '1px solid var(--ds-border)', borderLeft: `3px solid ${colors.border}` }}>
            <Icon className="w-5 h-5 shrink-0 mt-0.5" style={{ color: colors.icon }} />
            <div className="flex-1 min-w-0">
              <div className="text-sm" style={{ color: colors.text }}>{alert.message}</div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--ds-text-muted)' }}>
                {alert.severity === 'critical' ? 'حرج' : 'تنبيه'}
                {alert.daysOverdue ? ` · ${alert.daysOverdue} يوم تجاوز` : ''}
              </div>
            </div>
            <AppBadge variant={alert.severity === 'critical' ? 'danger' : 'warning'}>
              {alert.severity === 'critical' ? 'حرج' : 'تنبيه'}
            </AppBadge>
          </div>
        );
      })}
    </div>
  );
}
