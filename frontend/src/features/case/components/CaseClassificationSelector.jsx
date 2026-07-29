import { useState, useEffect } from 'react';
import { api } from '../../../api';
import { useCaseContext } from '../context/CaseContext';
import { Tag } from 'lucide-react';

// Classification lives on requests.classification_id (FK -> pipeline_lists.id) --
// the SAME field Cases.jsx's list dropdown and Pipeline.jsx's kanban board
// already read/write via PUT /requests/:id/classification. This is the one
// authoritative classification source; setting it here for every request in
// the case keeps the Pipeline board and Cases list in sync automatically,
// with no separate storage or sync logic needed.
export default function CaseClassificationSelector() {
  const { requests, refetch } = useCaseContext();
  const [lists, setLists] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/pipeline-lists').then(d => setLists(d.data || [])).catch(() => {});
  }, []);

  const classificationIds = new Set((requests || []).map(r => r.classification_id).filter(v => v != null));
  const isMixed = classificationIds.size > 1;
  const current = classificationIds.size === 1 ? [...classificationIds][0] : '';

  const handleChange = async (e) => {
    const value = e.target.value;
    if (!value || !requests?.length) return;
    setSaving(true);
    try {
      await Promise.all(requests.map(r => api.put(`/requests/${r.id}/classification`, { classification_id: parseInt(value) })));
      refetch();
    } catch (err) {
      console.error('classification update failed:', err.message);
    }
    setSaving(false);
  };

  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
      <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--ds-text-secondary)' }}>
        <Tag className="w-3.5 h-3.5" />التصنيف / خط الإنتاج
      </span>
      {!requests?.length ? (
        <span className="text-xs" style={{ color: 'var(--ds-text-muted)' }}>أضف جهات أولاً لتتمكن من التصنيف</span>
      ) : (
        <select
          className="px-2.5 py-1.5 rounded-lg text-xs min-w-[160px]"
          style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
          value={current}
          disabled={saving}
          onChange={handleChange}
        >
          <option value="">{isMixed ? '↕️ مختلف بين الجهات' : '📋 اختر تصنيف...'}</option>
          {lists.map(l => <option key={l.id} value={l.id}>{l.name_ar}</option>)}
        </select>
      )}
    </div>
  );
}
