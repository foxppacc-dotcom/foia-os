import { Building2, Clock, Send } from 'lucide-react';
import { useCaseContext } from '../context/CaseContext';
import AppBadge from '../../../components/ds/AppBadge';
import AppEmptyState from '../../../components/ds/AppEmptyState';
import AppStack from '../../../components/ds/AppStack';

import { memo } from 'react';
export default memo(function FollowUpCenter() {
  const { requests } = useCaseContext();
  const pending = (requests || []).filter(r => r.status === 'sent' || !r.status);

  if (pending.length === 0) return null;

  return (
    <div className="p-4 rounded-xl" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
      <div className="flex items-center gap-2 mb-3">
        <Send className="w-4 h-4" style={{ color: 'var(--ds-accent)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>متابعة ({pending.length})</span>
      </div>
      <AppStack gap="6px">
        {pending.slice(0, 5).map(r => (
          <div key={r.id} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)' }}>
            <Building2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ds-accent)' }} />
            <span className="text-xs flex-1" style={{ color: 'var(--ds-text-primary)' }}>{r.agencies?.name_en || 'جهة'}</span>
            <span className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>بانتظار الرد</span>
          </div>
        ))}
      </AppStack>
    </div>
  );
});
