import { Clock, CalendarDays, Circle } from 'lucide-react';
import { useCaseContext } from '../context/CaseContext';
import AppSection from '../../../components/ds/AppSection';
import AppEmptyState from '../../../components/ds/AppEmptyState';

export default function TimelineTab() {
  const { timeline } = useCaseContext();
  const groups = {};
  (timeline || []).forEach(log => {
    const date = log.created_at?.substring(0, 10) || 'unknown';
    if (!groups[date]) groups[date] = [];
    groups[date].push(log);
  });
  const sorted = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  const dot = (a) => a === 'create' ? 'var(--ds-success)' : a === 'delete' ? 'var(--ds-danger)' : 'var(--ds-accent)';

  return (
    <AppSection title={'الخط الزمني (' + (timeline?.length || 0) + ')'}>
      {sorted.length > 0 ? (
        <div className="max-h-[65vh] overflow-y-auto space-y-4">
          {sorted.map(date => (
            <div key={date}>
              <div className="flex items-center gap-2 mb-1.5 sticky top-0 py-1 z-10" style={{ background: 'var(--ds-bg-secondary)' }}>
                <CalendarDays className="w-3.5 h-3.5" style={{ color: 'var(--ds-text-muted)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--ds-text-secondary)' }}>
                  {new Date(date + 'T00:00:00').toLocaleDateString('ar-SA', { weekday: 'long', month: 'long', day: 'numeric' })}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>{groups[date].length}</span>
              </div>
              <div className="space-y-0.5 mr-4 border-r-2" style={{ borderColor: 'var(--ds-border)' }}>
                {groups[date].map(log => (
                  <div key={log.id} className="flex items-start gap-2.5 pr-3 pb-1.5 pt-1">
                    <div className="w-2 h-2 rounded-full mt-1 -mr-[5px] shrink-0 border-2" style={{ background: dot(log.action_type), borderColor: 'var(--ds-bg-secondary)' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm" style={{ color: 'var(--ds-text-secondary)' }}>{log.target_title || log.action_type}</p>
                      <div className="flex items-center gap-2 text-[11px] mt-0.5" style={{ color: 'var(--ds-text-muted)' }}>
                        <span>{log.user_name || 'System'}</span>
                        <span>·</span>
                        <Clock className="w-3 h-3" />
                        <span>{log.created_at ? new Date(log.created_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : <AppEmptyState compact icon={Clock} title="لا توجد نشاطات" />}
    </AppSection>
  );
}
