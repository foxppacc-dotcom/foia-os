import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getCurrentUser, getApiBase } from '../api';
import {
  Sparkles, Plus, Upload, FileText, Link2, PenLine, CheckCircle2, XCircle, HelpCircle,
  Bot, ArrowRight, Settings2, Trash2, ExternalLink, Youtube, X,
} from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import { TableShell, Thead, Th, Td, Tr } from '../components/ui/Table';
import { useToast } from '../components/ui/Toast';

const tok = () => localStorage.getItem('foia_token');
async function postMultipart(path, formData) {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: 'POST', headers: tok() ? { Authorization: 'Bearer ' + tok() } : {}, body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'فشل الطلب');
  return data;
}

const SOURCE_LABEL = { link: 'نص/لصق', file: 'ملف مرفوع', manual: 'إدخال يدوي' };
const SOURCE_ICON = { link: Link2, file: Upload, manual: PenLine };

export default function AIIntake() {
  const toast = useToast();
  const navigate = useNavigate();
  const me = getCurrentUser();
  const isAdmin = me?.role === 'admin';
  const [perms, setPerms] = useState(null);
  const [queue, setQueue] = useState([]);
  const [criteria, setCriteria] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCriteriaAdmin, setShowCriteriaAdmin] = useState(false);
  const [critFilters, setCritFilters] = useState({});
  const [search, setSearch] = useState('');

  const has = (action) => isAdmin || !!perms?.permissions?.find(p => p.resource === 'intake' && p.action === action);
  const canCreate = has('create');
  const canEdit = has('edit');
  const canPromote = has('promote');
  const canManageCriteria = has('manage_criteria');

  const fetchQueue = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    Object.entries(critFilters).forEach(([k, v]) => { if (v) params.set(`criteria_${k}`, v); });
    api.get(`/intake/queue?${params}`)
      .then(d => { setQueue(d.data || []); setCriteria(d.criteria || []); })
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { fetchQueue(); }, [search, critFilters]);
  useEffect(() => { api.get('/permissions/mine').then(setPerms).catch(() => setPerms({ permissions: [] })); }, []);

  if (loading || !perms) return <Spinner full />;

  return (
    <div className="space-y-4 animate-fadeIn">
      <PageHeader
        eyebrow="فرز ذكي"
        title="استقبال ذكي"
        meta="كل قضية واردة (رابط/ملف/إدخال يدوي) تُفرز أولًا هنا قبل اعتمادها للعمل"
        actions={<>
          {canManageCriteria && <Button variant="secondary" icon={Settings2} onClick={() => setShowCriteriaAdmin(true)}>معايير الفرز</Button>}
          {canCreate && !selected && <Button icon={Plus} onClick={() => setShowCreate(true)}>إضافة للفرز</Button>}
        </>}
      />

      {selected ? (
        <ReviewDetail item={selected} criteria={criteria} canEdit={canEdit} canPromote={canPromote}
          onBack={() => { setSelected(null); fetchQueue(); }} toast={toast} navigate={navigate} />
      ) : (
        <>
          <FilterBar criteria={criteria} filters={critFilters} setFilters={setCritFilters} search={search} setSearch={setSearch} />
          <QueueTable queue={queue} criteria={criteria} onSelect={setSelected} />
        </>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="إضافة للفرز" maxWidth="max-w-lg">
        <CreateIntakeForm onDone={() => { setShowCreate(false); fetchQueue(); }} toast={toast} />
      </Modal>
      <Modal open={showCriteriaAdmin} onClose={() => setShowCriteriaAdmin(false)} title="إدارة معايير الفرز" maxWidth="max-w-lg">
        <CriteriaAdminPanel onChanged={fetchQueue} toast={toast} />
      </Modal>
    </div>
  );
}

function FilterBar({ criteria, filters, setFilters, search, setSearch }) {
  const active = Object.values(filters).filter(Boolean).length + (search ? 1 : 0);
  return (
    <div className="p-2.5 rounded-2xl border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="relative min-w-[160px] flex-1">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالعنوان..."
            className="w-full px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
        </div>
        {criteria.map(c => (
          <select key={c.key} value={filters[c.key] || ''} onChange={e => setFilters(f => ({ ...f, [c.key]: e.target.value }))}
            className="px-2 py-1.5 rounded-lg text-xs shrink-0" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: filters[c.key] ? 'var(--text-primary)' : 'var(--text-muted)' }}>
            <option value="">{c.label_ar}</option>
            <option value="true">نعم</option>
            <option value="false">لا</option>
            <option value="unanswered">غير محدد</option>
          </select>
        ))}
        {active > 0 && (
          <button onClick={() => { setFilters({}); setSearch(''); }} className="text-[11px] underline shrink-0" style={{ color: 'var(--text-muted)' }}>مسح الفلاتر</button>
        )}
      </div>
    </div>
  );
}

function CompletenessBar({ value }) {
  const color = value >= 70 ? 'var(--success)' : value >= 40 ? 'var(--warning)' : 'var(--danger)';
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-xs font-semibold shrink-0" style={{ color }}>{value}%</span>
    </div>
  );
}

// One compact badge cluster per case row -- adding a new criterion later
// never breaks the table layout the way a dedicated column-per-criterion
// would. 🤖 marks an AI-suggested answer nobody has confirmed/overridden
// yet; a plain check/x means a human already reviewed it.
function CriteriaBadges({ item, criteria }) {
  if (!criteria.length) return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <div className="flex items-center gap-1 flex-wrap max-w-[220px]">
      {criteria.map(c => {
        const a = (item.intake_criteria || {})[c.key];
        const value = a?.value;
        const Icon = value === true ? CheckCircle2 : value === false ? XCircle : HelpCircle;
        const color = value === true ? 'var(--success)' : value === false ? 'var(--danger)' : 'var(--text-muted)';
        return (
          <span key={c.key} title={c.label_ar} className="relative inline-flex items-center justify-center w-5 h-5 rounded-full" style={{ background: 'var(--bg-tertiary)' }}>
            <Icon className="w-3 h-3" style={{ color }} />
            {a?.source === 'ai' && <Bot className="w-2.5 h-2.5 absolute -bottom-0.5 -left-0.5" style={{ color: 'var(--accent)' }} />}
          </span>
        );
      })}
    </div>
  );
}

function QueueTable({ queue, criteria, onSelect }) {
  if (!queue.length) return <EmptyState icon={Sparkles} title="لا توجد قضايا في الفرز حاليًا" description="أضف رابطًا أو ملفًا أو أدخل قضية يدويًا لبدء الفرز" />;
  return (
    <TableShell>
      <Thead>
        <Th>العنوان</Th>
        <Th>نسبة الاكتمال</Th>
        <Th>نتيجة الفرز</Th>
        <Th>المصدر</Th>
        <Th>تاريخ الورود</Th>
        <Th align="center">إجراء</Th>
      </Thead>
      <tbody>
        {queue.map(item => {
          const SourceIcon = SOURCE_ICON[item.intake_source] || Link2;
          return (
            <Tr key={item.id} onClick={() => onSelect(item)}>
              <Td><p className="font-medium truncate max-w-[220px]" style={{ color: 'var(--text-primary)' }}>{item.title}</p></Td>
              <Td><CompletenessBar value={item.completeness} /></Td>
              <Td><CriteriaBadges item={item} criteria={criteria} /></Td>
              <Td><Badge variant="neutral"><SourceIcon className="w-3 h-3" /> {SOURCE_LABEL[item.intake_source] || '—'}</Badge></Td>
              <Td><span className="text-xs">{new Date(item.created_at).toLocaleDateString('ar-EG')}</span></Td>
              <Td align="center">
                <Button size="sm" variant="secondary" onClick={e => { e.stopPropagation(); onSelect(item); }}>مراجعة</Button>
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

function CreateIntakeForm({ onDone, toast }) {
  const [mode, setMode] = useState('text'); // 'text' | 'file' | 'manual'
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [manual, setManual] = useState({ defendant_name: '', source_agency_name: '', story_hook: '', case_summary: '' });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      if (mode === 'text') {
        if (!text.trim()) { toast.error('النص مطلوب'); setSaving(false); return; }
        await api.post('/intake/text', { text: text.trim(), title: title.trim() || undefined });
      } else if (mode === 'file') {
        if (!file) { toast.error('اختر ملفًا'); setSaving(false); return; }
        const fd = new FormData();
        fd.append('file', file);
        if (title.trim()) fd.append('title', title.trim());
        await postMultipart('/intake/upload', fd);
      } else {
        if (!manual.defendant_name.trim()) { toast.error('اسم المتهم مطلوب'); setSaving(false); return; }
        await api.post('/intake/manual', { title: manual.defendant_name.trim(), ...manual });
      }
      toast.success('تمت الإضافة لقائمة الفرز');
      onDone();
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--bg-tertiary)' }}>
        {[{ k: 'text', l: 'نص/لصق', i: Link2 }, { k: 'file', l: 'ملف', i: Upload }, { k: 'manual', l: 'يدوي', i: PenLine }].map(t => (
          <button key={t.k} onClick={() => setMode(t.k)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: mode === t.k ? 'var(--bg-secondary)' : 'transparent', color: mode === t.k ? 'var(--accent)' : 'var(--text-muted)' }}>
            <t.i className="w-3.5 h-3.5" /> {t.l}
          </button>
        ))}
      </div>

      {mode === 'text' && (
        <div className="space-y-2">
          <Input label="العنوان (اختياري)" value={title} onChange={e => setTitle(e.target.value)} />
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>النص</label>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={6} placeholder="الصق رابط المقال أو نص البلاغ/القضية هنا..."
              className="w-full px-3 py-2 rounded-lg text-sm resize-none" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
          </div>
        </div>
      )}
      {mode === 'file' && (
        <div className="space-y-2">
          <Input label="العنوان (اختياري)" value={title} onChange={e => setTitle(e.target.value)} />
          <label className="flex flex-col items-center justify-center p-6 rounded-xl cursor-pointer" style={{ background: 'var(--bg-tertiary)', border: '2px dashed var(--border)' }}>
            <Upload className="w-6 h-6 mb-2" style={{ color: 'var(--text-muted)' }} />
            <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{file ? file.name : 'اضغط لرفع ملف'}</p>
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>PDF, DOCX, TXT, صور</p>
            <input type="file" hidden onChange={e => setFile(e.target.files?.[0] || null)} />
          </label>
        </div>
      )}
      {mode === 'manual' && (
        <div className="space-y-2">
          <Input label="اسم المتهم *" value={manual.defendant_name} onChange={e => setManual(m => ({ ...m, defendant_name: e.target.value }))} />
          <Input label="اسم الوكالة" value={manual.source_agency_name} onChange={e => setManual(m => ({ ...m, source_agency_name: e.target.value }))} />
          <Input label="الهوك" value={manual.story_hook} onChange={e => setManual(m => ({ ...m, story_hook: e.target.value }))} />
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>ملخص القضية</label>
            <textarea value={manual.case_summary} onChange={e => setManual(m => ({ ...m, case_summary: e.target.value }))} rows={4}
              className="w-full px-3 py-2 rounded-lg text-sm resize-none" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button className="flex-1" onClick={submit} loading={saving}>{saving ? 'جارٍ المعالجة...' : 'معالجة وإضافة للفرز'}</Button>
      </div>
    </div>
  );
}

function CriterionToggle({ label, answer, onChange, disabled }) {
  const value = answer?.value;
  return (
    <div className="flex items-center justify-between gap-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</p>
        {answer?.reason && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{answer.source === 'ai' && '🤖 '}{answer.reason}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {[{ v: true, l: 'نعم' }, { v: false, l: 'لا' }, { v: null, l: 'غير محدد' }].map(opt => (
          <button key={String(opt.v)} disabled={disabled} onClick={() => onChange(opt.v)}
            className="px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
            style={{ background: value === opt.v ? 'var(--accent)' : 'var(--bg-tertiary)', color: value === opt.v ? 'white' : 'var(--text-secondary)' }}>
            {opt.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReviewDetail({ item, criteria, canEdit, canPromote, onBack, toast, navigate }) {
  const [criteriaAnswers, setCriteriaAnswers] = useState(item.intake_criteria || {});
  const [confirmPromote, setConfirmPromote] = useState(false);
  const [promoting, setPromoting] = useState(false);

  const updateCriterion = async (key, value) => {
    const prev = criteriaAnswers;
    setCriteriaAnswers(a => ({ ...a, [key]: { ...(a[key] || {}), value, source: 'human' } }));
    try {
      await api.put(`/intake/cases/${item.id}/criteria`, { criteria: { [key]: value } });
    } catch (e) { toast.error(e.message); setCriteriaAnswers(prev); }
  };

  const doPromote = async () => {
    setPromoting(true);
    try {
      await api.post(`/intake/${item.id}/promote`, {});
      toast.success('تم اعتماد القضية ونقلها للقضايا الجاهزة للعمل');
      setConfirmPromote(false);
      onBack();
    } catch (e) { toast.error(e.message); setPromoting(false); }
  };

  const SourceIcon = SOURCE_ICON[item.intake_source] || Link2;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
        <ArrowRight className="w-4 h-4" /> العودة لقائمة الفرز
      </button>

      <Card>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{item.title}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="neutral"><SourceIcon className="w-3 h-3" /> {SOURCE_LABEL[item.intake_source] || '—'}</Badge>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(item.created_at).toLocaleDateString('ar-EG')}</span>
            </div>
          </div>
          <button onClick={() => navigate(`/cases/${item.id}`)} className="flex items-center gap-1 text-xs shrink-0" style={{ color: 'var(--accent)' }}>
            فتح ملف القضية الكامل <ExternalLink className="w-3 h-3" />
          </button>
        </div>
        {item.description && <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{item.description.slice(0, 500)}</p>}
        <div className="flex items-center gap-3 mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>{item.agency_count} جهة مكتشفة</span>
          <span>{item.document_count} مستند مرفق</span>
          <span className="font-semibold">{item.completeness}% اكتمال</span>
        </div>
      </Card>

      <Card title="نتيجة الفرز">
        {criteria.length === 0 ? (
          <p className="text-xs text-center py-3" style={{ color: 'var(--text-muted)' }}>لا توجد معايير فرز مُفعّلة حاليًا</p>
        ) : (
          <div>
            {criteria.map(c => (
              <CriterionToggle key={c.key} label={c.label_ar} answer={criteriaAnswers[c.key]} disabled={!canEdit}
                onChange={v => updateCriterion(c.key, v)} />
            ))}
          </div>
        )}
      </Card>

      {canPromote && (
        <Button className="w-full" onClick={() => setConfirmPromote(true)}>
          اعتماد ونقل القضية للقضايا الجاهزة للعمل
        </Button>
      )}

      <ConfirmDialog open={confirmPromote} onClose={() => setConfirmPromote(false)} onConfirm={doPromote}
        title="اعتماد القضية" confirmLabel={promoting ? 'جارٍ النقل...' : 'اعتماد ونقل'}
        message="ستنتقل هذه القضية إلى قسم القضايا الجاهزة للعمل، مع الاحتفاظ بنتيجة الفرز الحالية (قابلة للتعديل لاحقًا من صفحة القضية)." />
    </div>
  );
}

function CriteriaAdminPanel({ onChanged, toast }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const fetchItems = () => {
    setLoading(true);
    api.get('/intake/criteria-definitions').then(d => setItems(d.data || [])).catch(e => toast.error(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { fetchItems(); }, []);

  const add = async () => {
    if (!newLabel.trim()) return;
    const key = newLabel.trim().toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '_').replace(/^_+|_+$/g, '') || `crit_${Date.now()}`;
    try {
      await api.post('/intake/criteria-definitions', { key, label_ar: newLabel.trim() });
      setNewLabel('');
      fetchItems();
      onChanged?.();
    } catch (e) { toast.error(e.message); }
  };

  const toggleActive = async (item) => {
    try { await api.put(`/intake/criteria-definitions/${item.id}`, { is_active: !item.is_active }); fetchItems(); onChanged?.(); }
    catch (e) { toast.error(e.message); }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try { await api.delete(`/intake/criteria-definitions/${confirmDelete.id}`); setConfirmDelete(null); fetchItems(); onChanged?.(); }
    catch (e) { toast.error(e.message); setConfirmDelete(null); }
  };

  if (loading) return <Spinner full />;

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>هذه المعايير تُستخدم في فرز كل قضية واردة إلى استقبال ذكي. تعطيل معيار يخفيه من الفرز الجديد دون حذف إجاباته من القضايا السابقة.</p>
      <div className="flex gap-2">
        <input value={newLabel} onChange={e => setNewLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }}
          placeholder="معيار جديد (مثال: هل يوجد اعتراف)"
          className="flex-1 px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
        <Button icon={Plus} onClick={add}>إضافة</Button>
      </div>
      <div className="space-y-1.5 max-h-72 overflow-y-auto">
        {items.map(it => (
          <div key={it.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--bg-tertiary)', opacity: it.is_active ? 1 : 0.5 }}>
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{it.label_ar}</span>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => toggleActive(it)} className="text-[11px] px-2 py-1 rounded-lg" style={{ background: 'var(--bg-secondary)', color: it.is_active ? 'var(--success)' : 'var(--text-muted)' }}>
                {it.is_active ? 'مفعّل' : 'معطّل'}
              </button>
              <button onClick={() => setConfirmDelete(it)} className="p-1 rounded-lg" style={{ color: 'var(--text-muted)' }}
                onMouseOver={e => e.currentTarget.style.color = 'var(--danger)'} onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <ConfirmDialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={doDelete}
        title="حذف المعيار" confirmLabel="حذف" message={`هل أنت متأكد من حذف "${confirmDelete?.label_ar}"؟ سيتم حذف إجابات هذا المعيار من كل القضايا نهائيًا.`} />
    </div>
  );
}
