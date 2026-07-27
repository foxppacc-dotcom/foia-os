import { AlertTriangle, FileText, Building2, ClipboardCheck } from 'lucide-react';
import { useCaseContext } from '../context/CaseContext';
import AppBadge from '../../../components/ds/AppBadge';
import AppStack from '../../../components/ds/AppStack';

const recordLabels = {
  '911_calls': 'مكالمات 911', 'emergency_calls': 'مكالمات الطوارئ',
  'cctv': 'كاميرات المراقبة', 'body_cam': 'كاميرات الجسد',
  'dash_cam': 'كاميرات السيارات', 'interrogation_video': 'تسجيلات التحقيق',
  'victim_statement': 'التحقيق مع الضحية',
};

export default function MissingEvidence() {
  const { documents, requests, checklist } = useCaseContext();

  // Real data only - items actually missing
  const missingChecklist = (checklist || []).filter(i =>
    i.receipt_status !== 'received' && i.status !== 'received' &&
    i.receipt_status !== 'will_not_receive' && i.status !== 'will_not_receive'
  );
  const pendingRequests = (requests || []).filter(r => r.status === 'sent' || !r.status);
  const noDocs = !documents?.length;

  const items = [];
  missingChecklist.forEach(i => items.push({ type: 'checklist', label: recordLabels[i.record_type] || i.record_type }));
  pendingRequests.forEach(r => items.push({ type: 'agency', label: r.agencies?.name_ar || r.agencies?.name_en || 'جهة' }));
  if (noDocs) items.push({ type: 'document', label: 'لم يتم رفع أي مستند' });

  if (items.length === 0) return null;

  return (
    <div className="p-4 rounded-xl" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-warning)' }}>
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4" style={{ color: 'var(--ds-warning)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>أدلة مفقودة ({items.length})</span>
      </div>
      <AppStack gap="6px">
        {items.slice(0, 8).map((item, i) => (
          <div key={i} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)' }}>
            {item.type === 'checklist' && <ClipboardCheck className="w-3.5 h-3.5" style={{ color: 'var(--ds-warning)' }} />}
            {item.type === 'agency' && <Building2 className="w-3.5 h-3.5" style={{ color: 'var(--ds-info)' }} />}
            {item.type === 'document' && <FileText className="w-3.5 h-3.5" style={{ color: 'var(--ds-danger)' }} />}
            <span className="text-xs flex-1" style={{ color: 'var(--ds-text-primary)' }}>{item.label}</span>
            <AppBadge variant={item.type === 'checklist' ? 'warning' : item.type === 'agency' ? 'info' : 'danger'}>
              {item.type === 'checklist' ? 'معلق' : item.type === 'agency' ? 'انتظار' : 'مفقود'}
            </AppBadge>
          </div>
        ))}
      </AppStack>
    </div>
  );
}
