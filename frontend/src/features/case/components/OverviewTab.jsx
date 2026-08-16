import { useCaseContext } from '../context/CaseContext';
import { Phone, Siren, Camera, Video, Car, Mic, ClipboardList, FileText, Building2, Users, Activity, MessageSquare } from 'lucide-react';
import AppSection from '../../../components/ds/AppSection';
import AppBadge from '../../../components/ds/AppBadge';
import AppEmptyState from '../../../components/ds/AppEmptyState';
import AppStack from '../../../components/ds/AppStack';
import InvestigationSummary from './InvestigationSummary';
import FollowUpCenter from './FollowUpCenter';
import InvestigationNotes from './InvestigationNotes';
import SourceBadge from './SourceBadge';
import CaseClassificationSelector from './CaseClassificationSelector';
import TeamDiscussion from './TeamDiscussion';
import TriageResultCard from './TriageResultCard';

const recordMeta = {
  '911_calls': { label: 'مكالمات 911', icon: Phone },
  'emergency_calls': { label: 'مكالمات الطوارئ', icon: Siren },
  'cctv': { label: 'كاميرات المراقبة', icon: Camera },
  'body_cam': { label: 'كاميرات الجسد', icon: Video },
  'dash_cam': { label: 'كاميرات السيارات', icon: Car },
  'interrogation_video': { label: 'تسجيلات غرفة التحقيق', icon: Mic },
  'victim_statement': { label: 'التحقيق مع الضحية', icon: ClipboardList },
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} د`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} س`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `منذ ${days} يوم`;
  return new Date(dateStr).toLocaleDateString('ar-EG');
}

export default function OverviewTab() {
  const { c, requests, team, documents, checklist, timeline, comments, records_progress, setActiveTab } = useCaseContext();

  const stats = [
    { v: requests?.length || 0, l: 'جهات', c: 'var(--ds-accent)', icon: Building2 },
    { v: team?.length || 0, l: 'فريق', c: 'var(--ds-info)', icon: Users },
    { v: documents?.length || 0, l: 'ملفات', c: '#8B5CF6', icon: FileText },
    { v: timeline?.length || 0, l: 'نشاط', c: 'var(--ds-warning)', icon: Activity },
  ];

  // Each checklist item's own notes thread lives in the same case_comments
  // table as نقاش الفريق, scoped by record_type -- reused here just to show
  // the latest note per item, so "السجلات" reads as a live snapshot instead
  // of a frozen status badge nobody updates anymore.
  const notesByType = {};
  for (const cm of comments || []) {
    if (!cm.record_type) continue;
    if (!notesByType[cm.record_type] || new Date(cm.created_at) > new Date(notesByType[cm.record_type].created_at)) {
      notesByType[cm.record_type] = cm;
    }
  }

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
        <TriageResultCard />
        <TeamDiscussion />
        <AppSection title="السجلات">
          {checklist?.length > 0 ? (
            <div className="grid grid-cols-1 gap-2">
              {checklist.map(item => {
                const meta = recordMeta[item.record_type];
                const Icon = meta?.icon || FileText;
                const latest = notesByType[item.record_type];
                return (
                  <div key={item.id ?? item.record_type}
                    className="flex items-center gap-2.5 p-3 rounded-lg cursor-pointer ds-hover-lift"
                    style={{ background: 'var(--ds-bg-tertiary)' }}
                    onClick={() => setActiveTab?.('checklist')}>
                    <Icon className="w-4 h-4 shrink-0" style={{ color: 'var(--ds-accent)' }} />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm" style={{ color: 'var(--ds-text-primary)' }}>{meta?.label || item.record_type}</span>
                      {latest && (
                        <p className="text-[11px] truncate" style={{ color: 'var(--ds-text-muted)' }}>
                          <span style={{ color: 'var(--ds-text-secondary)' }}>{latest.user_name || 'النظام'}</span>
                          {': '}{latest.content || latest.attachment_name || '—'} · {timeAgo(latest.created_at)}
                        </p>
                      )}
                    </div>
                    {latest && <AppBadge variant="neutral" className="shrink-0"><MessageSquare className="w-3 h-3" /></AppBadge>}
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
