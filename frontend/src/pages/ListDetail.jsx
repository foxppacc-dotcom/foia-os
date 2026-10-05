import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import usePipelinePerms from '../components/pipeline/usePipelinePerms';
import ListMetaBar from '../components/pipeline/ListMetaBar';
import ManageMetaModal from '../components/pipeline/ManageMetaModal';
import CardTagZone from '../components/pipeline/CardTagPopover';


// pipeline_lists ids are seeded/inserted per environment, not guaranteed to
// be 1-7 in a fixed order -- a hardcoded id->color/name fallback map here
// would show an arbitrary, unrelated color/name for whichever list actually
// happens to hold that id (same bug class already fixed in
// cases.js/production.js/classifier.js/automation.js this session). The
// real `data.color`/`data.name_ar` from the API is always correct; a
// neutral, data-independent default covers the rare case those are unset.
const DEFAULT_LIST_COLOR = '#6B7280';

export default function ListDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filters, setFilters] = useState({ labelIds: new Set(), milestone: null });
  const [manageOpen, setManageOpen] = useState(false);
  const { canManage, canTag } = usePipelinePerms();

  const load = () => api.get(`/pipeline/lists/${id}`).then(d => {
    setData(d.data || {});
    // Drop filter ids whose label/milestone was just deleted, otherwise the list
    // shows "no matching cards" with no chip left to deselect.
    const liveLabels = new Set((d.data?.labels || []).map(l => l.id));
    const liveMilestones = new Set((d.data?.milestones || []).map(m => m.id));
    setFilters(f => ({
      labelIds: new Set([...f.labelIds].filter(i => liveLabels.has(i))),
      milestone: typeof f.milestone === 'number' && !liveMilestones.has(f.milestone) ? null : f.milestone,
    }));
    setError(false);
    setLoading(false);
  }).catch(() => { setError(true); setLoading(false); });

  useEffect(() => {
    setLoading(true);
    setFilters({ labelIds: new Set(), milestone: null });
    load();
  }, [id]);

  // Patch one card locally after a tag change (no full refetch).
  const patchRequest = (requestId, patch) => setData(prev => ({
    ...prev,
    requests: (prev.requests || []).map(r => r.id === requestId ? { ...r, ...patch } : r),
  }));

  if (error) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3" dir="rtl">
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>تعذر تحميل القائمة</p>
      <button onClick={() => { setLoading(true); load(); }} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: '#1A1A2E' }}>إعادة المحاولة</button>
    </div>
  );

  if (loading || !data) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-10 h-10 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
    </div>
  );

  const color = data.color || DEFAULT_LIST_COLOR;
  const listName = data.name_ar || 'قائمة';
  const labels = data.labels || [];
  const milestones = data.milestones || [];
  const allRequests = data.requests || [];
  // Label filter is OR within labels; label and milestone filters combine with AND.
  const visibleRequests = allRequests.filter(r => {
    if (filters.labelIds.size && !(r.labels || []).some(l => filters.labelIds.has(l.id))) return false;
    if (filters.milestone === 'none' && r.milestone) return false;
    if (typeof filters.milestone === 'number' && r.milestone?.id !== filters.milestone) return false;
    return true;
  });
  const filtered = filters.labelIds.size > 0 || filters.milestone !== null;

  return (
    <div className="space-y-6 animate-fadeIn max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border"
        style={{ background: color + '26', borderColor: color + '40' }}>
        <button onClick={() => navigate('/pipeline')}
          className="p-2 rounded-xl" style={{ color: 'var(--text-secondary)' }}>←</button>
        <div className="w-4 h-4 rounded-full" style={{ background: color }} />
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{listName}</h1>
        <span className="px-2.5 py-1 rounded-lg font-bold" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: `1px solid ${color}55` }}>
          {filtered ? `${visibleRequests.length} / ${allRequests.length}` : allRequests.length} بطاقة
        </span>
      </div>

      <ListMetaBar labels={labels} milestones={milestones} requests={allRequests}
        filters={filters} onFiltersChange={setFilters} canManage={canManage} onManage={() => setManageOpen(true)} />
      <ManageMetaModal open={manageOpen} onClose={() => setManageOpen(false)} listId={data.id}
        labels={labels} milestones={milestones} onChanged={load} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* بطاقات القائمة */}
        <div className="md:col-span-2 space-y-3">
          <h2 className="font-bold" style={{ color: 'var(--text-primary)' }}>📋 البطاقات</h2>
          {visibleRequests.length === 0 ? (
            <div className="p-8 rounded-xl border text-center" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
              <p style={{ color: 'var(--text-muted)' }}>{filtered ? 'لا توجد بطاقات مطابقة للفلتر' : 'لا توجد بطاقات في هذه القائمة'}</p>
            </div>
          ) : visibleRequests.map(r => (
            <div key={r.id} onClick={() => r.case_id && navigate(`/cases/${r.case_id}`)}
              className="p-4 rounded-xl border cursor-pointer transition-all flex flex-col md:flex-row md:items-stretch gap-4"
              style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
              onMouseOver={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
              onMouseOut={e => e.currentTarget.style.background = 'var(--bg-secondary)'}>
              {/* بيانات البطاقة */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono font-bold" style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>#{r.case_id || r.id}</span>
                  {r.case_priority === 'high' && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: '#EF444420', color: '#EF4444' }}>🔴 عاجل</span>
                  )}
                </div>
                <p className="font-bold" style={{ color: 'var(--text-primary)' }}>{r.case_title || r.title || 'بدون عنوان'}</p>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {r.agency_name_ar && <span style={{ color: 'var(--text-muted)' }}>🏛️ {r.agency_name_ar}</span>}
                  {r.sent_date && <span style={{ color: 'var(--text-muted)' }}>📅 {new Date(r.sent_date).toLocaleDateString('ar-EG')}</span>}
                </div>
              </div>
              {/* مساحتا Labels و Milestone — أيقونة فقط، اضغط للتعديل */}
              <div className="md:w-72 shrink-0 flex flex-col gap-2 md:ps-4 md:border-s" style={{ borderColor: 'var(--border)' }}>
                <CardTagZone kind="labels" request={r} labels={labels} milestones={milestones} canEdit={canTag} onSaved={patch => patchRequest(r.id, patch)} />
                <CardTagZone kind="milestone" request={r} labels={labels} milestones={milestones} canEdit={canTag} onSaved={patch => patchRequest(r.id, patch)} />
              </div>
            </div>
          ))}
        </div>

        {/* فريق العمل + النشاط */}
        <div className="space-y-4">
          {/* فريق القائمة */}
          <div className="p-5 rounded-xl border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
            <h2 className="font-bold mb-3" style={{ color: 'var(--accent)' }}>👥 فريق العمل</h2>
            {(data.assignees || []).length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>لم يتم تعيين فريق</p>
            ) : (data.assignees || []).map(a => (
              <div key={a.id} className="flex items-center gap-2 py-1.5">
                <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs"
                  style={{ background: color + '20', color }}>{a.name?.charAt(0)}</div>
                <div>
                  <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{a.name}</p>
                  <p style={{ color: 'var(--text-muted)' }}>{a.role === 'admin' ? 'مدير' : 'عضو'}</p>
                </div>
              </div>
            ))}
          </div>

          {/* النشاط */}
          <div className="p-5 rounded-xl border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
            <h2 className="font-bold mb-3" style={{ color: 'var(--accent)' }}>📋 النشاط</h2>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {(data.activity || []).length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>لا يوجد نشاط مسجل</p>
              ) : (data.activity || []).map(a => (
                <div key={a.id} className="py-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{a.details || a.action_type}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{a.created_at}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
