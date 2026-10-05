import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import { Trash2, RotateCcw, AlertTriangle } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';
import { TableShell, Thead, Th, Td, Tr } from '../components/ui/Table';

// Order tabs appear in -- most frequently trashed / most likely to need a
// quick restore first. Anything trashed under a type not listed here still
// shows, just after these (Object.keys order is insertion order in JS, so
// unlisted types simply fall through to the end of the sort).
const TAB_ORDER = [
  'cases', 'case_documents', 'communications', 'case_comments', 'requests',
  'agencies', 'forum_topics', 'forum_comments', 'users',
];

export default function Trash() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState(null);
  const [busyKey, setBusyKey] = useState(null); // `${entity_type}:${id}` currently restoring/destroying
  const [destroyTarget, setDestroyTarget] = useState(null); // item pending permanent delete

  const fetchTrash = () => {
    setLoading(true);
    api.get('/trash')
      .then(d => { setItems(d.data || []); setLoadError(''); })
      .catch(e => setLoadError(e.message || 'تعذر تحميل سلة المحذوفات'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { fetchTrash(); }, []);

  const groups = useMemo(() => {
    const byType = {};
    for (const it of items) (byType[it.entity_type] ||= []).push(it);
    const types = Object.keys(byType).sort((a, b) => {
      const ai = TAB_ORDER.indexOf(a), bi = TAB_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    return { byType, types };
  }, [items]);

  useEffect(() => {
    // Keep the selected tab valid as items load/restore/empty out -- default
    // to the first non-empty type instead of a hardcoded 'cases' that might
    // not exist yet on a light trash.
    if (!tab && groups.types.length) setTab(groups.types[0]);
    if (tab && !groups.byType[tab] && groups.types.length) setTab(groups.types[0]);
  }, [groups, tab]);

  const restore = async (item) => {
    const key = `${item.entity_type}:${item.id}`;
    setBusyKey(key);
    try {
      await api.post(`/trash/${item.entity_type}/${item.id}/restore`);
      toast.success('تمت الاستعادة');
      fetchTrash();
    } catch (e) { toast.error(e.message || 'فشلت الاستعادة'); }
    finally { setBusyKey(null); }
  };

  const destroy = async () => {
    if (!destroyTarget) return;
    const key = `${destroyTarget.entity_type}:${destroyTarget.id}`;
    setBusyKey(key);
    try {
      await api.delete(`/trash/${destroyTarget.entity_type}/${destroyTarget.id}`);
      toast.success('تم الحذف نهائيًا');
      setDestroyTarget(null);
      fetchTrash();
    } catch (e) { toast.error(e.message || 'فشل الحذف النهائي'); }
    finally { setBusyKey(null); }
  };

  const currentItems = tab ? (groups.byType[tab] || []) : [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="النظام"
        title="سلة المحذوفات"
        meta="أي شيء يُحذف في السستم ينتقل هنا أولاً -- استعده أو احذفه نهائيًا من هنا فقط"
      />

      {loading ? (
        <Spinner full />
      ) : loadError ? (
        <Card><EmptyState icon={AlertTriangle} title="تعذر التحميل" description={loadError} /></Card>
      ) : !items.length ? (
        <Card><EmptyState icon={Trash2} title="سلة المحذوفات فارغة" description="لا يوجد شيء محذوف حاليًا" /></Card>
      ) : (
        <>
          <div className="inline-flex flex-wrap gap-1 p-1 rounded-2xl" style={{ background: 'var(--bg-tertiary)' }}>
            {groups.types.map(t => (
              <button key={t} onClick={() => setTab(t)} className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
                style={{ background: tab === t ? 'var(--bg-secondary)' : 'transparent', color: tab === t ? 'var(--accent)' : 'var(--text-muted)', boxShadow: tab === t ? 'var(--shadow-sm)' : 'none' }}>
                {groups.byType[t][0].entity_label} <span style={{ opacity: 0.6 }}>({groups.byType[t].length})</span>
              </button>
            ))}
          </div>

          <TableShell>
            <Thead>
              <Th>العنصر</Th>
              <Th>تاريخ الحذف</Th>
              <Th align="left">إجراءات</Th>
            </Thead>
            <tbody>
              {currentItems.map(item => {
                const key = `${item.entity_type}:${item.id}`;
                const busy = busyKey === key;
                return (
                  <Tr key={key}>
                    <Td>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{item.title || `#${item.id}`}</span>
                        {item.case_id && <Badge variant="neutral">قضية #{item.case_id}</Badge>}
                      </div>
                    </Td>
                    <Td>{new Date(item.deleted_at).toLocaleString('ar-EG')}</Td>
                    <Td align="left">
                      <div className="flex items-center gap-2 justify-end">
                        <Button size="sm" variant="secondary" icon={RotateCcw} loading={busy} disabled={busy} onClick={() => restore(item)}>
                          استعادة
                        </Button>
                        <Button size="sm" icon={Trash2} loading={busy} disabled={busy}
                          style={{ background: 'var(--danger)', color: 'white' }}
                          onClick={() => setDestroyTarget(item)}>
                          حذف نهائي
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableShell>
        </>
      )}

      <ConfirmDialog
        open={!!destroyTarget}
        onClose={() => setDestroyTarget(null)}
        onConfirm={destroy}
        loading={busyKey === (destroyTarget ? `${destroyTarget.entity_type}:${destroyTarget.id}` : null)}
        title="حذف نهائي"
        message={`سيتم حذف "${destroyTarget?.title || (destroyTarget && `#${destroyTarget.id}`)}" نهائيًا ولا يمكن التراجع عن هذا أبدًا. هل أنت متأكد؟`}
        confirmLabel="حذف نهائي"
        danger
      />
    </div>
  );
}
