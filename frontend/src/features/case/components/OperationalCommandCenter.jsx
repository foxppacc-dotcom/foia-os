import { useMemo, useState } from 'react';
import { useCaseContext } from '../context/CaseContext';
import { OperationalDecisionEngine } from '../../domain/engines/OperationalDecisionEngine';
import AppBadge from '../../../components/ds/AppBadge';
import { Clock, AlertCircle, Eye, Phone, Send, XCircle, CheckCircle, FileText, ArrowUpCircle, User, TrendingUp, Building2 } from 'lucide-react';

const INVESTIGATION_V2 = import.meta.env.VITE_INVESTIGATION_V2 === 'true' || localStorage.getItem('INVESTIGATION_V2') === 'true';

const COLORS = {
  danger: { bg: 'rgba(239,68,68,0.08)', border: '#ef4444', text: '#ef4444' },
  warning: { bg: 'rgba(234,179,8,0.08)', border: '#eab308', text: '#eab308' },
  accent: { bg: 'rgba(139,92,246,0.08)', border: '#8b5cf6', text: '#8b5cf6' },
  success: { bg: 'rgba(34,197,94,0.08)', border: '#22c55e', text: '#22c55e' },
  info: { bg: 'rgba(59,130,246,0.08)', border: '#3b82f6', text: '#3b82f6' },
  neutral: { bg: 'var(--ds-bg-secondary)', border: 'var(--ds-border)', text: 'var(--ds-text-muted)' },
};

function ActionBar({ actions, onAction }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {actions.map((a, i) => {
        const Icon = a.icon;
        const c = COLORS[a.color] || COLORS.neutral;
        return (
          <button key={i} onClick={() => onAction?.(a.action)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium ds-transition-colors"
            style={{ background: c.bg, border: `1px solid ${c.border}40`, color: c.text }}
            onMouseEnter={e => { e.currentTarget.style.background = c.border + '25'; }}
            onMouseLeave={e => { e.currentTarget.style.background = c.bg; }}>
            {Icon && <Icon className="w-3 h-3" />}
            {a.label}
          </button>
        );
      })}
    </div>
  );
}

function IRCommandCard({ ir, context }) {
  const nextAction = ir.nextAction || {};
  const c = COLORS[nextAction.urgency] || COLORS.neutral;
  const readinessGap = ir.status !== 'satisfied' ? Math.round((1 / Math.max(context.totalReqs || 1, 1)) * 100) : 0;
  const [inlinePanel, setInlinePanel] = useState(null);
  const [newOwner, setNewOwner] = useState('');
  const [newPriority, setNewPriority] = useState('medium');

  const handleAction = (action) => {
    if (action === 'upload') setInlinePanel(inlinePanel === 'upload' ? null : 'upload');
    else if (action === 'assign') setInlinePanel(inlinePanel === 'assign' ? null : 'assign');
    else if (action === 'priority') setInlinePanel(inlinePanel === 'priority' ? null : 'priority');
    else setInlinePanel(null);
  };

function getActions(status, ir) {
  const actions = [];
  if (status === 'defined' || status === 'in_progress') actions.push({ icon: Send, label: 'إرسال طلب', color: 'info', action: 'send' });
  if (status === 'awaiting_response' || status === 'follow_up_needed') {
    actions.push({ icon: Phone, label: 'متابعة', color: 'warning', action: 'follow_up' });
    if ((ir.daysWaiting || 0) > 30) actions.push({ icon: AlertCircle, label: 'تصعيد', color: 'danger', action: 'escalate' });
  }
  if (status === 'evidence_received' || status === 'verifying') actions.push({ icon: Eye, label: 'توثيق', color: 'accent', action: 'verify' });
  if (status === 'blocked') actions.push({ icon: XCircle, label: 'حل العائق', color: 'danger', action: 'resolve' });
  // Always available actions
  actions.push({ icon: FileText, label: 'رفع ملف', color: 'accent', action: 'upload' });
  if (ir.sourceName) actions.push({ icon: Building2, label: 'المصدر', color: 'warning', action: 'source' });
  actions.push({ icon: User, label: 'تعيين', color: 'info', action: 'assign' });
  actions.push({ icon: ArrowUpCircle, label: 'أولوية', color: 'warning', action: 'priority' });
  return actions;
}

  return (
    <div className="rounded-lg p-3 ds-transition-colors" style={{ background: c.bg, border: '1px solid var(--ds-border)', borderLeft: `3px solid ${c.border}` }}>
      {/* Status + Next Action */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-semibold text-sm" style={{ color: 'var(--ds-text-primary)' }}>{ir.question || ir.record_type}</span>
          <AppBadge variant={nextAction.urgency === 'danger' ? 'danger' : nextAction.urgency === 'warning' ? 'warning' : 'neutral'}>
            {nextAction.label || ir.status}
          </AppBadge>
        </div>
      </div>

      {/* Context info */}
      <div className="flex items-center gap-3 text-[10px] mb-2" style={{ color: 'var(--ds-text-muted)' }}>
        {(ir.daysWaiting || 0) > 0 && <span className="flex items-center gap-1" style={{ color: (ir.daysWaiting || 0) > 30 ? '#ef4444' : (ir.daysWaiting || 0) > 14 ? '#eab308' : 'inherit' }}>
          <Clock className="w-3 h-3" />{ir.daysWaiting} يوم
        </span>}
        {ir.sourceName && <span>{ir.sourceName}</span>}
        {ir.assignedTo && <span className="flex items-center gap-1"><User className="w-3 h-3" />{(ir.assignedToName || 'محقق')}</span>}
        {readinessGap > 0 && <span className="flex items-center gap-1" style={{ color: '#8b5cf6' }}>
          <TrendingUp className="w-3 h-3" />{readinessGap}%
        </span>}
      </div>

      {/* Context Actions */}
      <ActionBar actions={getActions(ir.status, ir)} onAction={handleAction} />

      {/* Inline panels */}
      {inlinePanel === 'upload' && (
        <div className="mt-2 p-2 rounded-lg" style={{ background: 'var(--ds-bg-primary)', border: '1px dashed var(--ds-border)' }}>
          <div className="text-[10px] font-medium mb-1" style={{ color: 'var(--ds-text-muted)' }}>رفع ملف</div>
          <div className="flex items-center gap-2">
            <input type="file" className="text-[10px] flex-1" style={{ color: 'var(--ds-text-primary)' }} />
            <button className="text-[10px] px-2 py-1 rounded" style={{ background: 'var(--ds-accent)', color: 'white' }}>رفع</button>
          </div>
        </div>
      )}
      {inlinePanel === 'assign' && (
        <div className="mt-2 p-2 rounded-lg" style={{ background: 'var(--ds-bg-primary)', border: '1px dashed var(--ds-border)' }}>
          <div className="text-[10px] font-medium mb-1" style={{ color: 'var(--ds-text-muted)' }}>تعيين محقق</div>
          <div className="flex items-center gap-2">
            <input className="text-[10px] flex-1 px-2 py-1 rounded" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
              placeholder="اسم المحقق..." value={newOwner} onChange={e => setNewOwner(e.target.value)} />
            <button className="text-[10px] px-2 py-1 rounded" style={{ background: 'var(--ds-accent)', color: 'white' }}
              onClick={() => { setNewOwner(''); setInlinePanel(null); }}>تعيين</button>
          </div>
        </div>
      )}
      {inlinePanel === 'priority' && (
        <div className="mt-2 p-2 rounded-lg" style={{ background: 'var(--ds-bg-primary)', border: '1px dashed var(--ds-border)' }}>
          <div className="text-[10px] font-medium mb-1" style={{ color: 'var(--ds-text-muted)' }}>تغيير الأولوية</div>
          <div className="flex items-center gap-2">
            <select className="text-[10px] flex-1 px-2 py-1 rounded" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
              value={newPriority} onChange={e => setNewPriority(e.target.value)}>
              <option value="low">منخفضة</option>
              <option value="medium">متوسطة</option>
              <option value="high">عالية</option>
              <option value="critical">حرجة</option>
            </select>
            <button className="text-[10px] px-2 py-1 rounded" style={{ background: 'var(--ds-accent)', color: 'white' }}
              onClick={() => { setInlinePanel(null); }}>حفظ</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OperationalCommandCenter() {
  const { c, checklist } = useCaseContext();

  const cmd = useMemo(() => {
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
      assignedTo: item.assigned_to,
      nextAction: { action: 'none', urgency: 'neutral', label: item.evidence_stage === 'verified' ? 'مكتمل' : item.evidence_stage === 'received' ? 'توثيق' : item.evidence_stage === 'rejected' ? 'مسدود' : 'مطلوب' },
    }));

    const decision = OperationalDecisionEngine.evaluate(items, {});
    return { items, decision };
  }, [checklist]);

  if (!INVESTIGATION_V2 || !cmd) return null;

  const { items, decision } = cmd;
  const totalReqs = items.length || 1;

  // 1. Highest Impact Decision (ONE priority)
  const impact = decision.highestImpactDecision;

  return (
    <div className="space-y-4">
      {/* ONE Highest Impact Decision */}
      {impact && (
        <div className="rounded-lg p-4" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.1), rgba(139,92,246,0.1))', border: '1px solid rgba(59,130,246,0.3)' }}>
          <div className="flex items-center gap-2 mb-1">
            <ArrowUpCircle className="w-5 h-5" style={{ color: '#3b82f6' }} />
            <span className="text-sm font-bold" style={{ color: '#3b82f6' }}>أعلى تأثير تشغيلي</span>
          </div>
          <div className="text-base font-semibold mb-1" style={{ color: 'var(--ds-text-primary)' }}>{impact.action}</div>
          <div className="text-[11px] mb-2" style={{ color: 'var(--ds-text-muted)' }}>{impact.reason}</div>
          {impact.impact?.unlocksRequirements && (
            <div className="flex items-center gap-3 text-[11px]">
              <span style={{ color: '#22c55e' }}>🔓 يفتح {impact.impact.unlocksRequirements} متطلبات</span>
              <span style={{ color: '#8b5cf6' }}>📈 يحسن الجاهزية {impact.impact.readinessGain || 0}%</span>
              {impact.impact.removesBottleneck && <span style={{ color: '#ef4444' }}>🚫 يزيل أكبر عائق</span>}
            </div>
          )}
        </div>
      )}

      {/* Deadline Categories */}
      <div className="grid grid-cols-5 gap-1.5">
        {[
          { label: 'اليوم', color: '#ef4444', count: decision.workQueue.urgent.length },
          { label: 'هذا الأسبوع', color: '#eab308', count: decision.workQueue.highPriority.length },
          { label: 'متأخر', color: '#ef4444', count: decision.alerts.filter(a => a.type === 'overdue_request' || a.type === 'follow_up_overdue').length },
          { label: 'في خطر', color: '#eab308', count: decision.alerts.filter(a => a.type === 'deadline_approaching').length },
          { label: 'قادم', color: '#3b82f6', count: decision.workQueue.normal.length },
        ].map(d => (
          <div key={d.label} className="rounded-lg p-2 text-center" style={{ background: `${d.color}10`, border: `1px solid ${d.color}30` }}>
            <div className="text-base font-bold" style={{ color: d.color }}>{d.count}</div>
            <div className="text-[9px]" style={{ color: 'var(--ds-text-muted)' }}>{d.label}</div>
          </div>
        ))}
      </div>

      {/* IR Command Cards */}
      <div className="space-y-2">
        {items.sort((a, b) => {
          const order = { blocked: 0, follow_up_needed: 1, defined: 2, awaiting_response: 3, evidence_received: 4, verifying: 5, satisfied: 6 };
          return (order[a.status] || 99) - (order[b.status] || 99);
        }).map(ir => (
          <IRCommandCard key={ir.id} ir={ir} context={{ totalReqs }} />
        ))}
      </div>
    </div>
  );
}
