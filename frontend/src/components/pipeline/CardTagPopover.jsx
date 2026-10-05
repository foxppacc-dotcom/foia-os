import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Tag, Flag } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../ui/Toast';
import { LabelChip, MilestonePill } from './chips';

// One clickable zone on a list card: kind="labels" (tag icon, many labels) or
// kind="milestone" (flag icon, one milestone). Empty = dashed box with just the
// icon; filled = the chips. Clicking opens a picker that saves straight through
// the card-assignment routes and reports the new value up via
// onSaved({ labels } | { milestone }) so the parent patches local state.
// Portal'd to <body> because list wrappers use overflow-hidden.
export default function CardTagZone({ kind, request, labels, milestones, canEdit, onSaved }) {
  const toast = useToast();
  const isLabels = kind === 'labels';
  const Icon = isLabels ? Tag : Flag;
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const width = Math.max(rect.width, 240);
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    setCoords({ top: rect.bottom + 4, left, width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e) => {
      if (btnRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  const currentIds = new Set((request.labels || []).map(l => l.id));
  const hasContent = isLabels ? (request.labels || []).length > 0 : !!request.milestone;

  const toggleLabel = async (id) => {
    const next = new Set(currentIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setBusy(true);
    try {
      const d = await api.put(`/requests/${request.id}/labels`, { label_ids: [...next] });
      onSaved({ labels: d.data || [] });
    } catch (e) { toast.error(e.message || 'فشل الحفظ'); }
    finally { setBusy(false); }
  };

  const setMilestone = async (id) => {
    setBusy(true);
    try {
      const d = await api.put(`/requests/${request.id}/milestone`, { milestone_id: id });
      onSaved({ milestone: d.data || null });
      setOpen(false);
    } catch (e) { toast.error(e.message || 'فشل الحفظ'); }
    finally { setBusy(false); }
  };

  const tint = isLabels ? 'var(--accent)' : '#F59E0B';
  const zoneStyle = hasContent
    ? { background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }
    : { background: 'transparent', border: '1.5px dashed var(--border-strong, var(--border))' };

  const body = hasContent ? (
    <div className="flex items-start gap-2.5 w-full">
      <Icon className="w-5 h-5 shrink-0 mt-0.5" style={{ color: tint }} />
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        {isLabels
          ? request.labels.map(l => <LabelChip key={l.id} label={l} />)
          : <MilestonePill milestone={request.milestone} />}
      </div>
    </div>
  ) : (
    <Icon className="w-6 h-6" style={{ color: canEdit ? tint : 'var(--text-muted)', opacity: canEdit ? 0.85 : 0.35 }} />
  );

  const title = isLabels ? 'Labels' : 'Milestone';
  const zoneClass = `w-full rounded-xl px-3 flex items-center ${hasContent ? 'justify-start py-2.5' : 'justify-center'} ${isLabels ? 'min-h-[68px]' : 'min-h-[56px]'}`;

  return (
    <div onClick={e => e.stopPropagation()} className="w-full">
      {canEdit ? (
        <button ref={btnRef} type="button" onClick={() => setOpen(o => !o)} title={title}
          className={`${zoneClass} transition-all hover:brightness-110 hover:border-solid`} style={zoneStyle}>
          {body}
        </button>
      ) : (
        <div ref={btnRef} title={title} className={zoneClass} style={zoneStyle}>{body}</div>
      )}
      {open && coords && createPortal(
        <div ref={popRef} onClick={e => e.stopPropagation()} dir="rtl"
          className="fixed z-50 rounded-xl border p-2 space-y-1 max-h-80 overflow-y-auto"
          style={{ top: coords.top, left: coords.left, width: coords.width, background: 'var(--bg-secondary)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)', opacity: busy ? 0.7 : 1 }}>
          {isLabels ? (
            labels.length === 0 ? <p className="text-xs px-1 py-2" style={{ color: 'var(--text-muted)' }}>لا توجد Labels في هذه القائمة — تُنشأ من "إدارة Labels وMilestones" أعلى الصفحة</p>
              : labels.map(l => (
                <label key={l.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer text-sm hover:brightness-110" style={{ color: 'var(--text-primary)' }}>
                  <input type="checkbox" disabled={busy} checked={currentIds.has(l.id)} onChange={() => toggleLabel(l.id)} className="w-4 h-4" />
                  <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: l.color }} />
                  <span className="truncate">{l.name}</span>
                </label>
              ))
          ) : (
            milestones.length === 0 ? <p className="text-xs px-1 py-2" style={{ color: 'var(--text-muted)' }}>لا توجد Milestones في هذه القائمة — تُنشأ من "إدارة Labels وMilestones" أعلى الصفحة</p> : (
              <>
                <label className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <input type="radio" disabled={busy} checked={!request.milestone} onChange={() => setMilestone(null)} className="w-4 h-4" />
                  بدون
                </label>
                {milestones.map(m => (
                  <label key={m.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer text-sm" style={{ color: 'var(--text-primary)' }}>
                    <input type="radio" disabled={busy} checked={request.milestone?.id === m.id} onChange={() => setMilestone(m.id)} className="w-4 h-4" />
                    <span className="w-3.5 h-3.5 rounded-sm shrink-0" style={{ background: m.color }} />
                    <span className="truncate">{m.name}</span>
                  </label>
                ))}
              </>
            )
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
