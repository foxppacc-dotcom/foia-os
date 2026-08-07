import { useCaseContext } from '../context/CaseContext';
import { Phone, Siren, Camera, Video, Car, Mic, ClipboardList, FileText, CheckCircle, Circle, MinusCircle, Building2, Users, Activity } from 'lucide-react';
import AppSection from '../../../components/ds/AppSection';
import AppEmptyState from '../../../components/ds/AppEmptyState';
import AppStack from '../../../components/ds/AppStack';
import InvestigationSummary from './InvestigationSummary';
import FollowUpCenter from './FollowUpCenter';
import InvestigationNotes from './InvestigationNotes';
import SourceBadge from './SourceBadge';
import CaseClassificationSelector from './CaseClassificationSelector';

const recordMeta = {
  '911_calls': { label: 'مكالمات 911', icon: Phone },
  'emergency_calls': { label: 'مكالمات الطوارئ', icon: Siren },
  'cctv': { label: 'كاميرات المراقبة', icon: Camera },
  'body_cam': { label: 'كاميرات الجسد', icon: Video },
  'dash_cam': { label: 'كاميرات السيارات', icon: Car },
  'interrogation_video': { label: 'تسجيلات غرفة التحقيق', icon: Mic },
  'victim_statement': { label: 'التحقيق مع الضحية', icon: ClipboardList },
};

const statusLabels = {
  received: 'تم الاستلام', pending: 'قيد الانتظار', not_started: 'لم يبدأ',
  requested: 'تم الطلب', waiting: 'بانتظار الرد', partially_received: 'استلمت جزئياً',
  completed: 'مكتمل', rejected: 'مرفوض', not_applicable: 'غير مطبق',
};

export default function OverviewTab() {
  const { c, requests, team, documents, checklist, timeline, records_progress } = useCaseContext();

  const stats = [
    { v: requests?.length || 0, l: 'جهات', c: 'var(--ds-accent)', icon: Building2 },
    { v: team?.length || 0, l: 'فريق', c: 'var(--ds-info)', icon: Users },
    { v: documents?.length || 0, l: 'ملفات', c: '#8B5CF6', icon: FileText },
    { v: timeline?.length || 0, l: 'نشاط', c: 'var(--ds-warning)', icon: Activity },
  ];

  const received = checklist?.filter(i => i.status === 'completed' || i.status === 'received' || i.receipt_status === 'received').length || 0;
  const missing = checklist?.filter(i => i.status === 'rejected' || i.status === 'will_not_receive' || i.receipt_status === 'will_not_receive' || i.doc_status === 'no_documents').length || 0;
  const pending = (checklist?.length || 0) - received - missing;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 ds-animate-fadeIn">
      <div className="lg:col-span-7 space-y-4">
        <CaseClassificationSelector />
        <InvestigationSummary />
      </div>
      <div className="lg:col-span-5 space-y-4">
        {/* Quick stats + السجلات -- kept in their own column, independent of
            معلومات القضية's height, so expanding ملخص القضية (resizable) on
            the left never pushes or disrupts these. */}
        <div className="grid grid-cols-4 gap-2.5">
          {stats.map((s, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5 p-3 rounded-lg text-center ds-hover-lift" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: s.c + '18' }}>
                <s.icon className="w-4 h-4" style={{ color: s.c }} />
              </div>
              <div>
                <p className="text-base font-bold" style={{ color: s.c }}>{s.v}</p>
                <p className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>{s.l}</p>
              </div>
            </div>
          ))}
        </div>
        <AppSection title="السجلات">
          {checklist?.length > 0 && (
            <div className="flex items-center gap-3 mb-3 text-[11px]">
              <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3" style={{ color: 'var(--ds-success)' }} /> {received} مستلم</span>
              <span className="flex items-center gap-1"><MinusCircle className="w-3 h-3" style={{ color: 'var(--ds-warning)' }} /> {pending} معلق</span>
              <span className="flex items-center gap-1"><Circle className="w-3 h-3" style={{ color: 'var(--ds-text-muted)' }} /> {missing} غير متوفر</span>
            </div>
          )}
          {checklist?.length > 0 ? (
            <div className="grid grid-cols-1 gap-2">
              {checklist.map(item => {
                const meta = recordMeta[item.record_type];
                const RIcon = meta?.icon || FileText;
                const isDone = item.receipt_status === 'received' || item.status === 'received';
                const isNeg = item.receipt_status === 'will_not_receive' || item.status === 'will_not_receive' || item.doc_status === 'no_documents';
                const Icon = isDone ? CheckCircle : isNeg ? Circle : MinusCircle;
                const icoColor = isDone ? 'var(--ds-success)' : isNeg ? 'var(--ds-text-muted)' : 'var(--ds-warning)';
                const statusText = statusLabels[item.status] || statusLabels[item.receipt_status] || '';
                return (
                  <div key={item.id ?? item.record_type} className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)' }}>
                    <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: icoColor }} />
                    <span className="text-xs flex-1" style={{ color: 'var(--ds-text-primary)' }}>{meta?.label || item.record_type}</span>
                    {statusText && <span className="text-[10px]" style={{ color: icoColor }}>{statusText}</span>}
                  </div>
                );
              })}
            </div>
          ) : <AppEmptyState compact title="لم يتم إعداد قائمة التدقيق" />}
        </AppSection>
        <div className="p-4 rounded-xl" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
          <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ds-text-secondary)' }}>آخر المستندات ({documents?.length || 0})</p>
          {documents?.length > 0 ? (
            <AppStack gap="8px">
              {documents.slice(0, 5).map(doc => (
                <div key={doc.id} className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)' }}>
                  <FileText className="w-4 h-4 shrink-0" style={{ color: 'var(--ds-text-muted)' }} />
                  <span className="text-xs flex-1 truncate" style={{ color: 'var(--ds-text-primary)' }}>{doc.original_name || doc.filename}</span>
                  <SourceBadge reliability="official" importance="high" />
                </div>
              ))}
            </AppStack>
          ) : <p className="text-xs" style={{ color: 'var(--ds-text-muted)' }}>لا توجد مستندات بعد</p>}
        </div>
        <FollowUpCenter />
        <InvestigationNotes />
      </div>
    </div>
  );
}
