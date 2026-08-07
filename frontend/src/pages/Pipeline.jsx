import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Users } from 'lucide-react';

const LIST_STYLES_BY_ID = {
  1: { bg: '#10B981', label: '✅ تم استلام السجلات', emoji: '✅' },
  2: { bg: '#F59E0B', label: '💰 مطلوب دفع', emoji: '💰' },
  3: { bg: '#6B7280', label: '🚫 مفيش سجلات متوفرة', emoji: '🚫' },
  4: { bg: '#EF4444', label: '⛔ تم الرفض بموجب القانون', emoji: '⛔' },
  5: { bg: '#8B5CF6', label: '⚖️ القضية مفتوحة في المحكمة', emoji: '⚖️' },
  6: { bg: '#F97316', label: '📷 الوكالة لا تستخدم البودي كام', emoji: '📷' },
  7: { bg: '#EC4899', label: '🆔 محتاج تأكيد مواطنة', emoji: '🆔' },
};

// Response-deadline chip for a pipeline card -- expected_response_date is
// real, populated data (set the moment a request is sent via email/portal,
// see documentCenter.js) already used for overdue tracking elsewhere in the
// app (CaseHeader, Dashboard). Cards had this mostly-empty bottom row with
// only agency name on the left; surfacing the deadline here fills that
// space with the single most actionable fact for a production-board card.
function getDeadlineChip(item) {
  if (item.response_date) return { text: 'تم الرد', color: 'var(--success, #10B981)' };
  if (!item.expected_response_date) return null;
  const todayStr = new Date().toISOString().split('T')[0];
  const daysLeft = Math.floor((new Date(item.expected_response_date) - new Date(todayStr)) / 86400000);
  if (item.expected_response_date < todayStr) return { text: `متأخر ${Math.abs(daysLeft)} يوم`, color: '#EF4444' };
  if (daysLeft <= 3) return { text: `باقي ${daysLeft} يوم`, color: '#F59E0B' };
  return { text: `باقي ${daysLeft} يوم`, color: 'var(--text-muted)' };
}

// Avatars + a checkbox popover for who's responsible for this list -- the
// list_assignees API already existed and worked, but the only UI for it
// was buried in Settings' "إدارة قوائم الإنتاج" tab (hover-only) or
// read-only in ListDetail.jsx; this puts it directly on the board itself.
// The popover renders through a portal into document.body rather than as a
// CSS-absolute child, because every list card/column wrapper uses
// overflow-hidden (for its rounded corners) -- an absolutely-positioned
// child would get silently clipped by that ancestor, or hidden behind the
// next column, instead of floating above the whole board.
function ListAssignees({ listId, listColor, assignees, allUsers, isOpen, onToggle, onSave }) {
  const btnRef = useRef(null);
  const popoverRef = useRef(null);
  const [coords, setCoords] = useState(null);

  useEffect(() => {
    if (!isOpen || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setCoords({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onClickOutside = (e) => {
      if (btnRef.current?.contains(e.target) || popoverRef.current?.contains(e.target)) return;
      onToggle(null);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [isOpen]);

  const assignedIds = new Set((assignees || []).map(a => a.user_id));
  const toggleUser = (userId) => {
    const next = assignedIds.has(userId) ? [...assignedIds].filter(id => id !== userId) : [...assignedIds, userId];
    onSave(listId, next);
  };

  return (
    <div onClick={e => e.stopPropagation()}>
      <button ref={btnRef} onClick={() => onToggle(isOpen ? null : listId)}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors"
        style={{ background: listColor + '15', color: listColor }} title="المسؤولون عن هذه القائمة">
        <Users className="w-3 h-3" />
        {assignees?.length > 0 ? (
          <span className="flex -space-x-1.5" style={{ direction: 'ltr' }}>
            {assignees.slice(0, 3).map(a => (
              <span key={a.user_id} className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold border"
                style={{ background: listColor, color: 'white', borderColor: 'var(--bg-secondary)' }} title={a.name}>{a.name?.[0] || '?'}</span>
            ))}
            {assignees.length > 3 && <span className="text-[9px]">+{assignees.length - 3}</span>}
          </span>
        ) : <span className="text-[10px]">إسناد</span>}
      </button>
      {isOpen && coords && createPortal(
        <div ref={popoverRef} onClick={e => e.stopPropagation()}
          className="fixed z-50 w-56 rounded-xl border p-2 space-y-1 max-h-64 overflow-y-auto"
          style={{ top: coords.top, left: coords.left, background: 'var(--bg-secondary)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}>
          <p className="text-[10px] px-1 pb-1" style={{ color: 'var(--text-muted)' }}>المسؤولون عن هذه القائمة</p>
          {(allUsers || []).length === 0 ? (
            <p className="text-xs px-1" style={{ color: 'var(--text-muted)' }}>لا يوجد أعضاء</p>
          ) : allUsers.map(u => (
            <label key={u.id} className="flex items-center gap-2 px-1.5 py-1 rounded-lg cursor-pointer text-xs" style={{ color: 'var(--text-primary)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <input type="checkbox" checked={assignedIds.has(u.id)} onChange={() => toggleUser(u.id)} className="w-3.5 h-3.5" />
              {u.name}
            </label>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

export default function Pipeline() {
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draggedItem, setDraggedItem] = useState(null);
  const [draggedItemInside, setDraggedItemInside] = useState(null);
  // كل الصفوف مفتوحة افتراضياً — Set من الأرقام
  const [openLists, setOpenLists] = useState(() => {
    const saved = localStorage.getItem('foia_pipeline_open');
    if (saved) return new Set(JSON.parse(saved));
    // Default: كل القوائم مفتوحة (1-8)
    return new Set([1,2,3,4,5,6,7,8]);
  });
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('foia_pipeline_view') || 'rows');
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('foia_pipeline_sort') || 'newest');
  const [assigneesByList, setAssigneesByList] = useState({});
  const [allUsers, setAllUsers] = useState([]);
  const [openAssignFor, setOpenAssignFor] = useState(null);
  // Role-based Production Line visibility from /permissions/mine. null = loading
  // → show everything; {} = unconfigured → default open (never hides by default).
  const [prodVisibility, setProdVisibility] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    api.get('/permissions/mine')
      .then(d => { if (!cancelled) setProdVisibility(d.productionVisibility || {}); })
      .catch(() => { if (!cancelled) setProdVisibility({}); });
    return () => { cancelled = true; };
  }, []);

  const isListVisible = (list) => {
    if (prodVisibility === null) return true;                     // still loading
    if (Object.keys(prodVisibility).length === 0) return true;    // unconfigured — default open
    return prodVisibility[String(list.list_number)] !== false;    // hidden only when explicitly false
  };

  const fetchAssignees = (listIds) => {
    Promise.all(listIds.map(id => api.get(`/pipeline/lists/${id}/assignees`).then(d => [id, d.data || []]).catch(() => [id, []])))
      .then(entries => setAssigneesByList(Object.fromEntries(entries)));
  };

  useEffect(() => {
    api.get('/users').then(d => setAllUsers(d.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (lists.length) fetchAssignees(lists.map(l => l.id));
  }, [lists]);

  const saveAssignees = async (listId, userIds) => {
    try {
      const d = await api.post(`/pipeline/lists/${listId}/assignees`, { user_ids: userIds });
      setAssigneesByList(prev => ({ ...prev, [listId]: d.data || [] }));
    } catch {}
  };

  const saveOpenLists = (newSet) => {
    setOpenLists(newSet);
    localStorage.setItem('foia_pipeline_open', JSON.stringify([...newSet]));
  };

  const toggleList = (listNumber) => {
    const newSet = new Set(openLists);
    if (newSet.has(listNumber)) newSet.delete(listNumber);
    else newSet.add(listNumber);
    saveOpenLists(newSet);
  };

  const changeSort = (mode) => {
    setSortBy(mode);
    localStorage.setItem('foia_pipeline_sort', mode);
    fetchPipeline(mode);
  };

  const fetchPipeline = (sortMode) => {
    const s = sortMode || sortBy;
    api.getPipeline(s === 'oldest' ? '?sort_by=oldest' : '').then(d => {
      const data = Array.isArray(d) ? d : d.data || d.lists || [];
      setLists(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { fetchPipeline(); }, []);

  const moveRequest = async (requestId, toListId) => {
    try {
      await api.put(`/requests/${requestId}/classification`, { classification_id: toListId });
      fetchPipeline();
    } catch {}
  };

  // ترتيب البطاقات داخل القائمة — Drag & Drop internally
  const handleInternalDragStart = (e, requestId, fromList, index) => {
    setDraggedItemInside({ requestId, fromList, index });
    e.dataTransfer.setData('internal', 'true');
    e.dataTransfer.setData('requestId', String(requestId));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleInternalDrop = async (e, toList, toIndex) => {
    e.preventDefault();
    setDraggedItemInside(null);
    const data = e.dataTransfer.getData('internal');
    if (!data) return; // cross-list move, handled by handleDrop
    const requestId = parseInt(e.dataTransfer.getData('requestId'));
    if (!requestId) return;

    const items = toList.requests || toList.tasks || [];
    // Update sort_order for all items in the list
    const newOrder = items.map(item => item.id);
    // Move the dragged item to new position
    const idx = newOrder.indexOf(requestId);
    if (idx > -1) newOrder.splice(idx, 1);
    newOrder.splice(toIndex, 0, requestId);

    // Save new order
    for (let i = 0; i < newOrder.length; i++) {
      await api.put(`/requests/${newOrder[i]}/sort`, { sort_order: (newOrder.length - i) });
    }
    fetchPipeline();
  };

  // Cross-list drag
  const handleDragStart = (e, requestId, fromList) => {
    setDraggedItem(requestId);
    e.dataTransfer.setData('requestId', String(requestId));
    e.dataTransfer.setData('fromList', String(fromList));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const handleDrop = (e, toListNumber) => {
    e.preventDefault();
    setDraggedItem(null);
    const requestId = e.dataTransfer.getData('requestId');
    if (requestId) moveRequest(parseInt(requestId), toListNumber);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-10 h-10 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
    </div>
  );

  const totalCards = lists.reduce((sum, l) => sum + (l.requests?.length || l.tasks?.length || 0), 0);

  return (
    <div className="h-full flex flex-col animate-fadeIn" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📋 خط الإنتاج</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{totalCards} بطاقة</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Sort Toggle */}
          <select value={sortBy} onChange={e => changeSort(e.target.value)}
            className="px-3 py-1.5 rounded-lg border text-sm"
            style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            <option value="newest">🆕 الأحدث أولاً</option>
            <option value="oldest">🕰️ الأقدم أولاً</option>
          </select>
          {/* View Toggle */}
          <div className="flex items-center gap-1 rounded-xl border p-1"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-tertiary)' }}>
            <button onClick={() => { setViewMode('rows'); localStorage.setItem('foia_pipeline_view', 'rows'); }}
              className="px-3 py-1.5 rounded-lg font-medium transition-all"
              style={{
                background: viewMode === 'rows' ? 'var(--accent)' : 'transparent',
                color: viewMode === 'rows' ? '#1A1A2E' : 'var(--text-secondary)'
              }}>📋 صفوف</button>
            <button onClick={() => { setViewMode('columns'); localStorage.setItem('foia_pipeline_view', 'columns'); }}
              className="px-3 py-1.5 rounded-lg font-medium transition-all"
              style={{
                background: viewMode === 'columns' ? 'var(--accent)' : 'transparent',
                color: viewMode === 'columns' ? '#1A1A2E' : 'var(--text-secondary)'
              }}>📊 أعمدة</button>
          </div>
        </div>
      </div>

      {viewMode === 'columns' ? (
        /* ===== أعمدة — تمرير عام واحد ===== */
        <div className="flex-1 overflow-y-auto">
          <div className="flex gap-4 pb-4" style={{ minHeight: '100%' }}>
            {lists.filter(isListVisible).map(col => {
              const items = col.requests || col.tasks || [];
              const st = LIST_STYLES_BY_ID[col.id] || { bg: '#6B7280', label: col.name_ar };
              return (
                <div key={col.id} className="flex flex-col shrink-0 rounded-2xl overflow-hidden"
                  style={{ minWidth: '280px', maxWidth: '340px', minHeight: '100%', boxShadow: 'var(--shadow-sm)' }}
                  onDragOver={handleDragOver} onDrop={e => handleDrop(e, col.id)}>
                  <div className="px-4 py-3 border border-b-0 flex items-center justify-between"
                    style={{ background: st.bg + '15', borderColor: st.bg + '30' }}>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ background: st.bg }} />
                      <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>{col.name_ar}</h3>
                      <span className="px-2 py-0.5 rounded font-bold cursor-pointer hover:opacity-80 transition-opacity"
                        style={{ background: st.bg + '20', color: st.bg }}
                        onClick={() => navigate(`/pipeline/lists/${col.id}`)}>{items.length}</span>
                    </div>
                    <ListAssignees listId={col.id} listColor={st.bg} assignees={assigneesByList[col.id]} allUsers={allUsers}
                      isOpen={openAssignFor === col.id} onToggle={setOpenAssignFor} onSave={saveAssignees} />
                  </div>
                  <div className="flex-1 p-3 space-y-2.5 border overflow-y-auto"
                    style={{ borderColor: st.bg + '30', background: 'var(--bg-primary)', minHeight: '200px' }}>
                    {items.length === 0 ? (
                      <div className="flex items-center justify-center py-12 rounded-xl border-2 border-dashed" style={{ borderColor: 'var(--border)' }}>
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>📥 اسحب البطاقة هنا</p>
                      </div>
                    ) : items.map((item, idx) => (
                      <div key={item.id} draggable
                        onDragStart={e => handleInternalDragStart(e, item.id, col.list_number, idx)}
                        onDragEnd={() => setDraggedItemInside(null)}
                        onClick={() => item.case_id && navigate(`/cases/${item.case_id}`)}
                        className="rounded-2xl border cursor-grab active:cursor-grabbing transition-all duration-150 hover:-translate-y-0.5"
                        style={{
                          background: 'var(--bg-secondary)', borderColor: 'var(--border)',
                          opacity: draggedItem === item.id || draggedItemInside?.requestId === item.id ? 0.4 : 1,
                          boxShadow: 'var(--shadow-sm)',
                        }}
                        onDragOver={e => { e.preventDefault(); }}
                        onDrop={e => handleInternalDrop(e, col, idx)}>
                        <div className="px-4 py-3">
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold" style={{ color: st.bg, fontSize: '1rem' }}>#{item.case_id || item.id}</span>
                            {item.priority === 'high' && <span className="px-1.5 py-0.5 rounded text-xs font-medium" style={{ background: '#EF444420', color: '#EF4444' }}>عاجل</span>}
                          </div>
                          <p className="font-medium leading-snug line-clamp-2 mt-1" style={{ color: 'var(--text-primary)' }}>{item.case_title || item.title || 'بدون عنوان'}</p>
                          <div className="flex items-center justify-between text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
                            {item.agency_name_ar && <span className="truncate">🏛️ {item.agency_name_ar}</span>}
                            {(() => { const d = getDeadlineChip(item); return d && <span className="shrink-0 font-medium" style={{ color: d.color }}>⏳ {d.text}</span>; })()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* ===== صفوف — كلها مفتوحة افتراضياً ===== */
        <div className="flex-1 overflow-y-auto space-y-3 pb-4">
          {lists.filter(isListVisible).map(col => {
            const items = col.requests || col.tasks || [];
            const st = LIST_STYLES_BY_ID[col.id] || { bg: '#6B7280', label: col.name_ar };
            const isOpen = openLists.has(col.list_number);

            return (
              <div key={col.id} onDragOver={handleDragOver} onDrop={e => handleDrop(e, col.id)}
                className="rounded-2xl border overflow-hidden transition-all"
                style={{ background: 'var(--bg-secondary)', borderColor: st.bg + '30', boxShadow: 'var(--shadow-sm)' }}>

                {/* List Header */}
                <div className="flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer"
                  style={{ background: st.bg + '12' }}
                  onClick={() => toggleList(col.list_number)}>
                  <div className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: st.bg }} />
                  <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>{st.label}</h3>
                  <span className="px-2.5 py-1 rounded-lg font-bold cursor-pointer hover:opacity-80 transition-opacity"
                    style={{ background: st.bg + '20', color: st.bg }}
                    onClick={(e) => { e.stopPropagation(); navigate(`/pipeline/lists/${col.list_number}`); }}>{items.length}</span>
                  <ListAssignees listId={col.id} listColor={st.bg} assignees={assigneesByList[col.id]} allUsers={allUsers}
                    isOpen={openAssignFor === col.id} onToggle={setOpenAssignFor} onSave={saveAssignees} />
                  <span className="mr-auto transition-transform" style={{ color: 'var(--text-muted)', transform: isOpen ? 'rotate(0deg)' : 'rotate(180deg)' }}>▲</span>
                </div>

                {/* Cards Container — دايماً موجود لو open (بدون && شرط) */}
                <div className={isOpen ? 'p-3 overflow-x-auto' : 'hidden'}>
                  {items.length === 0 ? (
                    <div className="flex items-center justify-center py-8 rounded-xl border-2 border-dashed" style={{ borderColor: 'var(--border)' }}>
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>📥 اسحب البطاقة هنا</p>
                    </div>
                  ) : (
                    <div className="flex gap-3" style={{ minWidth: 'max-content' }}>
                      {items.map((item, idx) => (
                        <div key={item.id} draggable
                          onDragStart={e => handleInternalDragStart(e, item.id, col.list_number, idx)}
                          onDragEnd={() => setDraggedItemInside(null)}
                          onClick={() => item.case_id && navigate(`/cases/${item.case_id}`)}
                          className="w-72 rounded-2xl border cursor-grab active:cursor-grabbing transition-all duration-150 group shrink-0 hover:-translate-y-0.5"
                          style={{
                            background: 'var(--bg-secondary)',
                            borderColor: draggedItem === item.id || draggedItemInside?.requestId === item.id ? st.bg : 'var(--border)',
                            opacity: draggedItem === item.id || draggedItemInside?.requestId === item.id ? 0.4 : 1,
                            boxShadow: (draggedItem === item.id || draggedItemInside?.requestId === item.id) ? `0 0 0 2px ${st.bg}40` : 'var(--shadow-sm)'
                          }}
                          onDragOver={e => { e.preventDefault(); }}
                          onDrop={e => handleInternalDrop(e, col, idx)}>
                          <div className="px-4 py-3.5">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="font-mono font-bold" style={{ color: st.bg, fontSize: '1rem' }}>#{item.case_id || item.id}</span>
                              {item.priority === 'high' && <span className="px-1.5 py-0.5 rounded text-xs font-medium" style={{ background: '#EF444420', color: '#EF4444' }}>عاجل</span>}
                            </div>
                            <p className="font-medium leading-snug line-clamp-2 mb-2" style={{ color: 'var(--text-primary)' }}>{item.case_title || item.title || 'بدون عنوان'}</p>
                            <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
                              {item.agency_name_ar && <span className="truncate">🏛️ {item.agency_name_ar}</span>}
                              {(() => { const d = getDeadlineChip(item); return d && <span className="shrink-0 font-medium" style={{ color: d.color }}>⏳ {d.text}</span>; })()}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
