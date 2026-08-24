import { useState, useCallback, useMemo } from 'react';
import { Search, ChevronDown, ChevronUp, FileText, MessageSquare, Camera, Video, Mic, Phone, Car, Siren, ClipboardList } from 'lucide-react';
import { useCaseContext } from '../context/CaseContext';
import AppCard from '../../../components/ds/AppCard';
import AppBadge from '../../../components/ds/AppBadge';
import AppButton from '../../../components/ds/AppButton';
import AppStack from '../../../components/ds/AppStack';
import AppEmptyState from '../../../components/ds/AppEmptyState';
import ChecklistNotes from './ChecklistNotes';

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

// Every "بند" (item) is now just its own notes thread -- no status buttons,
// no separate detail panel, no quick-actions. Opening one shows exactly
// ChecklistNotes, the same mechanics as نقاش الفريق (reply/mention/
// attachment/link/delete), scoped to this record_type.
function ChecklistCard({ item, notes, expanded, onToggle }) {
  const meta = recordMeta[item.record_type];
  const Icon = meta?.icon || FileText;
  const latest = notes[notes.length - 1];

  return (
    <AppCard padding="14px" className="ds-transition-colors">
      <div className="flex items-center gap-2.5 cursor-pointer" onClick={onToggle} role="button" tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && onToggle()} aria-label={meta?.label}>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--ds-accent-subtle, rgba(212,168,67,0.12))' }}>
          <Icon className="w-4 h-4" style={{ color: 'var(--ds-accent)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>{meta?.label || item.record_type}</span>
            {notes.length > 0 && <AppBadge variant="neutral"><MessageSquare className="w-3 h-3" /> {notes.length}</AppBadge>}
          </div>
          {latest ? (
            <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--ds-text-muted)' }}>
              <span style={{ color: 'var(--ds-text-secondary)' }}>{latest.user_name || 'النظام'}</span>
              {': '}{latest.content || latest.attachment_name || '—'} · {timeAgo(latest.created_at)}
            </p>
          ) : (
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--ds-text-muted)' }}>لا توجد ملاحظات بعد</p>
          )}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 shrink-0" style={{ color: 'var(--ds-text-muted)' }} />
                 : <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--ds-text-muted)' }} />}
      </div>

      {expanded && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--ds-border)' }}>
          <ChecklistNotes recordType={item.record_type} />
        </div>
      )}
    </AppCard>
  );
}

export default function ChecklistTab() {
  const { checklist, comments } = useCaseContext();
  const [expandedItems, setExpandedItems] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('alphabetical');

  const notesByType = useMemo(() => {
    const map = {};
    for (const c of comments || []) {
      if (!c.record_type) continue;
      (map[c.record_type] = map[c.record_type] || []).push(c);
    }
    for (const key in map) map[key].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return map;
  }, [comments]);

  const toggleItem = useCallback((id) => {
    setExpandedItems(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const filtered = useMemo(() => {
    let items = [...(checklist || [])];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i => {
        const meta = recordMeta[i.record_type];
        const notes = notesByType[i.record_type] || [];
        return (meta?.label || i.record_type).toLowerCase().includes(q)
          || notes.some(n => (n.content || '').toLowerCase().includes(q));
      });
    }
    if (sortBy === 'alphabetical') {
      items.sort((a, b) => (recordMeta[a.record_type]?.label || '').localeCompare(recordMeta[b.record_type]?.label || ''));
    } else if (sortBy === 'recently_noted') {
      items.sort((a, b) => {
        const aLatest = (notesByType[a.record_type] || []).at(-1)?.created_at || '';
        const bLatest = (notesByType[b.record_type] || []).at(-1)?.created_at || '';
        return bLatest.localeCompare(aLatest);
      });
    } else if (sortBy === 'most_notes') {
      items.sort((a, b) => (notesByType[b.record_type]?.length || 0) - (notesByType[a.record_type]?.length || 0));
    }
    return items;
  }, [checklist, searchQuery, sortBy, notesByType]);

  const expandAll = useCallback(() => {
    const all = {};
    (checklist || []).forEach(i => { all[i.id] = true; });
    setExpandedItems(all);
  }, [checklist]);

  const collapseAll = useCallback(() => setExpandedItems({}), []);

  return (
    <div className="space-y-4 ds-animate-fadeIn">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
            <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ds-text-muted)' }} />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="بحث في السجلات أو الملاحظات..."
              className="w-full text-xs bg-transparent border-0 outline-none ds-focus-ring" style={{ color: 'var(--ds-text-primary)' }}
              aria-label="بحث في قائمة التدقيق" />
          </div>
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          className="p-2 rounded-lg border text-xs ds-focus-ring" style={{ background: 'var(--ds-bg-secondary)', borderColor: 'var(--ds-border-strong)', color: 'var(--ds-text-primary)' }}
          aria-label="ترتيب حسب">
          <option value="alphabetical">ترتيب أبجدي</option>
          <option value="recently_noted">آخر ملاحظة</option>
          <option value="most_notes">عدد الملاحظات</option>
        </select>
        <AppButton size="sm" variant="secondary" onClick={expandAll}>فتح الكل</AppButton>
        <AppButton size="sm" variant="secondary" onClick={collapseAll}>إغلاق الكل</AppButton>
      </div>

      {filtered.length > 0 ? (
        <AppStack gap="8px">
          {filtered.map(item => (
            <ChecklistCard key={item.id} item={item} notes={notesByType[item.record_type] || []}
              expanded={!!expandedItems[item.id]} onToggle={() => toggleItem(item.id)} />
          ))}
        </AppStack>
      ) : (
        <AppEmptyState icon={ClipboardList} title={searchQuery ? 'لا توجد نتائج للبحث' : 'لم يتم إعداد قائمة التدقيق'}
          description={searchQuery ? 'حاول تغيير كلمات البحث' : 'أضف سجلات من لوحة الإعدادات'} />
      )}
    </div>
  );
}
