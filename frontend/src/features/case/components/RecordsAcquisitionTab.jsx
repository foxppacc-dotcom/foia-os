import { useMemo, useState } from 'react';
import { useCaseContext } from '../context/CaseContext';
import { AcquisitionEngine, SOURCE_TYPES, ACQUISITION_STRATEGIES } from '../../domain/engines/AcquisitionEngine';
import AppCard from '../../../components/ds/AppCard';
import AppBadge from '../../../components/ds/AppBadge';
import AppButton from '../../../components/ds/AppButton';
import AppEmptyState from '../../../components/ds/AppEmptyState';
import { Search, Send, Phone, Globe, Clock, AlertCircle, CheckCircle, FileText, User, Calendar } from 'lucide-react';

const INVESTIGATION_V2 = import.meta.env.VITE_INVESTIGATION_V2 === 'true' || localStorage.getItem('INVESTIGATION_V2') === 'true';

function RecordCard({ item, acquisition }) {
  const urgency = acquisition.nextAction?.urgency || 'neutral';
  const bgColors = { info: 'rgba(59,130,246,0.08)', warning: 'rgba(234,179,8,0.08)', danger: 'rgba(239,68,68,0.08)', accent: 'rgba(139,92,246,0.08)', success: 'rgba(34,197,94,0.08)', neutral: 'transparent' };
  const borderColors = { info: '#3b82f6', warning: '#eab308', danger: '#ef4444', accent: '#8b5cf6', success: '#22c55e', neutral: 'var(--ds-border)' };

  return (
    <div className="rounded-lg p-4 flex items-start gap-3 ds-transition-colors"
      style={{ background: bgColors[urgency] || 'var(--ds-bg-secondary)', border: '1px solid ' + (borderColors[urgency] || 'var(--ds-border)'), borderLeft: '3px solid ' + (borderColors[urgency] || 'var(--ds-border)') }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="font-semibold text-sm" style={{ color: 'var(--ds-text-primary)' }}>{item.recordMeta?.label || item.record_type}</span>
          <AppBadge variant={urgency}>{acquisition.nextAction?.label || acquisition.status}</AppBadge>
          {acquisition.dueDate && <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--ds-text-muted)' }}><Calendar className="w-3 h-3" />{acquisition.dueDate}</span>}
        </div>
        <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--ds-text-muted)' }}>
          {acquisition.source && <span>{acquisition.source}</span>}
          <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{acquisition.documentCount || 0}</span>
          {acquisition.daysWaiting > 0 && <span className="flex items-center gap-1" style={{ color: acquisition.daysWaiting > 30 ? '#ef4444' : acquisition.daysWaiting > 15 ? '#eab308' : 'inherit' }}><Clock className="w-3 h-3" />{acquisition.daysWaiting} يوم</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {acquisition.strategy === 'email' && <Send className="w-4 h-4" style={{ color: 'var(--ds-info)' }} />}
        {acquisition.strategy === 'phone' && <Phone className="w-4 h-4" style={{ color: 'var(--ds-accent)' }} />}
        {acquisition.strategy === 'portal' && <Globe className="w-4 h-4" style={{ color: 'var(--ds-warning)' }} />}
      </div>
    </div>
  );
}

export default function RecordsAcquisitionTab() {
  const { c, checklist, requests, timeline } = useCaseContext();
  const [search, setSearch] = useState('');

  const workspace = useMemo(() => {
    if (!INVESTIGATION_V2 || !checklist) return null;
    return AcquisitionEngine.buildWorkspace(checklist, requests || [], timeline || [], {});
  }, [checklist, requests, timeline]);

  if (!INVESTIGATION_V2) {
    return <AppEmptyState icon={FileText} title="مساحة الحصول على السجلات" description="فعّل INVESTIGATION_V2 لاستخدام هذه المساحة" />;
  }

  if (!workspace || workspace.items.length === 0) {
    return <AppEmptyState icon={FileText} title="مساحة الحصول على السجلات" description="لم يتم تحديد أي سجلات مطلوبة بعد" />;
  }

  const filtered = workspace.items.filter(a =>
    !search || a.recordType.includes(search) || (a.source || '').includes(search)
  );

  return (
    <div className="space-y-4">
      {/* Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'السجلات المطلوبة', value: workspace.summary.total, color: 'var(--ds-text-primary)' },
          { label: 'المتبقي', value: workspace.summary.missing, color: workspace.summary.missing > 0 ? '#ef4444' : '#22c55e' },
          { label: 'بانتظار الرد', value: workspace.summary.followUpsNeeded, color: '#eab308' },
          { label: 'مكتمل', value: workspace.summary.completed, color: '#22c55e' },
        ].map(s => (
          <div key={s.label} className="rounded-lg p-3 text-center" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
            <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[11px]" style={{ color: 'var(--ds-text-muted)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Missing Records Alert */}
      {workspace.missingRecords.length > 0 && (
        <div className="rounded-lg p-3 flex items-start gap-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#ef4444' }} />
          <div>
            <div className="text-sm font-semibold" style={{ color: '#ef4444' }}>{workspace.missingRecords.length} سجلات لم يتم الحصول عليها بعد</div>
            <div className="text-[11px]" style={{ color: 'var(--ds-text-muted)' }}>
              {workspace.missingRecords.map(r => r.label).join('، ')}
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      {filtered.length > 5 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--ds-text-muted)' }} />
          <input className="w-full rounded-lg py-2 pl-9 pr-3 text-sm" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
            placeholder="بحث في السجلات..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      )}

      {/* Record List */}
      <div className="space-y-2">
        {filtered.map(a => (
          <RecordCard key={a.recordType} item={a} acquisition={a} />
        ))}
      </div>
    </div>
  );
}
