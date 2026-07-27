import { Target, Lightbulb, Search, Layers, FileText, Building2, Users, Activity } from 'lucide-react';
import { useCaseContext } from '../context/CaseContext';
import AppStack from '../../../components/ds/AppStack';
import AppBadge from '../../../components/ds/AppBadge';

import { memo } from 'react';
export default memo(function InvestigationSummary() {
  const { c, team, documents, requests, checklist, timeline } = useCaseContext();
  const received = checklist?.filter(i => i.receipt_status === 'received' || i.status === 'received').length || 0;
  const pendingReqs = (requests || []).filter(r => r.status === 'sent' || !r.status).length;

  return (
    <div className="p-4 rounded-xl" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-4 h-4" style={{ color: 'var(--ds-accent)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>ملخص التحقيق</span>
      </div>
      <AppStack gap="8px">
        <div className="flex items-center gap-2 text-xs">
          <Lightbulb className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ds-accent)' }} />
          <span className="font-medium shrink-0" style={{ color: 'var(--ds-text-muted)' }}>الهدف:</span>
          <span style={{ color: 'var(--ds-text-primary)' }}>{c.title}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ds-info)' }} />
          <span className="font-medium shrink-0" style={{ color: 'var(--ds-text-muted)' }}>السؤال:</span>
          <span style={{ color: 'var(--ds-text-primary)' }}>{c.description || 'جمع الأدلة والمستندات'}</span>
        </div>
        {c.client_name && (
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium shrink-0" style={{ color: 'var(--ds-text-muted)' }}>العميل:</span>
            <span style={{ color: 'var(--ds-text-primary)' }}>{c.client_name}</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs">
          <Layers className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ds-accent)' }} />
          <span className="font-medium shrink-0" style={{ color: 'var(--ds-text-muted)' }}>المرحلة:</span>
          <AppBadge variant={c.status === 'open' ? 'info' : c.status === 'in_progress' ? 'warning' : 'success'}>
            {c.status === 'open' ? 'جمع المعلومات' : c.status === 'in_progress' ? 'تحليل الأدلة' : 'إكتمل'}
          </AppBadge>
        </div>
        <div className="flex items-center gap-3 text-[11px] pt-1 flex-wrap">
          <span className="flex items-center gap-1"><FileText className="w-3 h-3" style={{ color: 'var(--ds-success)' }} />{(documents?.length||0)} ملف</span>
          <span className="flex items-center gap-1"><Building2 className="w-3 h-3" style={{ color: 'var(--ds-accent)' }} />{(requests?.length||0)} جهة</span>
          <span className="flex items-center gap-1"><Users className="w-3 h-3" style={{ color: 'var(--ds-info)' }} />{(team?.length||0)} فريق</span>
          <span className="flex items-center gap-1"><Activity className="w-3 h-3" style={{ color: 'var(--ds-warning)' }} />{(timeline?.length||0)} نشاط</span>
        </div>
        {received > 0 && <div className="text-xs" style={{ color: 'var(--ds-success)' }}>{received} سجل مكتمل</div>}
        {pendingReqs > 0 && <div className="text-xs" style={{ color: 'var(--ds-warning)' }}>{pendingReqs} جهة بانتظار الرد</div>}
      </AppStack>
    </div>
  )});
