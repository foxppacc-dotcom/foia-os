import { useState, useEffect } from 'react';
import { ChevronUp, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { api } from '../../api';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toast';
import ColorPicker, { randomColor, isValidHex } from './ColorPicker';
import { LabelChip, MilestonePill } from './chips';

const KINDS = {
  labels: { ar: 'Label', plural: 'Labels', empty: 'لا توجد Labels في هذه القائمة بعد', Chip: LabelChip, prop: 'label' },
  milestones: { ar: 'Milestone', plural: 'Milestones', empty: 'لا توجد Milestone في هذه القائمة بعد', Chip: MilestonePill, prop: 'milestone' },
};

function ItemRow({ kind, item, index, total, busy, onSave, onMove, onDelete }) {
  const { Chip, prop } = KINDS[kind];
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [color, setColor] = useState(item.color);
  useEffect(() => { setName(item.name); setColor(item.color); }, [item.name, item.color]);

  const save = async () => {
    if (await onSave(item.id, { name: name.trim(), color })) setEditing(false);
  };

  return (
    <div className="rounded-xl border p-2.5" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <button type="button" disabled={busy || index === 0} onClick={() => onMove(index, -1)} className="disabled:opacity-25" title="أعلى"><ChevronUp className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /></button>
          <button type="button" disabled={busy || index === total - 1} onClick={() => onMove(index, 1)} className="disabled:opacity-25" title="أسفل"><ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        <div className="flex-1 min-w-0"><Chip {...{ [prop]: item }} /></div>
        <button type="button" onClick={() => setEditing(e => !e)} className="p-1.5 rounded-lg" title="تعديل" style={{ color: 'var(--text-secondary)' }}><Pencil className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => onDelete(item)} className="p-1.5 rounded-lg" title="حذف" style={{ color: 'var(--danger)' }}><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      {editing && (
        <div className="mt-2.5 space-y-2.5">
          <input value={name} onChange={e => setName(e.target.value)} maxLength={40}
            className="w-full px-3 py-1.5 rounded-lg border text-sm"
            style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
          <ColorPicker value={color} onChange={setColor} />
          <div className="flex gap-2">
            <Button size="sm" loading={busy} disabled={!name.trim() || !isValidHex(color)} onClick={save}>حفظ</Button>
            <Button size="sm" variant="secondary" onClick={() => { setEditing(false); setName(item.name); setColor(item.color); }}>إلغاء</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Per-list manager: create / rename / recolor / reorder / delete labels and
// milestones. Everything is scoped to listId; the parent reloads the list's
// data through onChanged() after every successful write.
export default function ManageMetaModal({ open, onClose, listId, labels, milestones, onChanged }) {
  const toast = useToast();
  const [tab, setTab] = useState('labels');
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(() => randomColor());
  const [toDelete, setToDelete] = useState(null);

  const k = KINDS[tab];
  const items = tab === 'labels' ? labels : milestones;

  useEffect(() => { setNewName(''); setNewColor(randomColor()); }, [tab, open]);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast.success(okMsg); await onChanged(); return true; }
    catch (e) { toast.error(e.message || 'فشلت العملية'); return false; }
    finally { setBusy(false); }
  };

  const add = () => run(async () => {
    await api.post(`/pipeline/lists/${listId}/${tab}`, { name: newName.trim(), color: newColor });
    setNewName(''); setNewColor(randomColor());
  }, `تمت إضافة ${k.ar}`);

  const save = (id, body) => run(() => api.put(`/pipeline/${tab}/${id}`, body), 'تم الحفظ');

  const move = (index, dir) => {
    const ids = items.map(i => i.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    return run(() => api.put(`/pipeline/lists/${listId}/${tab}/reorder`, { ids }));
  };

  const confirmDelete = async () => {
    const ok = await run(() => api.delete(`/pipeline/${tab}/${toDelete.id}`), `تم حذف ${k.ar}`);
    if (ok) setToDelete(null);
  };

  const tabBtn = (key, text) => (
    <button type="button" onClick={() => setTab(key)} className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all"
      style={{ background: tab === key ? 'var(--accent)' : 'transparent', color: tab === key ? 'var(--text-inverse)' : 'var(--text-secondary)' }}>
      {text} ({(key === 'labels' ? labels : milestones).length})
    </button>
  );

  return (
    <>
      <Modal open={open} onClose={onClose} title="إدارة Labels وMilestones لهذه القائمة" maxWidth="max-w-lg">
        <div dir="rtl" className="space-y-4">
          <div className="flex gap-1 rounded-xl p-1 border" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)' }}>
            {tabBtn('labels', 'Labels')}
            {tabBtn('milestones', 'Milestones')}
          </div>

          <div className="rounded-xl border p-3 space-y-2.5" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>إضافة {k.ar} جديد</p>
            <div className="flex items-center gap-2">
              <input value={newName} onChange={e => setNewName(e.target.value)} maxLength={40} placeholder={`اسم ${k.ar}`}
                onKeyDown={e => { if (e.key === 'Enter' && newName.trim() && isValidHex(newColor) && !busy) add(); }}
                className="flex-1 px-3 py-1.5 rounded-lg border text-sm"
                style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
              <Button size="sm" loading={busy} disabled={!newName.trim() || !isValidHex(newColor)} onClick={add}>إضافة</Button>
            </div>
            <ColorPicker value={newColor} onChange={setNewColor} />
            {newName.trim() && isValidHex(newColor) && (
              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                معاينة: <k.Chip {...{ [k.prop]: { name: newName.trim(), color: newColor } }} />
              </div>
            )}
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto">
            {items.length === 0 ? (
              <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>{k.empty}</p>
            ) : items.map((item, i) => (
              <ItemRow key={item.id} kind={tab} item={item} index={i} total={items.length} busy={busy}
                onSave={save} onMove={move} onDelete={setToDelete} />
            ))}
          </div>
        </div>
      </Modal>
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={confirmDelete} loading={busy}
        title={`حذف ${k.ar}`} confirmLabel="حذف"
        message={`سيتم حذف ${k.ar} "${toDelete?.name || ''}" وإزالته من كل البطاقات في هذه القائمة. هل أنت متأكد؟`} />
    </>
  );
}
