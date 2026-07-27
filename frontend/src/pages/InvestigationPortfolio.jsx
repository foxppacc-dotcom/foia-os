import { useMemo, useState } from 'react';
import { OperationalDecisionEngine } from '../../domain/engines/OperationalDecisionEngine';
import AppBadge from '../../../components/ds/AppBadge';
import { Search, Filter, TrendingUp, AlertCircle, Clock, Eye, CheckCircle, XCircle, Building2, User, Calendar, ArrowUpCircle, FileText } from 'lucide-react';

const INVESTIGATION_V2 = import.meta.env.VITE_INVESTIGATION_V2 === 'true' || localStorage.getItem('INVESTIGATION_V2') === 'true';

const STAGE_LABELS = {
  planning: 'تخطيط', research: 'بحث', requests: 'طلبات', waiting: 'انتظار',
  collection: 'جمع', verification: 'مراجعة', ready: 'جاهز', archived: 'مؤرشف',
};

const MODE_BUTTONS = [
  { key: 'all', label: 'الكل', icon: FileText, color: '#3b82f6' },
  { key: 'critical', label: 'حرج فقط', icon: AlertCircle, color: '#ef4444' },
  { key: 'follow_up', label: 'متابعة مطلوبة', icon: Clock, color: '#eab308' },
  { key: 'blocked', label: 'مسدود', icon: XCircle, color: '#ef4444' },
  { key: 'verification', label: 'بانتظار التوثيق', icon: Eye, color: '#8b5cf6' },
  { key: 'recent', label: 'نشط مؤخرًا', icon: TrendingUp, color: '#22c55e' },
  { key: 'ready', label: 'جاهز للإنتاج', icon: CheckCircle, color: '#22c55e' },
];

function InvestigationCard({ inv }) {
  const r = inv.readiness || {};
  const healthColor = r.overall === 'ready' ? '#22c55e' : r.overall === 'at_risk' ? '#ef4444' : r.overall === 'progressing' ? '#3b82f6' : '#eab308';

  return (
    <div className="rounded-lg p-3 ds-transition-colors cursor-pointer" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', borderLeft: `3px solid ${healthColor}` }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--ds-bg-tertiary)'}
      onMouseLeave={e => e.currentTarget.style.background = 'var(--ds-bg-secondary)'}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="font-semibold text-sm truncate" style={{ color: 'var(--ds-text-primary)' }}>{inv.title}</span>
            {inv.priority === 'critical' && <span className="text-[9px] px-1 rounded font-bold" style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>حرج</span>}
          </div>
          <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>
            <span>{STAGE_LABELS[inv.investigation_stage] || inv.status}</span>
            <span className="flex items-center gap-1"><User className="w-3 h-3" />{inv.ownerCount || 0}</span>
            {inv.daysSinceActivity !== undefined && <span>{inv.daysSinceActivity} يوم</span>}
          </div>
        </div>
        <div className="text-center shrink-0">
          <div className="text-lg font-bold" style={{ color: healthColor }}>{r.coveragePercent || inv.coverage || 0}%</div>
          <div className="text-[8px]" style={{ color: 'var(--ds-text-muted)' }}>{r.overallLabel?.ar || '—'}</div>
        </div>
      </div>
      {/* Health bar */}
      <div className="h-1.5 rounded-full mt-2" style={{ background: 'var(--ds-bg-tertiary)' }}>
        <div className="h-1.5 rounded-full" style={{ width: `${r.coveragePercent || inv.coverage || 0}%`, background: healthColor, transition: 'width 0.5s' }} />
      </div>
      {/* Alert badges */}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {(inv.blockedCount || 0) > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>{inv.blockedCount} مسدود</span>}
        {(inv.followUpCount || 0) > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(234,179,8,0.12)', color: '#eab308' }}>{inv.followUpCount} متابعة</span>}
        {(inv.verificationCount || 0) > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(139,92,246,0.12)', color: '#8b5cf6' }}>{inv.verificationCount} توثيق</span>}
        {inv.isOverdue && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>متأخر</span>}
      </div>
    </div>
  );
}

export default function InvestigationPortfolio() {
  const [mode, setMode] = useState('all');
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('all');

  // Sample data — in real app, this comes from API
  // Using ODE + existing data to compute portfolio view
  const portfolio = useMemo(() => {
    if (!INVESTIGATION_V2) return null;
    // Placeholder: will be populated from API
    return { investigations: [], total: 0 };
  }, []);

  return (
    <div className="space-y-4">
      {/* Mode buttons */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {MODE_BUTTONS.map(m => (
          <button key={m.key} onClick={() => setMode(m.key)}
            className="flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-lg font-medium ds-transition-colors"
            style={{ background: mode === m.key ? m.color + '20' : 'var(--ds-bg-tertiary)', color: mode === m.key ? m.color : 'var(--ds-text-muted)', border: `1px solid ${mode === m.key ? m.color + '40' : 'var(--ds-border)'}` }}>
            <m.icon className="w-3 h-3" />
            {m.label}
          </button>
        ))}
      </div>

      {/* Search + Stage filter */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--ds-text-muted)' }} />
          <input className="w-full rounded-lg py-2 pr-9 pl-3 text-sm" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
            placeholder="بحث في التحقيقات..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="text-[11px] px-2 py-2 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
          value={stageFilter} onChange={e => setStageFilter(e.target.value)}>
          <option value="all">كل المراحل</option>
          <option value="planning">تخطيط</option>
          <option value="research">بحث</option>
          <option value="requests">طلبات</option>
          <option value="waiting">انتظار</option>
          <option value="collection">جمع</option>
          <option value="verification">مراجعة</option>
          <option value="ready">جاهز</option>
          <option value="archived">مؤرشف</option>
        </select>
      </div>

      {/* Summary */}
      {portfolio && portfolio.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-lg p-2 text-center" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
            <div className="text-lg font-bold" style={{ color: '#22c55e' }}>{portfolio.healthy || 0}</div>
            <div className="text-[9px]" style={{ color: 'var(--ds-text-muted)' }}">صحي</div>
          </div>
          <div className="rounded-lg p-2 text-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <div className="text-lg font-bold" style={{ color: '#ef4444' }}>{portfolio.atRisk || 0}</div>
            <div className="text-[9px]" style={{ color: 'var(--ds-text-muted)' }}">في خطر</div>
          </div>
          <div className="rounded-lg p-2 text-center" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
            <div className="text-lg font-bold" style={{ color: '#eab308' }}>{portfolio.followUps || 0}</div>
            <div className="text-[9px]" style={{ color: 'var(--ds-text-muted)' }}">متابعة</div>
          </div>
          <div className="rounded-lg p-2 text-center" style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)' }}>
            <div className="text-lg font-bold" style={{ color: '#8b5cf6' }}>{portfolio.ready || 0}</div>
            <div className="text-[9px]" style={{ color: 'var(--ds-text-muted)' }}">جاهز</div>
          </div>
        </div>
      )}

      {/* Investigation Grid */}
      {(!portfolio || portfolio.total === 0) && (
        <div className="text-center py-12" style={{ color: 'var(--ds-text-muted)' }}>
          <TrendingUp className="w-10 h-10 mx-auto mb-2" />
          <div className="text-sm">محفظة التحقيقات</div>
          <div className="text-[10px]">يعرض جميع التحقيقات مع حالة الجاهزية والصحّة</div>
        </div>
      )}

      {/* Investigation cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {(portfolio?.investigations || []).map(inv => (
          <InvestigationCard key={inv.id} inv={inv} />
        ))}
      </div>
    </div>
  );
}
