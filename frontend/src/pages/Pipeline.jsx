import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Users } from 'lucide-react';
import { useToast } from '../components/ui/Toast';
import usePipelinePerms from '../components/pipeline/usePipelinePerms';
import { LabelChip, MilestonePill } from '../components/pipeline/chips';

// Each list carries its own color (pipeline_lists.color, editable in the list
// settings) -- the header strip, dot, badge and card accents all derive from it.
const DEFAULT_LIST_COLOR = '#6B7280';
const listStyle = (col) => ({ bg: /^#[0-9a-fA-F]{6}$/.test(col.color || '') ? col.color : DEFAULT_LIST_COLOR, label: col.name_ar });

// Small label/milestone chips on an overview card (read-only here; editing
// happens inside the list page).
function CardMeta({ item }) {
  if (!item.milestone && !(item.labels || []).length) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap mt-1.5">
      {item.milestone && <MilestonePill milestone={item.milestone} size="sm" />}
      {(item.labels || []).map(l => <LabelChip key={l.id} label={l} size="sm" />)}
    </div>
  );
}

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
        style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid ' + listColor + '55' }} title="المسؤولون عن هذه القائمة">
        <Users className="w-3 h-3" />
        {assignees?.length > 0 ? (
          <span className="flex -space-x-1.5" style={{ direction: 'ltr' }}>
            {assignees.slice(0, 3).map(a => (
              <span key={a.user_id} className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold border"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', borderColor: 'var(--bg-secondary)' }} title={a.name}>{a.name?.[0] || '?'}</span>
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
  const toast = useToast();
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  // A total fetch failure used to leave `lists` at [] with loading=false --
  // rendering an entirely empty board with every list's own "📥 اسحب هنا"
  // placeholder, indistinguishable from a genuinely empty production line
  // with no way to tell it actually failed to load, and no retry.
  const [fetchError, setFetchError] = useState(false);
  const [draggedItem, setDraggedItem] = useState(null);
  const [draggedItemInside, setDraggedItemInside] = useState(null);
  // كل الصفوف مفتوحة افتراضياً — نخزّن المغلقة فقط (بـ id القائمة، لا برقمها،
  // حتى تتبع حالة الطي القائمة نفسها عند إعادة ترتيب القوائم بالسحب).
  const [closedLists, setClosedLists] = useState(() => {
    try {
      const saved = localStorage.getItem('foia_pipeline_closed');
      if (saved) return new Set(JSON.parse(saved));
    } catch {}
    return new Set();
  });
  const { canReorder } = usePipelinePerms();
  const [draggedList, setDraggedList] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, pos: 'before' | 'after' }
  const [viewMode, setViewMode] = useState(() => { try { return localStorage.getItem('foia_pipeline_view') || 'rows'; } catch { return 'rows'; } });
  const [sortBy, setSortBy] = useState(() => { try { return localStorage.getItem('foia_pipeline_sort') || 'newest'; } catch { return 'newest'; } });
  const [assigneesByList, setAssigneesByList] = useState({});
  const [allUsers, setAllUsers] = useState([]);
  const [openAssignFor, setOpenAssignFor] = useState(null);
  // Role-based Production Line visibility from /permissions/mine. null = loading
  // → show everything; {} = unconfigured → default open (never hides by default).
  const [prodVisibility, setProdVisibility] = useState(null);
  const navigate = useNavigate();

  const loadVisibility = () => api.get('/permissions/mine')
    .then(d => setProdVisibility(d.productionVisibility || {}))
    .catch(() => setProdVisibility({}));
  useEffect(() => { loadVisibility(); }, []);

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
    } catch (e) { toast.error('فشل حفظ المسؤولين: ' + e.message); }
  };

  const toggleList = (listId) => {
    const next = new Set(closedLists);
    if (next.has(listId)) next.delete(listId); else next.add(listId);
    setClosedLists(next);
    try { localStorage.setItem('foia_pipeline_closed', JSON.stringify([...next])); } catch {}
  };

  // ===== ترتيب القوائم بالسحب =====
  const handleListDragStart = (e, col) => {
    e.stopPropagation();
    setDraggedList(col.id);
    e.dataTransfer.setData('listId', String(col.id));
    e.dataTransfer.effectAllowed = 'move';
    const card = e.currentTarget.closest('[data-list-card]');
    if (card) e.dataTransfer.setDragImage(card, 20, 20);
  };
  const handleListDragEnd = () => { setDraggedList(null); setDropTarget(null); };
  // horizontal=true for the columns view (the board is dir=rtl, so the first
  // list sits at the right: "before" means the right half of the target).
  const handleListDragOver = (e, col, horizontal) => {
    if (draggedList == null) return false;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (col.id === draggedList) { if (dropTarget) setDropTarget(null); return true; }
    const rect = e.currentTarget.getBoundingClientRect();
    const before = horizontal ? e.clientX > rect.left + rect.width / 2 : e.clientY < rect.top + rect.height / 2;
    const pos = before ? 'before' : 'after';
    if (dropTarget?.id !== col.id || dropTarget?.pos !== pos) setDropTarget({ id: col.id, pos });
    return true;
  };
  const handleListDrop = async (e, col) => {
    if (draggedList == null) return false;
    e.preventDefault();
    e.stopPropagation();
    const target = dropTarget && dropTarget.id === col.id ? dropTarget : { id: col.id, pos: 'after' };
    const dragId = draggedList;
    setDraggedList(null); setDropTarget(null);
    if (dragId === col.id) return true;
    const from = lists.findIndex(l => l.id === dragId);
    const to = lists.findIndex(l => l.id === col.id);
    if (from < 0 || to < 0) return true;
    let insertAt = target.pos === 'before' ? to : to + 1;
    if (from < insertAt) insertAt -= 1;
    if (insertAt === from) return true;
    const previous = lists;
    const next = [...lists];
    const [moved] = next.splice(from, 1);
    next.splice(insertAt, 0, moved);
    // Same slot-permutation the server applies (live numbers can have gaps).
    setLists(next.map((l, i) => ({ ...l, list_number: previous[i].list_number })));
    try {
      await api.put(`/pipeline-lists/${dragId}/reorder`, { list_number: insertAt + 1 });
    } catch (err) {
      setLists(previous);
      toast.error('فشل حفظ ترتيب القوائم: ' + err.message);
    }
    // The server re-points per-role visibility rows to the new list numbers.
    loadVisibility();
    fetchPipeline();
    return true;
  };

  // A plain render function, NOT a component declared in the render body: a
  // component defined here gets a new identity every render, so starting a drag
  // (which sets state) would unmount the very <span> being dragged and the
  // browser would abort the drag / never fire dragend.
  const renderListHandle = (col) => canReorder ? (
    <span draggable onDragStart={e => handleListDragStart(e, col)} onDragEnd={handleListDragEnd}
      onClick={e => e.stopPropagation()}
      className="cursor-grab active:cursor-grabbing select-none px-0.5 text-sm leading-none shrink-0"
      style={{ color: 'var(--text-muted)' }} title="اسحب لإعادة ترتيب القائمة">⠿</span>
  ) : null;

  const dropIndicator = (col, horizontal) => {
    if (!dropTarget || dropTarget.id !== col.id) return null;
    const edge = dropTarget.pos === 'before' ? (horizontal ? 'right' : 'top') : (horizontal ? 'left' : 'bottom');
    return { [horizontal ? (edge === 'right' ? 'borderRight' : 'borderLeft') : (edge === 'top' ? 'borderTop' : 'borderBottom')]: '4px solid var(--accent)' };
  };

  const changeSort = (mode) => {
    setSortBy(mode);
    try { localStorage.setItem('foia_pipeline_sort', mode); } catch {}
    fetchPipeline(mode);
  };

  const fetchPipeline = (sortMode) => {
    const s = sortMode || sortBy;
    setFetchError(false);
    api.getPipeline(s === 'oldest' ? '?sort_by=oldest' : '').then(d => {
      const data = Array.isArray(d) ? d : d.data || d.lists || [];
      setLists(data);
      setLoading(false);
    }).catch(() => { setFetchError(true); setLoading(false); });
  };

  useEffect(() => { fetchPipeline(); }, []);

  const moveRequest = async (requestId, toListId) => {
    try {
      await api.put(`/requests/${requestId}/classification`, { classification_id: toListId });
      fetchPipeline();
    } catch (e) { toast.error('فشل نقل الطلب: ' + e.message); }
  };

  // ترتيب البطاقات داخل القائمة — Drag & Drop internally
  const handleInternalDragStart = (e, requestId, fromList, index) => {
    setDraggedItemInside({ requestId, fromList, index });
    e.dataTransfer.setData('internal', 'true');
    e.dataTransfer.setData('requestId', String(requestId));
    e.dataTransfer.setData('fromList', String(fromList));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleInternalDrop = async (e, toList, toIndex) => {
    // A LIST being dragged over a card: let it bubble to the column's own
    // onDrop (list reorder) instead of swallowing it here.
    if (draggedList != null) return;
    e.preventDefault();
    // A card dragged from ANOTHER list and dropped onto a card here is a
    // cross-list move, not a reorder -- also let it bubble to the column's
    // onDrop (handleDrop), which moves it to this list.
    if (e.dataTransfer.getData('fromList') !== String(toList.list_number)) return;
    // Without this, a same-list reorder drop also bubbles up to the
    // enclosing column's own onDrop (handleDrop below) -- both read the same
    // dataTransfer 'requestId' key, so every internal reorder ALSO fired a
    // redundant cross-list move to the same list (a wasted duplicate
    // PUT .../classification plus a second fetchPipeline right after this
    // one's own refetch).
    e.stopPropagation();
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

    // Save new order -- one PUT per card, but none depend on another, so
    // run them together instead of one at a time. A 20-30 card list
    // (a plausible column size) previously blocked the post-drag refresh
    // on 20-30 sequential round trips.
    try {
      await Promise.all(newOrder.map((id, i) => api.put(`/requests/${id}/sort`, { sort_order: (newOrder.length - i) })));
    } catch (e) {
      toast.error('فشل حفظ الترتيب الجديد: ' + e.message);
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

  const handleDragOver = (e) => { if (draggedList != null) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const handleDrop = (e, toListNumber) => {
    if (draggedList != null) return;
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

  if (fetchError) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>تعذر تحميل خط الإنتاج</p>
      <button onClick={() => { setLoading(true); fetchPipeline(); }}
        className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: '#1A1A2E' }}>
        إعادة المحاولة
      </button>
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
            <button onClick={() => { setViewMode('rows'); try { localStorage.setItem('foia_pipeline_view', 'rows'); } catch {} }}
              className="px-3 py-1.5 rounded-lg font-medium transition-all"
              style={{
                background: viewMode === 'rows' ? 'var(--accent)' : 'transparent',
                color: viewMode === 'rows' ? '#1A1A2E' : 'var(--text-secondary)'
              }}>📋 صفوف</button>
            <button onClick={() => { setViewMode('columns'); try { localStorage.setItem('foia_pipeline_view', 'columns'); } catch {} }}
              className="px-3 py-1.5 rounded-lg font-medium transition-all"
              style={{
                background: viewMode === 'columns' ? 'var(--accent)' : 'transparent',
                color: viewMode === 'columns' ? '#1A1A2E' : 'var(--text-secondary)'
              }}>📊 أعمدة</button>
          </div>
        </div>
      </div>

      {viewMode === 'columns' ? (
        /* ===== أعمدة — تمرير عام واحد =====
           Narrowed from 280-340px to ~180-220px (roughly 6 columns visible
           at once instead of 3) with tighter internal spacing throughout --
           same color-coded header/card language as before, just a more
           compact, professional density. */
        <div className="flex-1 overflow-y-auto">
          <div className="flex gap-2.5 pb-4" style={{ minHeight: '100%' }}>
            {lists.filter(isListVisible).map(col => {
              const items = col.requests || col.tasks || [];
              const st = listStyle(col);
              return (
                <div key={col.id} data-list-card className="flex flex-col shrink-0 rounded-xl overflow-hidden"
                  style={{ minWidth: '180px', maxWidth: '220px', minHeight: '100%', boxShadow: 'var(--shadow-sm)', opacity: draggedList === col.id ? 0.5 : 1, ...dropIndicator(col, true) }}
                  onDragOver={e => { if (!handleListDragOver(e, col, true)) handleDragOver(e); }}
                  onDrop={e => { if (draggedList != null) handleListDrop(e, col); else handleDrop(e, col.id); }}>
                  <div className="px-2.5 py-2 border border-b-0 flex items-center justify-between gap-1"
                    style={{ background: st.bg + '26', borderColor: st.bg + '40' }}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      {renderListHandle(col)}
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: st.bg }} />
                      <h3 className="font-semibold text-[12px] truncate cursor-pointer hover:underline" style={{ color: 'var(--text-primary)' }} title={`فتح القائمة: ${col.name_ar}`}
                        onClick={() => navigate(`/pipeline/lists/${col.id}`)}>{col.name_ar}</h3>
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-bold cursor-pointer hover:opacity-80 transition-opacity shrink-0"
                        style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: `1px solid ${st.bg}55` }}
                        onClick={() => navigate(`/pipeline/lists/${col.id}`)}>{items.length}</span>
                    </div>
                    <ListAssignees listId={col.id} listColor={st.bg} assignees={assigneesByList[col.id]} allUsers={allUsers}
                      isOpen={openAssignFor === col.id} onToggle={setOpenAssignFor} onSave={saveAssignees} />
                  </div>
                  <div className="flex-1 p-2 space-y-2 border overflow-y-auto"
                    style={{ borderColor: st.bg + '30', background: 'var(--bg-primary)', minHeight: '200px' }}>
                    {items.length === 0 ? (
                      <div className="flex items-center justify-center py-8 rounded-lg border-2 border-dashed" style={{ borderColor: 'var(--border)' }}>
                        <p className="text-[11px] text-center px-1" style={{ color: 'var(--text-muted)' }}>📥 اسحب هنا</p>
                      </div>
                    ) : items.map((item, idx) => (
                      <div key={item.id} draggable
                        onDragStart={e => handleInternalDragStart(e, item.id, col.list_number, idx)}
                        onDragEnd={() => setDraggedItemInside(null)}
                        onClick={() => item.case_id && navigate(`/cases/${item.case_id}`)}
                        className="rounded-xl border overflow-hidden cursor-grab active:cursor-grabbing transition-all duration-150 hover:-translate-y-0.5"
                        style={{
                          background: 'var(--bg-secondary)', borderColor: 'var(--border)',
                          opacity: draggedItem === item.id || draggedItemInside?.requestId === item.id ? 0.4 : 1,
                          boxShadow: 'var(--shadow-sm)',
                        }}
                        onDragOver={e => { e.preventDefault(); }}
                        onDrop={e => handleInternalDrop(e, col, idx)}>
                        {item.case_photo_url && (
                          <div className="w-full h-32 flex items-center justify-center" style={{ background: 'var(--bg-tertiary)' }}>
                            <img src={item.case_photo_url} alt="" className="w-full h-full object-contain"
                              onError={e => { e.currentTarget.parentElement.style.display = 'none'; }} />
                          </div>
                        )}
                        <div className="px-2.5 py-2">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="font-mono font-bold text-[12px] shrink-0" style={{ color: 'var(--text-secondary)' }}>#{item.case_id || item.id}</span>
                            <p className="font-medium leading-snug line-clamp-2 text-[12px] flex-1 min-w-0" style={{ color: 'var(--text-primary)' }}>{item.case_title || item.title || 'بدون عنوان'}</p>
                            {item.priority === 'high' && <span className="px-1 py-0.5 rounded text-[9px] font-medium shrink-0" style={{ background: '#EF444420', color: '#EF4444' }}>عاجل</span>}
                          </div>
                          <div className="flex flex-col gap-0.5 text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                            {item.agency_name_ar && <span className="truncate">🏛️ {item.agency_name_ar}</span>}
                            {(() => { const d = getDeadlineChip(item); return d && <span className="font-medium truncate" style={{ color: d.color }}>⏳ {d.text}</span>; })()}
                          </div>
                          <CardMeta item={item} />
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
            const st = listStyle(col);
            const isOpen = !closedLists.has(col.id);

            return (
              <div key={col.id} data-list-card
                onDragOver={e => { if (!handleListDragOver(e, col, false)) handleDragOver(e); }}
                onDrop={e => { if (draggedList != null) handleListDrop(e, col); else handleDrop(e, col.id); }}
                className="rounded-2xl border overflow-hidden transition-all"
                style={{ background: 'var(--bg-secondary)', borderColor: st.bg + '55', boxShadow: 'var(--shadow-sm)', opacity: draggedList === col.id ? 0.5 : 1, ...dropIndicator(col, false) }}>

                {/* List Header — يحمل لون القائمة */}
                <div className="flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer"
                  style={{ background: st.bg + '26' }}
                  onClick={() => toggleList(col.id)}>
                  {renderListHandle(col)}
                  <div className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: st.bg }} />
                  <h3 className="font-bold cursor-pointer hover:underline" style={{ color: 'var(--text-primary)' }} title="فتح القائمة"
                    onClick={(e) => { e.stopPropagation(); navigate(`/pipeline/lists/${col.id}`); }}>{st.label}</h3>
                  <span className="px-2.5 py-1 rounded-lg font-bold cursor-pointer hover:opacity-80 transition-opacity"
                    style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: `1px solid ${st.bg}55` }}
                    onClick={(e) => { e.stopPropagation(); navigate(`/pipeline/lists/${col.id}`); }}>{items.length}</span>
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
                          className="w-72 rounded-2xl border overflow-hidden cursor-grab active:cursor-grabbing transition-all duration-150 group shrink-0 hover:-translate-y-0.5"
                          style={{
                            background: 'var(--bg-secondary)',
                            borderColor: draggedItem === item.id || draggedItemInside?.requestId === item.id ? st.bg : 'var(--border)',
                            opacity: draggedItem === item.id || draggedItemInside?.requestId === item.id ? 0.4 : 1,
                            boxShadow: (draggedItem === item.id || draggedItemInside?.requestId === item.id) ? `0 0 0 2px ${st.bg}40` : 'var(--shadow-sm)'
                          }}
                          onDragOver={e => { e.preventDefault(); }}
                          onDrop={e => handleInternalDrop(e, col, idx)}>
                          {item.case_photo_url && (
                            <div className="w-full h-44 flex items-center justify-center" style={{ background: 'var(--bg-tertiary)' }}>
                              <img src={item.case_photo_url} alt="" className="w-full h-full object-contain"
                              onError={e => { e.currentTarget.parentElement.style.display = 'none'; }} />
                            </div>
                          )}
                          <div className="px-4 py-3.5">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="font-mono font-bold shrink-0" style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>#{item.case_id || item.id}</span>
                              <p className="font-medium leading-snug line-clamp-2 flex-1 min-w-0" style={{ color: 'var(--text-primary)' }}>{item.case_title || item.title || 'بدون عنوان'}</p>
                              {item.priority === 'high' && <span className="px-1.5 py-0.5 rounded text-xs font-medium shrink-0" style={{ background: '#EF444420', color: '#EF4444' }}>عاجل</span>}
                            </div>
                            <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
                              {item.agency_name_ar && <span className="truncate">🏛️ {item.agency_name_ar}</span>}
                              {(() => { const d = getDeadlineChip(item); return d && <span className="shrink-0 font-medium" style={{ color: d.color }}>⏳ {d.text}</span>; })()}
                            </div>
                            <CardMeta item={item} />
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
