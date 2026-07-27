import { ArrowRight, Building2, ClipboardCheck, User, Calendar, AlertTriangle } from 'lucide-react';
import { useCaseContext } from '../context/CaseContext';
import AppBadge from '../../../components/ds/AppBadge';
import AppStack from '../../../components/ds/AppStack';

import { memo } from 'react';
export default memo(function NextActionPanel() {
  const { checklist, requests, team, timeline } = useCaseContext();

  // Find the first incomplete checklist item
  const nextChecklist = (checklist || []).find(i =>
    (i.receipt_status !== 'received' && i.status !== 'received') &&
    (i.receipt_status !== 'will_not_receive' && i.status !== 'will_not_receive')
  );

  // Find first pending agency
  const nextAgency = (requests || []).find(r => r.status === 'sent' || !r.status);

  // Determine risk
  const pendingCount = (checklist || []).filter(i =>
    i.receipt_status !== 'received' && i.status !== 'received' &&
    i.receipt_status !== 'will_not_receive'
  ).length;
  const risk = pendingCount >= 5 ? 'danger' : pendingCount >= 3 ? 'warning' : 'success';
  const riskLabel = pendingCount >= 5 ? 'مرتفع' : pendingCount >= 3 ? 'متوسط' : 'منخفض';

  return (
    <div className="p-4 rounded-xl" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
      <div className="flex items-center gap-2 mb-3">
        <ArrowRight className="w-4 h-4" style={{ color: 'var(--ds-accent)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>الإجراء التالي</span>
      </div>
      <AppStack gap="8px">
        {nextChecklist && (
          <div className="flex items-center gap-2 text-xs">
            <ClipboardCheck className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ds-warning)' }} />
            <span className="font-medium shrink-0" style={{ color: 'var(--ds-text-muted)' }}>السجل:</span>
            <span style={{ color: 'var(--ds-text-primary)' }}>متابعة حالة التسجيل</span>
          </div>
        )}
        {nextAgency && (
          <div className="flex items-center gap-2 text-xs">
            <Building2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ds-info)' }} />
            <span className="font-medium shrink-0" style={{ color: 'var(--ds-text-muted)' }}>الجهة:</span>
            <span style={{ color: 'var(--ds-text-primary)' }}>{nextAgency.agencies?.name_en || 'بانتظار رد'}</span>
          </div>
        )}
        {team?.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <User className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ds-accent)' }} />
            <span className="font-medium shrink-0" style={{ color: 'var(--ds-text-muted)' }}>المسؤول:</span>
            <span style={{ color: 'var(--ds-text-primary)' }}>{team[0].users?.name || 'غير محدد'}</span>
          </div>
        )}
        <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: 'var(--ds-border)' }}>
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" style={{ color: 'var(--ds-' + risk + ')' }} />
            <span className="text-[11px]" style={{ color: 'var(--ds-text-muted)' }}>مخاطر:</span>
            <AppBadge variant={risk}>{riskLabel}</AppBadge>
          </div>
          <span className="text-[11px]" style={{ color: 'var(--ds-text-muted)' }}>
            {pendingCount} معلقة
          </span>
        </div>
      </AppStack>
    </div>
  )});
