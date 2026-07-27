import { useState } from 'react';
import { FileText, Clock, User, Pin, Search, PinOff } from 'lucide-react';
import { useCaseContext } from '../context/CaseContext';
import AppInput from '../../../components/ds/AppInput';
import AppBadge from '../../../components/ds/AppBadge';
import AppEmptyState from '../../../components/ds/AppEmptyState';
import AppStack from '../../../components/ds/AppStack';

import { memo } from 'react';
export default memo(function InvestigationNotes() {
  const { checklist, timeline } = useCaseContext();
  const [search, setSearch] = useState('');
  const [pinned, setPinned] = useState({});

  // Use checklist notes + timeline as "notes" source (no new API)
  const notes = (checklist || [])
    .filter(i => i.notes)
    .map(i => ({ id: i.id, text: i.notes, author: 'System', date: i.updated_at || i.created_at || '', type: 'checklist', record_type: i.record_type }))
    .concat(
      (timeline || []).filter(t => t.details || t.target_title?.length > 40).map(t => ({
        id: 'tl_' + t.id, text: t.target_title || '', author: t.user_name || 'System', date: t.created_at || '', type: 'activity',
      }))
    )
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const filtered = search ? notes.filter(n => n.text?.toLowerCase().includes(search.toLowerCase())) : notes;

  return (
    <div className="p-4 rounded-xl" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
      <div className="flex items-center gap-2 mb-3">
        <FileText className="w-4 h-4" style={{ color: 'var(--ds-accent)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>ملاحظات التحقيق ({notes.length})</span>
      </div>
      <AppInput value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث في الملاحظات..." className="mb-3" />
      {filtered.length > 0 ? (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {filtered.slice(0, 20).map(n => (
            <div key={n.id} className="p-2 rounded-lg ds-transition-colors" style={{ background: pinned[n.id] ? 'var(--ds-accent-subtle)' : 'var(--ds-bg-tertiary)' }}>
              <div className="flex items-start gap-1.5">
                <p className="text-[11px] flex-1" style={{ color: 'var(--ds-text-primary)' }}>{n.text}</p>
                <button onClick={() => setPinned(p => ({ ...p, [n.id]: !p[n.id] }))} className="p-0.5 shrink-0" style={{ color: pinned[n.id] ? 'var(--ds-accent)' : 'var(--ds-text-muted)' }}>
                  {pinned[n.id] ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--ds-text-muted)' }}><User className="w-2.5 h-2.5" />{n.author}</span>
                <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--ds-text-muted)' }}><Clock className="w-2.5 h-2.5" />{n.date?.substring(0, 10) || ''}</span>
                {n.type === 'checklist' && <AppBadge variant="neutral">سجل</AppBadge>}
              </div>
            </div>
          ))}
        </div>
      ) : <AppEmptyState compact icon={FileText} title={search ? 'لا توجد نتائج' : 'لا توجد ملاحظات'} />}
    </div>
  );
});
