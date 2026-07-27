import { useMemo, useState } from 'react';
import { useCaseContext } from '../context/CaseContext';
import { InformationRequirementEngine } from '../../domain/engines/InformationRequirementEngine';
import { EvidenceStageBadge, legacyToEvidenceStage } from './EvidenceStageBadge';
import AppCard from '../../../components/ds/AppCard';
import AppBadge from '../../../components/ds/AppBadge';
import AppButton from '../../../components/ds/AppButton';
import AppEmptyState from '../../../components/ds/AppEmptyState';
import { Search, Mail, Phone, Globe, Clock, AlertCircle, CheckCircle, FileText, User, Calendar, TrendingUp, AlertTriangle, Send, Eye, ArrowUpCircle, XCircle } from 'lucide-react';

const INVESTIGATION_V2 = import.meta.env.VITE_INVESTIGATION_V2 === 'true' || localStorage.getItem('INVESTIGATION_V2') === 'true';

const URGENCY_COLORS = {
  danger: { bg: 'rgba(239,68,68,0.08)', border: '#ef4444', text: '#ef4444' },
  warning: { bg: 'rgba(234,179,8,0.08)', border: '#eab308', text: '#eab308' },
  info: { bg: 'rgba(59,130,246,0.08)', border: '#3b82f6', text: '#3b82f6' },
  accent: { bg: 'rgba(139,92,246,0.08)', border: '#8b5cf6', text: '#8b5cf6' },
  success: { bg: 'rgba(34,197,94,0.08)', border: '#22c55e', text: '#22c55e' },
  neutral: { bg: 'var(--ds-bg-secondary)', border: 'var(--ds-border)', text: 'var(--ds-text-muted)' },
};

const ACTION_ICONS = {
  resolve_blocker: XCircle,
  escalate: AlertTriangle,
  follow_up: Phone,
  acquire: Send,
  verify: Eye,
  review: FileText,
  reopen: ArrowUpCircle,
};

function RequirementCard({ ir }) {
  const action = ir.nextAction || { action: 'none', label: '—', urgency: 'neutral', icon: '•' };
  const colors = URGENCY_COLORS[action.urgency] || URGENCY_COLORS.neutral;
  const ActionIcon = ACTION_ICONS[action.action] || FileText;

  return (
    <div className="rounded-lg p-4 ds-transition-colors"
      style={{ background: colors.bg, border: '1px solid var(--ds-border)', borderLeft: `3px solid ${colors.border}` }}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-semibold text-sm" style={{ color: 'var(--ds-text-primary)' }}>{ir.question}</span>
            <AppBadge variant={action.urgency === 'danger' ? 'danger' : action.urgency === 'warning' ? 'warning' : action.urgency === 'success' ? 'success' : 'neutral'}>{action.label}</AppBadge>
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-muted)' }}>{ir.priority === 'critical' ? 'عاجل' : ir.priority === 'high' ? 'عالية' : ir.priority === 'medium' ? 'متوسطة' : 'منخفضة'}</span>
          </div>
          <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--ds-text-muted)' }}>
            {ir.sourceName && <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{ir.sourceName}</span>}
            {ir.daysWaiting > 0 && <span className="flex items-center gap-1" style={{ color: ir.daysWaiting > 30 ? '#ef4444' : ir.daysWaiting > 14 ? '#eab308' : 'inherit' }}><Clock className="w-3 h-3" />{ir.daysWaiting} يوم</span>}
            {ir.documentCount > 0 && <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{ir.documentCount} ملف</span>}
            {ir.assignedTo && <span className="flex items-center gap-1"><User className="w-3 h-3" />محقق</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <ActionIcon className="w-4 h-4" style={{ color: colors.text }} />
        </div>
      </div>
    </div>
  );
}

export default function InvestigationWorkspace() {
  const { c, checklist, requests, timeline } = useCaseContext();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const workspace = useMemo(() => {
    if (!INVESTIGATION_V2 || !checklist) return null;

    const requirements = checklist.map(item => {
      const ir = InformationRequirementEngine.fromChecklistItem(item);
      return {
        ...ir,
        daysWaiting: item.days_waiting || 0,
        documentCount: (item.documents || []).length || 0,
        sourceName: item.source_agency_name || null,
        sourceType: item.source_type || 'government_agency',
        nextAction: InformationRequirementEngine.getNextAction({ status: ir.status, priority: ir.priority }, { daysWaiting: item.days_waiting || 0 }),
      };
    });

    return InformationRequirementEngine.buildWorkspace(requirements);
  }, [checklist, requests, timeline]);

  if (!INVESTIGATION_V2) {
    return (
      <div className="rounded-lg p-6 text-center" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
        <FileText className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--ds-text-muted)' }} />
        <div className="text-sm" style={{ color: 'var(--ds-text-muted)' }}>فعّل INVESTIGATION_V2 لاستخدام مساحة العمل الجديدة</div>
      </div>
    );
  }

  if (!workspace) {
    return <div className="text-center py-8" style={{ color: 'var(--ds-text-muted)' }}>جاري تحميل المتطلبات...</div>;
  }

  const r = workspace.readiness;
  const readinessColor = r.overall === 'ready' ? '#22c55e' : r.overall === 'progressing' ? '#3b82f6' : r.overall === 'at_risk' ? '#ef4444' : '#eab308';

  let items = workspace.all;
  if (filter === 'urgent') items = workspace.urgent;
  else if (filter === 'awaiting') items = workspace.awaiting;
  else if (filter === 'verifying') items = workspace.verifying;
  else if (filter === 'pending') items = workspace.pending;
  else if (filter === 'completed') items = workspace.completed;

  if (search) items = items.filter(ir =>
    ir.question.includes(search) || (ir.sourceName || '').includes(search)
  );

  return (
    <div className="space-y-4">
      {/* Readiness Bar */}
      <div className="rounded-lg p-4" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" style={{ color: readinessColor }} />
            <span className="font-semibold text-sm" style={{ color: 'var(--ds-text-primary)' }}>جاهزية التوثيق</span>
          </div>
          <span className="text-xs font-bold" style={{ color: readinessColor }}>{r.overallLabel.ar}</span>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <div className="flex-1 h-2 rounded-full" style={{ background: 'var(--ds-bg-tertiary)' }}>
            <div className="h-2 rounded-full" style={{ width: `${r.coveragePercent}%`, background: readinessColor, transition: 'width 0.5s' }} />
          </div>
          <span className="text-[10px] font-semibold" style={{ color: 'var(--ds-text-muted)' }}>{r.coveragePercent}%</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <div className="text-center"><div className="text-sm font-bold" style={{ color: '#22c55e' }}>{r.satisfied}</div><div className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>مكتمل</div></div>
          <div className="text-center"><div className="text-sm font-bold" style={{ color: '#eab308' }}>{r.inProgress}</div><div className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>قيد التنفيذ</div></div>
          <div className="text-center"><div className="text-sm font-bold" style={{ color: '#ef4444' }}>{r.blocked}</div><div className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>مسدود</div></div>
          <div className="text-center"><div className="text-sm font-bold" style={{ color: '#8b5cf6' }}>{r.followUpsDue}</div><div className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>متابعة مطلوبة</div></div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {[
          { key: 'all', label: 'الكل' },
          { key: 'urgent', label: `عاجل (${workspace.urgent.length})` },
          { key: 'awaiting', label: `بانتظار الرد (${workspace.awaiting.length})` },
          { key: 'verifying', label: `قيد التوثيق (${workspace.verifying.length})` },
          { key: 'pending', label: `معلق (${workspace.pending.length})` },
          { key: 'completed', label: `مكتمل (${workspace.completed.length})` },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className="text-[11px] px-3 py-1.5 rounded-lg ds-transition-colors font-medium"
            style={{ background: filter === f.key ? 'var(--ds-accent)' : 'var(--ds-bg-tertiary)', color: filter === f.key ? 'white' : 'var(--ds-text-muted)', border: '1px solid var(--ds-border)' }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--ds-text-muted)' }} />
        <input className="w-full rounded-lg py-2 pl-9 pr-3 text-sm" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
          placeholder="بحث في المتطلبات..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Blocked Alert */}
      {workspace.urgent.filter(r => r.status === 'blocked').length > 0 && (
        <div className="rounded-lg p-3 flex items-start gap-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#ef4444' }} />
          <div className="text-sm" style={{ color: '#ef4444' }}>
            <strong>{workspace.urgent.filter(r => r.status === 'blocked').length} متطلبات مسدودة</strong> — تحتاج تدخل المدير
          </div>
        </div>
      )}

      {/* Requirement List */}
      {items.length === 0 ? (
        <div className="text-center py-8" style={{ color: 'var(--ds-text-muted)' }}>
          {filter === 'all' ? 'لم يتم تحديد متطلبات معلومات بعد' : 'لا توجد متطلبات في هذا التصنيف'}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(ir => <RequirementCard key={ir.id} ir={ir} />)}
        </div>
      )}
    </div>
  );
}
