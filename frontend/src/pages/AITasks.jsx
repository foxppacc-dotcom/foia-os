import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, Clock, Play, Eye, Pencil, RefreshCw, ShieldCheck, Mail, Bot, Hourglass, Zap, ExternalLink, X as XIcon,
} from 'lucide-react';
import { api } from '../api';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import Select from '../components/ui/Select';
import Input from '../components/ui/Input';
import StatCard from '../components/ui/StatCard';
import { useToast } from '../components/ui/Toast';

const SEVERITY = { critical: { label: 'حرج', variant: 'danger' }, warning: { label: 'تنبيه', variant: 'warning' }, info: { label: 'معلومة', variant: 'info' } };
const STATUS = {
  open: { label: 'مفتوح', variant: 'warning' }, failed: { label: 'فشل التنفيذ', variant: 'danger' }, executed: { label: 'نُفّذ', variant: 'success' },
  resolved: { label: 'تم الحل', variant: 'success' }, dismissed: { label: 'مُتجاهَل', variant: 'neutral' },
};
const KIND = {
  stale_no_reply: 'طلب بلا رد', stale_bounced: 'إيميل مرتد', payment_check: 'طلب دفع', confirmation_pending: 'تأكيد سجلات',
  orphan_reply: 'رد بلا قضية', unhandled_reply: 'رد لم يُعالَج',
};
const ACTION = {
  send_followup: 'إرسال إيميل', link_email_to_case: 'ربط الرد بالقضية', create_case_from_email: 'إنشاء قضية جديدة وربط الرد', archive_communication: 'أرشفة الرسالة',
  set_reply_outcome: 'ضبط نتيجة الرد', move_request_list: 'نقل الطلب لقائمة', create_request: 'إنشاء طلب للجهة الصحيحة', notify_employee: 'تنبيه الموظفين', none: 'لا إجراء آلي',
};
const AUTONOMY = [
  { key: 'report_only', label: 'تقارير ومتابعة فقط', hint: 'يرصد ويذكّر ويعرض النتائج، ولا يجهّز ولا ينفذ شيئًا.' },
  { key: 'propose', label: 'يجهّز وأنت توافق بضغطة (موصى به)', hint: 'يجهّز الإيميل/الإجراء ولا يخرج شيء إلا بعد موافقتك.' },
  { key: 'auto_followup', label: 'يرسل المتابعة تلقائيًا والباقي بموافقة', hint: 'إيميلات المتابعة للحالات الجديدة تُرسل وحدها (بحد أقصى لكل تشغيل)، وأي إجراء آخر بموافقتك.' },
];
const PAY_LABELS = {
  videos_count: 'عدد الفيديوهات', total_minutes: 'إجمالي الدقائق', bodycam_count: 'فيديوهات بودي كام', interrogation_room_count: 'فيديوهات غرفة التحقيق',
  amount: 'المبلغ', payment_method: 'طريقة الدفع', receive_method: 'طريقة الاستلام', expected_delivery: 'موعد الاستلام المتوقع',
};
const FACT_LABELS = {
  sent_date: 'تاريخ الإرسال', due: 'الموعد المتوقع', days_waiting: 'أيام الانتظار', days_overdue: 'أيام التأخر', channel: 'القناة', agency_name: 'الجهة', agency_email: 'إيميل الجهة',
  outbound_count: 'رسائل صادرة', bounced: 'ارتداد', bounce_subject: 'رسالة الارتداد', subject: 'الموضوع', sender: 'المرسل', received: 'وصل في', hours_waiting: 'ساعات الانتظار',
  hours_since_reply: 'ساعات منذ الرد', attachments: 'المرفقات', agency_match: 'جهة مطابقة', case_title: 'القضية',
};

function timeAgo(iso) {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'الآن';
  if (s < 3600) return `منذ ${Math.floor(s / 60)} دقيقة`;
  if (s < 86400) return `منذ ${Math.floor(s / 3600)} ساعة`;
  return `منذ ${Math.floor(s / 86400)} يوم`;
}
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : '—');
function scheduleText(t) {
  if (t.schedule_type === 'daily') return `يوميًا ${t.run_at_time || ''}`;
  const m = t.interval_minutes;
  return m % 60 === 0 ? (m === 60 ? 'كل ساعة' : `كل ${m / 60} ساعات`) : `كل ${m} دقيقة`;
}

// ------------------------------------------------------------------ finding card
function FindingCard({ f, canReview, onChanged, highlighted }) {
  const toast = useToast();
  const navigate = useNavigate();
  const action = f.proposed_action;
  const [draft, setDraft] = useState(() => ({ subject: action?.draft?.subject || '', body: action?.draft?.body || '' }));
  const [to, setTo] = useState(action?.params?.to || '');
  const [busy, setBusy] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [reason, setReason] = useState('');
  const sev = SEVERITY[f.severity] || SEVERITY.info;
  const isOpen = f.status === 'open' || f.status === 'failed';
  const aiEv = f.evidence?.ai?.evidence;
  const facts = f.evidence?.facts || {};
  const hasPayment = aiEv && ('missing' in aiEv || 'videos_count' in aiEv);
  const canRun = isOpen && canReview && action && action.type && action.type !== 'none';

  const call = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); toast.success(okMsg); onChanged(); }
    catch (e) { toast.error(e.message || 'فشلت العملية'); onChanged(); }
    finally { setBusy(false); }
  };
  const approve = () => call(() => api.post(`/ai-tasks/findings/${f.id}/approve`, {
    draft: action.type === 'send_followup' ? draft : undefined, params: action.type === 'send_followup' && to.trim() ? { to: to.trim() } : undefined,
  }), 'تم التنفيذ');

  return (
    <div className="rounded-2xl border p-4 space-y-3" style={{ background: 'var(--bg-secondary)', borderColor: highlighted ? 'var(--accent)' : 'var(--border)', boxShadow: highlighted ? '0 0 0 2px var(--accent-subtle)' : 'var(--shadow-sm)' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={sev.variant} dot>{sev.label}</Badge>
          <Badge variant="neutral">{KIND[f.kind] || f.kind}</Badge>
          {!isOpen && <Badge variant={(STATUS[f.status] || STATUS.resolved).variant}>{(STATUS[f.status] || {}).label || f.status}</Badge>}
          {f.baseline && isOpen && <Badge variant="neutral">متراكم من قبل</Badge>}
        </div>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{timeAgo(f.first_seen_at)}{f.times_seen > 1 ? ` · رُصد ${f.times_seen} مرة` : ''}</span>
      </div>

      <div>
        <p className="font-semibold text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>{f.title}</p>
        {f.details && <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{f.details}</p>}
        {f.case_id && (
          <button onClick={() => navigate(`/cases/${f.case_id}`)} className="inline-flex items-center gap-1 text-xs mt-2" style={{ color: 'var(--accent)' }}>
            <ExternalLink className="w-3 h-3" /> فتح القضية{f.case_title ? `: ${f.case_title}` : ''}
          </button>
        )}
      </div>

      {hasPayment && (
        <div className="rounded-xl border p-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)' }}>
          {Object.entries(PAY_LABELS).map(([k, label]) => {
            const v = aiEv[k];
            const known = v !== null && v !== undefined && v !== '';
            return (
              <div key={k} className="flex items-center justify-between gap-2 text-xs">
                <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                <span className="font-medium flex items-center gap-1" style={{ color: known ? 'var(--success)' : 'var(--danger)' }}>
                  {known ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XIcon className="w-3.5 h-3.5" />}{known ? String(v) : 'ناقص'}
                </span>
              </div>
            );
          })}
          {aiEv.ready_to_pay === true && <p className="sm:col-span-2 text-xs font-semibold" style={{ color: 'var(--success)' }}>✔ كل البنود مكتملة — جاهز للدفع بانتظار موافقة الإدارة</p>}
        </div>
      )}

      {Object.keys(facts).length > 0 && (
        <div>
          <button onClick={() => setShowEvidence(s => !s)} className="text-xs" style={{ color: 'var(--text-muted)' }}>{showEvidence ? '▾ إخفاء الأدلة' : '▸ عرض الأدلة'}</button>
          {showEvidence && (
            <div className="mt-2 rounded-xl border p-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)' }}>
              {Object.entries(facts).filter(([, v]) => v !== null && v !== '' && v !== undefined && typeof v !== 'object').map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2"><span style={{ color: 'var(--text-muted)' }}>{FACT_LABELS[k] || k}</span><span className="text-left" style={{ color: 'var(--text-primary)' }}>{String(v)}</span></div>
              ))}
              {Array.isArray(facts.attachments) && facts.attachments.length > 0 && <div className="sm:col-span-2" style={{ color: 'var(--text-muted)' }}>مرفقات: {facts.attachments.join('، ')}</div>}
            </div>
          )}
        </div>
      )}

      {action && action.type && (
        <div className="rounded-xl border p-3 space-y-2" style={{ background: 'var(--accent-subtle)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--accent)' }}><Zap className="w-3.5 h-3.5" /> الإجراء المقترح: {ACTION[action.type] || action.type}</div>
          {action.summary && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{action.summary}</p>}
          {action.type === 'send_followup' && isOpen && (
            <div className="space-y-2" dir="ltr">
              <Input label="To (اتركه فارغًا لاستخدام إيميل الجهة)" value={to} onChange={e => setTo(e.target.value)} placeholder={facts.agency_email || 'agency@example.gov'} />
              <Input label="Subject" value={draft.subject} onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))} />
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Body</label>
                <textarea rows={7} value={draft.body} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))} className="w-full rounded-xl border p-3 text-sm outline-none"
                  style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }} />
              </div>
            </div>
          )}
          {action.type !== 'send_followup' && action.params && Object.keys(action.params).length > 0 && (
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }} dir="ltr">{Object.entries(action.params).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
          )}
        </div>
      )}
      {f.status === 'failed' && f.evidence?.last_error && <p className="text-xs" style={{ color: 'var(--danger)' }}>فشل آخر تنفيذ: {f.evidence.last_error}</p>}
      {f.status === 'executed' && f.evidence?.execution && <p className="text-xs" style={{ color: 'var(--success)' }}>نُفّذ بواسطة {f.evidence.execution.by || '—'} {timeAgo(f.evidence.execution.at)}{f.evidence.execution.auto ? ' (تلقائيًا)' : ''}</p>}
      {!isOpen && f.resolved_reason && f.status !== 'executed' && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{f.resolved_reason === 'auto' ? '✔ تعامل الفريق مع الحالة فأُغلقت تلقائيًا' : f.resolved_reason === 'ai_not_needed' ? 'رأى المساعد أنها لا تحتاج إجراء' : f.resolved_reason}{f.resolved_at ? ` · ${timeAgo(f.resolved_at)}` : ''}</p>}

      {isOpen && canReview && (
        <div className="flex gap-2 flex-wrap pt-1">
          {canRun && <Button size="sm" loading={busy} icon={ShieldCheck} onClick={approve}>موافقة وتنفيذ</Button>}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => call(() => api.post(`/ai-tasks/findings/${f.id}/resolve`, {}), 'تم تسجيلها كمُنجزة')}>تم يدويًا</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDismissOpen(true)}>تجاهل</Button>
        </div>
      )}
      {!isOpen && canReview && (f.status === 'dismissed' || f.status === 'resolved') && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => call(() => api.post(`/ai-tasks/findings/${f.id}/reopen`, {}), 'أُعيد فتحها')}>إعادة فتح</Button>
      )}

      <Modal open={dismissOpen} onClose={() => setDismissOpen(false)} title="تجاهل هذا البند" footer={(
        <>
          <Button variant="secondary" className="flex-1" onClick={() => setDismissOpen(false)}>إلغاء</Button>
          <Button className="flex-1" loading={busy} onClick={async () => { await call(() => api.post(`/ai-tasks/findings/${f.id}/dismiss`, { reason }), 'تم التجاهل'); setDismissOpen(false); }}>تجاهل</Button>
        </>
      )}>
        <Input label="السبب (اختياري)" value={reason} onChange={e => setReason(e.target.value)} placeholder="مثلاً: تمت المتابعة هاتفيًا" />
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ findings tab
function FindingsTab({ tasks, canReview, focusId }) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ status: 'open', task_id: '', severity: '', q: '' });
  const [offset, setOffset] = useState(0);
  const [focused, setFocused] = useState(null);
  const LIMIT = 30;

  const load = useCallback((reset = true) => {
    setLoading(true);
    const params = new URLSearchParams({ status: filters.status, limit: String(LIMIT), offset: String(reset ? 0 : offset) });
    if (filters.task_id) params.set('task_id', filters.task_id);
    if (filters.severity) params.set('severity', filters.severity);
    if (filters.q.trim()) params.set('q', filters.q.trim());
    api.get(`/ai-tasks/findings?${params}`)
      .then(d => { setItems(prev => (reset ? d.data : [...prev, ...d.data])); setTotal(d.total || 0); setOffset((reset ? 0 : offset) + d.data.length); setError(''); })
      .catch(e => setError(e.message || 'تعذر التحميل'))
      .finally(() => setLoading(false));
  }, [filters, offset]);

  useEffect(() => { load(true); /* eslint-disable-next-line */ }, [filters.status, filters.task_id, filters.severity]);
  useEffect(() => {
    if (!focusId) return;
    api.get(`/ai-tasks/findings/${focusId}`).then(d => setFocused(d.data)).catch(() => {});
  }, [focusId]);
  useEffect(() => { const t = setTimeout(() => load(true), 350); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [filters.q]);

  const refresh = () => { load(true); if (focusId) api.get(`/ai-tasks/findings/${focusId}`).then(d => setFocused(d.data)).catch(() => {}); };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Select label="الحالة" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value="open">مفتوحة</option><option value="executed">نُفّذت</option><option value="resolved">تم حلها</option><option value="dismissed">متجاهَلة</option><option value="all">الكل</option>
        </Select>
        <Select label="المهمة" value={filters.task_id} onChange={e => setFilters(f => ({ ...f, task_id: e.target.value }))}>
          <option value="">كل المهام</option>{tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
        </Select>
        <Select label="الشدة" value={filters.severity} onChange={e => setFilters(f => ({ ...f, severity: e.target.value }))}>
          <option value="">الكل</option><option value="critical">حرج</option><option value="warning">تنبيه</option><option value="info">معلومة</option>
        </Select>
        <Input label="بحث في العنوان" value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} placeholder="اسم جهة أو قضية…" />
      </div>

      {focused && !items.some(i => i.id === focused.id) && <FindingCard f={focused} canReview={canReview} onChanged={refresh} highlighted />}
      {loading && !items.length ? <Spinner full /> : error ? (
        <Card><EmptyState icon={AlertTriangle} title="تعذر التحميل" description={error} /></Card>
      ) : !items.length ? (
        <Card><EmptyState icon={ShieldCheck} title="لا يوجد ما يحتاج انتباهك" description="المساعد لم يجد شيئًا مفتوحًا بهذه الفلاتر." /></Card>
      ) : (
        <>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{total} بند</p>
          <div className="space-y-3">{items.map(f => <FindingCard key={f.id} f={f} canReview={canReview} onChanged={refresh} highlighted={String(f.id) === String(focusId)} />)}</div>
          {items.length < total && <div className="flex justify-center"><Button variant="secondary" loading={loading} onClick={() => load(false)}>عرض المزيد ({total - items.length})</Button></div>}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ tasks tab
function TaskEditModal({ task, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({
    title: task.title, instructions: task.instructions || '', schedule_type: task.schedule_type, interval_minutes: task.interval_minutes, run_at_time: task.run_at_time || '09:00',
    config: { ...(task.config || {}) },
  }));
  const [busy, setBusy] = useState(false);
  const cfgInput = (k, label) => (task.config?.[k] !== undefined) && (
    <Input key={k} label={label} type="number" value={f.config[k] ?? ''} onChange={e => setF(s => ({ ...s, config: { ...s.config, [k]: e.target.value } }))} />
  );
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/ai-tasks/tasks/${task.id}`, { title: f.title, instructions: f.instructions, schedule_type: f.schedule_type, interval_minutes: Number(f.interval_minutes), run_at_time: f.schedule_type === 'daily' ? f.run_at_time : null, config: f.config });
      toast.success('تم الحفظ'); onSaved();
    } catch (e) { toast.error(e.message || 'فشل الحفظ'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`تعديل المهمة`} maxWidth="max-w-xl" footer={(<><Button variant="secondary" className="flex-1" onClick={onClose}>إلغاء</Button><Button className="flex-1" loading={busy} onClick={save}>حفظ</Button></>)}>
      <div className="space-y-3">
        <Input label="العنوان" value={f.title} onChange={e => setF(s => ({ ...s, title: e.target.value }))} />
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>تعليمات المساعد لهذه المهمة (يمكنك تعديلها بلغتك)</label>
          <textarea rows={8} value={f.instructions} onChange={e => setF(s => ({ ...s, instructions: e.target.value }))} className="w-full rounded-xl border p-3 text-sm outline-none"
            style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="التكرار" value={f.schedule_type} onChange={e => setF(s => ({ ...s, schedule_type: e.target.value }))}>
            <option value="interval">كل فترة</option><option value="daily">يوميًا في وقت محدد (توقيت القاهرة)</option>
          </Select>
          {f.schedule_type === 'daily'
            ? <Input label="الساعة" type="time" value={f.run_at_time} onChange={e => setF(s => ({ ...s, run_at_time: e.target.value }))} />
            : <Input label="كل كم دقيقة" type="number" min={5} value={f.interval_minutes} onChange={e => setF(s => ({ ...s, interval_minutes: e.target.value }))} />}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {cfgInput('fallback_days', 'مهلة احتياطية (أيام) لطلب بلا موعد')}
          {cfgInput('followup_cooldown_days', 'لا تتابع جهة قبل مرور (أيام)')}
          {cfgInput('grace_hours', 'مهلة تعامل الموظف (ساعات)')}
          {cfgInput('min_age_hours', 'أقل عمر للرد اليتيم (ساعات)')}
          {cfgInput('max_candidates', 'أقصى عدد يحلله المساعد في التشغيل')}
          {cfgInput('batch_size', 'حجم الدفعة')}
          {cfgInput('max_auto_followups', 'أقصى متابعات تلقائية في التشغيل')}
        </div>
      </div>
    </Modal>
  );
}

function TaskCard({ task, perms, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [preview, setPreview] = useState(null);
  const call = async (fn, okMsg) => { setBusy(true); try { const r = await fn(); if (okMsg) toast.success(okMsg); onChanged(); return r; } catch (e) { toast.error(e.message || 'فشلت العملية'); } finally { setBusy(false); } };
  const setAutonomy = (v) => { if (v === 'auto_followup') setConfirmAuto(true); else call(() => api.put(`/ai-tasks/tasks/${task.id}`, { autonomy: v }), 'تم تغيير مستوى الاستقلالية'); };
  const aut = AUTONOMY.find(a => a.key === task.autonomy) || AUTONOMY[1];
  const runBadge = task.status === 'running' ? <Badge variant="info" dot>يعمل الآن</Badge> : task.last_run_status === 'failed' ? <Badge variant="danger">فشل آخر تشغيل</Badge> : task.last_run_at ? <Badge variant="success">آخر تشغيل ناجح</Badge> : <Badge variant="neutral">لم يعمل بعد</Badge>;

  return (
    <div className="rounded-2xl border p-4 space-y-3" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-sm)', opacity: task.enabled ? 1 : 0.7 }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{task.title}</p>
          {task.description && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{task.description}</p>}
          {task.config?.created_by_ai && <p className="text-[11px] mt-1" style={{ color: 'var(--accent)' }}>🤖 أنشأها المساعد بنفسه بناءً على طلبك{task.config.origin_request ? `: «${task.config.origin_request}»` : ''}</p>}
          {Array.isArray(task.config?.plan) && task.config.plan.length > 0 && (
            <div className="mt-2">
              <p className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>خطة المساعد</p>
              <ol className="mt-1 pr-4 space-y-0.5 text-[11px] list-decimal" style={{ color: 'var(--text-secondary)' }}>{task.config.plan.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {task.open_findings > 0 && <Badge variant={task.critical_findings ? 'danger' : 'warning'} dot>{task.open_findings} مفتوح</Badge>}
          {runBadge}
          {perms.canManage && (
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={task.enabled} disabled={busy} onChange={e => call(() => api.put(`/ai-tasks/tasks/${task.id}`, { enabled: e.target.checked }), e.target.checked ? 'تم التفعيل' : 'تم الإيقاف')} className="w-4 h-4" />
              مفعّلة
            </label>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <div><p style={{ color: 'var(--text-muted)' }}>التكرار</p><p className="font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}><Clock className="w-3 h-3 inline ml-1" />{scheduleText(task)}</p></div>
        <div><p style={{ color: 'var(--text-muted)' }}>آخر تشغيل</p><p className="font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}>{timeAgo(task.last_run_at)}</p></div>
        <div><p style={{ color: 'var(--text-muted)' }}>التشغيل القادم</p><p className="font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}>{task.enabled ? fmtDate(task.next_run_at) : 'متوقفة'}</p></div>
        <div><p style={{ color: 'var(--text-muted)' }}>يعمل بصلاحية</p><p className="font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}>{task.owner_name || '—'}</p></div>
      </div>

      <div>
        <p className="text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>مستوى استقلالية المساعد</p>
        <Select value={task.autonomy} disabled={!perms.canManage || busy} onChange={e => setAutonomy(e.target.value)}>
          {AUTONOMY.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
        </Select>
        <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>{aut.hint}</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {perms.canRun && <Button size="sm" icon={Play} loading={busy || task.status === 'running'} onClick={() => call(() => api.post(`/ai-tasks/tasks/${task.id}/run`, {}), 'بدأ التشغيل في الخلفية')}>تشغيل الآن</Button>}
        {perms.canRun && <Button size="sm" variant="secondary" icon={Eye} disabled={busy} onClick={async () => { const r = await call(() => api.post(`/ai-tasks/tasks/${task.id}/preview`, {})); if (r) setPreview(r.data); }}>معاينة (بدون حفظ)</Button>}
        {perms.canManage && <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEdit(true)}>تعديل</Button>}
      </div>

      {edit && <TaskEditModal task={task} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); onChanged(); }} />}
      <ConfirmDialog open={confirmAuto} onClose={() => setConfirmAuto(false)} danger={false} confirmLabel="تفعيل الإرسال التلقائي" title="تفعيل الإرسال التلقائي"
        message="سيُرسل المساعد إيميلات المتابعة للجهات من تلقاء نفسه (للحالات الجديدة فقط، وبحد أقصى لكل تشغيل) ويسجّلها في المراسلات. أي إجراء آخر يبقى بموافقتك. هل تريد المتابعة؟"
        onConfirm={async () => { await call(() => api.put(`/ai-tasks/tasks/${task.id}`, { autonomy: 'auto_followup' }), 'تم تفعيل الإرسال التلقائي'); setConfirmAuto(false); }} />
      <Modal open={!!preview} onClose={() => setPreview(null)} title="نتيجة المعاينة (لم يُحفظ شيء)">
        {preview && (
          <div className="space-y-2 text-sm" style={{ color: 'var(--text-primary)' }}>
            <p><b>{preview.candidates}</b> حالة مطابقة الآن</p>
            <pre className="text-[11px] rounded-xl p-3 overflow-auto" dir="ltr" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>{JSON.stringify(preview.stats, null, 2)}</pre>
            {(preview.sample || []).map(s => <p key={s.key} className="text-xs" style={{ color: 'var(--text-secondary)' }}>• {s.title}</p>)}
          </div>
        )}
      </Modal>
    </div>
  );
}

function TasksTab({ tasks, perms, onChanged }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {tasks.map(t => <TaskCard key={t.id} task={t} perms={perms} onChanged={onChanged} />)}
      {!tasks.length && <Card><EmptyState icon={Bot} title="لا توجد مهام" description="لم تُنشأ مهام دورية بعد." /></Card>}
    </div>
  );
}

// ------------------------------------------------------------------ runs tab
function RunsTab() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);
  useEffect(() => { api.get('/ai-tasks/runs?limit=60').then(d => setRuns(d.data || [])).finally(() => setLoading(false)); }, []);
  if (loading) return <Spinner full />;
  if (!runs.length) return <Card><EmptyState icon={Hourglass} title="لا يوجد سجل بعد" description="سيظهر هنا كل تشغيل للمهام مع ملخصه." /></Card>;
  return (
    <div className="space-y-2">
      {runs.map(r => (
        <div key={r.id} className="rounded-xl border p-3" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
          <button className="w-full flex items-center justify-between gap-3 flex-wrap text-right" onClick={() => setOpen(open === r.id ? null : r.id)}>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={r.status === 'ok' ? 'success' : r.status === 'failed' ? 'danger' : r.status === 'running' ? 'info' : 'neutral'} dot>{r.status === 'ok' ? 'نجح' : r.status === 'failed' ? 'فشل' : r.status === 'running' ? 'يعمل' : r.status}</Badge>
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{r.task_title}</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.trigger === 'manual' ? 'يدوي' : 'مجدول'}</span>
            </div>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{fmtDate(r.started_at)} · {r.candidates_count} حالة · {r.findings_new} جديد · {r.findings_resolved} أُغلق · {r.llm_calls} طلب نموذج</span>
          </button>
          {open === r.id && (
            <div className="mt-2 text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <p>{r.summary || '—'}</p>
              {r.error && <p style={{ color: 'var(--danger)' }}>خطأ: {r.error}</p>}
              {Array.isArray(r.steps) && r.steps.length > 0 && <p dir="ltr" style={{ color: 'var(--text-muted)' }}>{r.steps.slice(0, 30).map(s => `${s.tool}${s.ok === false ? '✗' : ''}`).join(' → ')}</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ list-map tab
const MAP_LABELS = { payment: 'قوائم «مطلوب دفع»', terminal: 'قوائم منتهية (لا متابعة فيها)', confirmation: 'قوائم «تأكيد/مواطنة»', awaiting: 'قوائم «بانتظار الرد»' };
function ListMapTab({ canManage }) {
  const toast = useToast();
  const [map, setMap] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/ai-tasks/list-map').then(d => setMap(d.data)); }, []);
  if (!map) return <Spinner full />;
  const toggle = (k, id) => setMap(m => ({ ...m, [k]: m[k].includes(id) ? m[k].filter(x => x !== id) : [...m[k], id] }));
  const save = async () => { setBusy(true); try { await api.put('/ai-tasks/list-map', { payment: map.payment, terminal: map.terminal, confirmation: map.confirmation, awaiting: map.awaiting }); toast.success('تم الحفظ'); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>يربط المساعد مفاهيم العمل (دفع، منتهي، تأكيد) بقوائم خط الإنتاج الفعلية. اختيرت تلقائيًا بالاسم — عدّلها لو لزم.</p>
      {Object.keys(MAP_LABELS).map(k => (
        <Card key={k} title={MAP_LABELS[k]}>
          <div className="flex flex-wrap gap-2">
            {map.lists.map(l => {
              const on = (map[k] || []).includes(l.id);
              return <button key={l.id} disabled={!canManage} onClick={() => toggle(k, l.id)} className="px-3 py-1.5 rounded-full text-xs border transition-all"
                style={{ background: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--text-inverse)' : 'var(--text-secondary)', borderColor: on ? 'var(--accent)' : 'var(--border-strong)' }}>{l.name}</button>;
            })}
          </div>
        </Card>
      ))}
      {canManage && <Button loading={busy} onClick={save}>حفظ الربط</Button>}
    </div>
  );
}

// ------------------------------------------------------------------ limits tab
const LIMIT_FIELDS = [
  { key: 'max_custom_tasks', label: 'أقصى عدد للمهام التي ينشئها المساعد بنفسه', hint: 'كل مهمة مخصّصة تُشغَّل في مواعيدها وتستهلك طلبات للنموذج.' },
  { key: 'min_interval_minutes', label: 'أقل فترة بين تشغيلين (بالدقائق)', hint: 'كلما صغرت زادت سرعة المتابعة وزادت التكلفة. الجاهزة والمخصّصة تلتزم بها عند إنشاء المساعد لمهمة.' },
  { key: 'daily_llm_budget', label: 'ميزانية المهام اليومية (طلبات للنموذج)', hint: 'عند استهلاكها تتوقف المهام حتى اليوم التالي. ارفعها لو الإنجاز أهم من التكلفة.' },
  { key: 'provider_daily_cap', label: 'السقف اليومي لكل طلبات المساعد (المحادثة + المهام)', hint: 'إن وصل إليه العدّاد تتوقف المحادثة أيضًا. ارفعه معه كلما رفعت ميزانية المهام.' },
];
function LimitsTab({ canManage }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const load = () => api.get('/ai-tasks/limits').then(d => { setData(d.data); setForm(d.data.limits); });
  useEffect(() => { load(); }, []);
  if (!data) return <Spinner full />;
  const save = async () => {
    setBusy(true);
    try { await api.put('/ai-tasks/limits', form); toast.success('تم حفظ الحدود'); await load(); }
    catch (e) { toast.error(e.message || 'فشل الحفظ'); } finally { setBusy(false); }
  };
  const u = data.usage;
  return (
    <div className="space-y-4 max-w-3xl">
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>أنت من يحدد سرعة المساعد وتكلفته. ارفع الأرقام عندما يهمّك الإنجاز السريع حتى لو زادت التكلفة، وخفّضها لتوفير الاستهلاك.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard icon={Bot} label="مهام مخصّصة حاليًا" value={u.custom_tasks} color="var(--accent)" />
        <StatCard icon={Zap} label="طلبات المهام اليوم" value={u.tasks_llm_calls_today} color="var(--info)" />
        <StatCard icon={Hourglass} label="كل طلبات المساعد اليوم" value={u.all_requests_today} color="var(--warning)" />
      </div>
      <Card>
        <div className="space-y-4">
          {LIMIT_FIELDS.map(f => (
            <div key={f.key}>
              <Input label={f.label} type="number" min={data.ranges[f.key][0]} max={data.ranges[f.key][1]} disabled={!canManage}
                value={form[f.key] ?? ''} onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))} />
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>{f.hint} (من {data.ranges[f.key][0]} إلى {data.ranges[f.key][1]})</p>
            </div>
          ))}
          {canManage && <Button loading={busy} onClick={save}>حفظ الحدود</Button>}
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ page
export default function AITasks() {
  const [params] = useSearchParams();
  const focusId = params.get('finding');
  const [tab, setTab] = useState('findings');
  const [tasks, setTasks] = useState([]);
  const [summary, setSummary] = useState(null);
  const [perms, setPerms] = useState({ canView: false, canManage: false, canRun: false, canReview: false, loaded: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/permissions/mine').then(d => {
      const has = (a) => !!(d.wildcard || (d.permissions || []).some(p => p.resource === 'ai_tasks' && p.action === a));
      setPerms({ canView: has('view'), canManage: has('manage'), canRun: has('run'), canReview: has('review'), loaded: true });
    }).catch(() => setPerms(p => ({ ...p, loaded: true })));
  }, []);

  const load = useCallback(() => {
    Promise.all([api.get('/ai-tasks/tasks'), api.get('/ai-tasks/summary')])
      .then(([t, s]) => { setTasks(t.data || []); setSummary(s.data); setError(''); })
      .catch(e => setError(e.message || 'تعذر التحميل'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); const i = setInterval(load, 60000); return () => clearInterval(i); }, [load]);

  const tabs = useMemo(() => [
    { key: 'findings', label: `يحتاج انتباهك${summary ? ` (${summary.open})` : ''}` },
    { key: 'tasks', label: 'المهام الدورية' },
    { key: 'runs', label: 'سجل التشغيل' },
    { key: 'lists', label: 'ربط القوائم' },
    { key: 'limits', label: 'الحدود والميزانية' },
  ], [summary]);

  if (loading || !perms.loaded) return <Spinner full />;
  if (error) return <Card><EmptyState icon={AlertTriangle} title="تعذر التحميل" description={error} /></Card>;

  const budget = summary?.llm_budget || {};
  return (
    <div className="space-y-5 animate-fadeIn">
      <PageHeader eyebrow="ذكاء اصطناعي" title="مهام المساعد الدورية"
        meta="المساعد يراقب النظام نيابةً عنك بشكل دوري: يكتشف الطلبات المنسيّة والردود الضائعة ويجهّز لك الإجراء المناسب لتوافق عليه."
        actions={<Button variant="secondary" size="sm" icon={RefreshCw} onClick={load}>تحديث</Button>} />

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={AlertTriangle} label={`مفتوح (${summary.by_severity.critical} حرج)`} value={summary.open} color="var(--danger)" />
          <StatCard icon={CheckCircle2} label="تعامل الفريق معها آخر 7 أيام" value={summary.handled_by_team_7d} color="var(--success)" />
          <StatCard icon={Clock} label="متوسط زمن تعامل الفريق (ساعة)" value={summary.avg_hours_to_handle ?? '—'} color="var(--info)" />
          <StatCard icon={Mail} label="نفّذها المساعد بموافقتك (7 أيام)" value={summary.executed_7d} color="var(--accent)" />
        </div>
      )}
      {budget.date && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>استهلاك المساعد اليوم: {budget.count || 0} طلب للنموذج — الحدود تعدّلها من تبويب «الحدود والميزانية»</p>}

      <div className="flex"><div className="inline-flex flex-wrap gap-1 p-1 rounded-2xl" style={{ background: 'var(--bg-tertiary)' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
            style={{ background: tab === t.key ? 'var(--bg-secondary)' : 'transparent', color: tab === t.key ? 'var(--accent)' : 'var(--text-muted)', boxShadow: tab === t.key ? 'var(--shadow-sm)' : 'none' }}>{t.label}</button>
        ))}
      </div></div>

      {tab === 'findings' && <FindingsTab tasks={tasks} canReview={perms.canReview} focusId={focusId} />}
      {tab === 'tasks' && <TasksTab tasks={tasks} perms={perms} onChanged={load} />}
      {tab === 'runs' && <RunsTab />}
      {tab === 'lists' && <ListMapTab canManage={perms.canManage} />}
      {tab === 'limits' && <LimitsTab canManage={perms.canManage} />}
    </div>
  );
}
