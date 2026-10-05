import { useState, useEffect, useRef } from 'react';
import { api, getApiBase, getCurrentUser } from '../api';
import { Mail, Plus, Trash2, RefreshCw, Send, Power, PowerOff, Loader2, X, CheckCircle, AlertCircle, Pencil, Users } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import { TableShell, Thead, Th, Td, Tr } from '../components/ui/Table';
import { formatArabicDate } from '../utils/formatDate';

const GMAIL_DEFAULTS = {
  smtp_host: 'smtp.gmail.com', smtp_port: '587', imap_host: 'imap.gmail.com', imap_port: '993',
};

export default function EmailAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillingAttachments, setBackfillingAttachments] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState({ account_id: '', to: '', subject: '', body: '' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    email: '', name: '', provider: '',
    smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '',
    imap_host: '', imap_port: '993', imap_user: '', imap_pass: '',
    daily_limit: '100',
  });

  const BASE = getApiBase();
  const tok = () => localStorage.getItem('foia_token');
  const hdrs = () => ({ 'Authorization': `Bearer ${tok()}`, 'Content-Type': 'application/json' });

  // Every mutating route here (create/edit/delete/assign) requires
  // email_accounts:manage server-side -- these buttons used to render for
  // ANY authenticated user who could reach this page (sidebar visibility is
  // a separate, independently-defaulted-open nav toggle), so a role without
  // `manage` saw full edit/delete/assign controls that all 403'd instead of
  // simply not being shown.
  const [canManage, setCanManage] = useState(false);
  useEffect(() => {
    if (getCurrentUser()?.role === 'admin') { setCanManage(true); return; }
    fetch(`${BASE}/permissions/mine`, { headers: hdrs() })
      .then(r => r.json())
      .then(d => setCanManage((d.permissions || []).some(p => p.resource === 'email_accounts' && p.action === 'manage')))
      .catch(() => setCanManage(false));
  }, []);

  const fetchAccounts = async () => {
    try {
      const r = await fetch(`${BASE}/email-accounts`, { headers: hdrs() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || 'فشل تحميل الحسابات'); setLoading(false); return; }
      setAccounts(Array.isArray(d) ? d : d.data || d.accounts || []);
    } catch (e) { setError('فشل تحميل الحسابات'); }
    setLoading(false);
  };

  useEffect(() => { fetchAccounts(); }, []);

  const clearFeedback = () => { setError(''); setSuccess(''); };

  const createAccount = async () => {
    clearFeedback();
    if (!form.email) { setError('البريد الإلكتروني مطلوب'); return; }
    if (!form.name) { setError('اسم الحساب مطلوب'); return; }
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/email-accounts`, {
        method: 'POST', headers: hdrs(),
        body: JSON.stringify({
          ...form,
          daily_limit: parseInt(form.daily_limit) || 100,
          smtp_port: parseInt(form.smtp_port) || 587,
          imap_port: parseInt(form.imap_port) || 993,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || d.message || 'فشل إنشاء الحساب'); setSaving(false); return; }
      setSuccess(`تم إنشاء حساب ${form.email} بنجاح`);
      setTimeout(() => setSuccess(''), 3000);
      setShowForm(false);
      setForm({ email: '', name: '', provider: '', smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '', imap_host: '', imap_port: '993', imap_user: '', imap_pass: '', daily_limit: '100' });
      fetchAccounts();
    } catch (e) {
      setError('خطأ في الاتصال: ' + (e.message || ''));
    }
    setSaving(false);
  };

  const toggleActive = async (account) => {
    try {
      const r = await fetch(`${BASE}/email-accounts/${account.id}`, {
        method: 'PUT', headers: hdrs(),
        body: JSON.stringify({ is_active: !account.is_active }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error || 'فشل تغيير حالة الحساب'); return; }
      fetchAccounts();
    } catch { setError('فشل تغيير حالة الحساب'); }
  };

  const [editingLimitId, setEditingLimitId] = useState(null);
  const [editingLimitValue, setEditingLimitValue] = useState('');

  const [editingAccount, setEditingAccount] = useState(null);
  const [editForm, setEditForm] = useState(null);

  // Per-employee mailbox access: which specific employees may see/use each
  // account (independent of role) -- see backend/src/services/emailAccountAccess.js.
  const [allUsers, setAllUsers] = useState([]);
  const [assigningAccount, setAssigningAccount] = useState(null);
  const [assignedUserIds, setAssignedUserIds] = useState(new Set());
  const [loadingAssignees, setLoadingAssignees] = useState(false);
  const [savingAssignees, setSavingAssignees] = useState(false);
  // Guards against opening the modal for one account, then quickly switching
  // to another before the first account's fetch resolves -- without this, a
  // slow first response landing AFTER the second account's fetch would
  // silently overwrite assignedUserIds with the WRONG account's list while
  // the modal header still shows the second account, so "حفظ" could save one
  // account's mailbox access under a completely different account's name.
  const assignRequestId = useRef(0);

  useEffect(() => {
    fetch(`${BASE}/users/list`, { headers: hdrs() })
      .then(r => r.json()).then(d => setAllUsers(d.data || []))
      .catch(() => {});
  }, []);

  const openAssignModal = async (acc) => {
    const requestId = ++assignRequestId.current;
    setAssigningAccount(acc);
    setAssignedUserIds(new Set());
    setLoadingAssignees(true);
    clearFeedback();
    try {
      const r = await fetch(`${BASE}/email-accounts/${acc.id}/assignees`, { headers: hdrs() });
      const d = await r.json().catch(() => ({}));
      if (requestId !== assignRequestId.current) return; // a newer open() superseded this one
      if (!r.ok) { setError(d.error || 'فشل تحميل قائمة الموظفين المخصصين'); setLoadingAssignees(false); return; }
      setAssignedUserIds(new Set((d.data || []).map(a => a.user_id)));
    } catch {
      if (requestId !== assignRequestId.current) return;
      setError('فشل تحميل قائمة الموظفين المخصصين');
    }
    if (requestId === assignRequestId.current) setLoadingAssignees(false);
  };

  const toggleAssignedUser = (userId) => {
    setAssignedUserIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };

  const saveAssignees = async () => {
    if (!assigningAccount) return;
    setSavingAssignees(true);
    try {
      const r = await fetch(`${BASE}/email-accounts/${assigningAccount.id}/assignees`, {
        method: 'POST', headers: hdrs(),
        body: JSON.stringify({ user_ids: [...assignedUserIds] }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || 'فشل حفظ التخصيص'); setSavingAssignees(false); return; }
      setSuccess('تم حفظ الموظفين المخصصين لهذا الحساب');
      setTimeout(() => setSuccess(''), 3000);
      setAssigningAccount(null);
    } catch (e) { setError('خطأ في الاتصال: ' + (e.message || '')); }
    setSavingAssignees(false);
  };

  // Credentials (smtp_pass/imap_pass) were only ever settable when creating
  // a brand-new account -- updating a wrong or expired password (e.g. after
  // generating a new Google App Password) required deleting and recreating
  // the whole account. The backend already accepts these fields on PUT.
  const startEditAccount = (acc) => {
    setEditingAccount(acc);
    setEditForm({
      name: acc.name || '', provider: acc.provider || '',
      smtp_host: acc.smtp_host || '', smtp_port: String(acc.smtp_port || 587), smtp_user: acc.smtp_user || acc.email || '', smtp_pass: '',
      imap_host: acc.imap_host || '', imap_port: String(acc.imap_port || 993), imap_user: acc.imap_user || acc.email || '', imap_pass: '',
    });
    clearFeedback();
  };

  const saveEditedAccount = async () => {
    if (!editingAccount) return;
    setSaving(true);
    try {
      const payload = {
        name: editForm.name, provider: editForm.provider,
        smtp_host: editForm.smtp_host, smtp_port: parseInt(editForm.smtp_port) || 587, smtp_user: editForm.smtp_user,
        imap_host: editForm.imap_host, imap_port: parseInt(editForm.imap_port) || 993, imap_user: editForm.imap_user,
      };
      // Blank password fields mean "keep the existing one" -- only send them
      // if the admin actually typed a replacement.
      if (editForm.smtp_pass) payload.smtp_pass = editForm.smtp_pass;
      if (editForm.imap_pass) payload.imap_pass = editForm.imap_pass;
      const r = await fetch(`${BASE}/email-accounts/${editingAccount.id}`, { method: 'PUT', headers: hdrs(), body: JSON.stringify(payload) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || 'فشل تحديث الحساب'); setSaving(false); return; }
      setSuccess(`تم تحديث حساب ${editingAccount.email} بنجاح`);
      setTimeout(() => setSuccess(''), 3000);
      setEditingAccount(null);
      fetchAccounts();
    } catch (e) {
      setError('خطأ في الاتصال: ' + (e.message || ''));
    }
    setSaving(false);
  };

  // daily_limit was only ever settable when creating a new account -- there
  // was no way to raise (or effectively remove) it for an existing one
  // afterward short of deleting and recreating it. The backend already
  // accepts daily_limit on PUT; this was purely a missing table affordance.
  const saveDailyLimit = async (id) => {
    const value = parseInt(editingLimitValue, 10);
    if (!value || value < 1) { setEditingLimitId(null); return; }
    try {
      const r = await fetch(`${BASE}/email-accounts/${id}`, {
        method: 'PUT', headers: hdrs(),
        body: JSON.stringify({ daily_limit: value }),
      });
      // fetch() doesn't reject on a 4xx/5xx -- without this check, a denied
      // or failed update still closed the editor and re-rendered the OLD
      // value with no error at all, silently looking like it saved.
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error || 'فشل تحديث الحد اليومي'); setEditingLimitId(null); return; }
      setEditingLimitId(null);
      fetchAccounts();
    } catch { setError('فشل تحديث الحد اليومي'); }
  };

  const deleteAccount = async (id) => {
    if (!confirm('متأكد من حذف هذا الحساب؟')) return;
    clearFeedback();
    try {
      const r = await fetch(`${BASE}/email-accounts/${id}`, { method: 'DELETE', headers: hdrs() });
      if (!r.ok) { setError('فشل حذف الحساب'); return; }
      setSuccess('تم حذف الحساب بنجاح');
      setTimeout(() => setSuccess(''), 3000);
      fetchAccounts();
    } catch { setError('خطأ في الاتصال'); }
  };

  const handleFetchAll = async () => {
    setFetching(true); clearFeedback();
    try {
      // Was posting to /email/imap-poll, which is registered nowhere --
      // the real route (also used by صندوق البريد's "جلب الإيميلات" and
      // the imap-poll cron job) is /imap/poll. This button 404'd every time.
      const r = await fetch(`${BASE}/imap/poll`, { method: 'POST', headers: hdrs() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.success === false) { setError(d.error || 'فشل جلب الإيميلات'); setFetching(false); return; }
      setSuccess(`تم الجلب — ${d.newMessages || 0} رسالة جديدة`);
      setTimeout(() => setSuccess(''), 3000);
    } catch { setError('خطأ في الاتصال'); }
    setFetching(false);
  };

  // One-time enrichment for emails received before body_html existed. Runs
  // through the CURRENT browser session's real token -- IMAP passwords are
  // encrypted with a server-side key, and this can only be exercised from a
  // properly authenticated request against the real deployed backend, not
  // simulated locally.
  const handleBackfillHtml = async () => {
    setBackfilling(true); clearFeedback();
    try {
      const r = await fetch(`${BASE}/imap/backfill-html`, { method: 'POST', headers: hdrs() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.success === false) { setError(d.error || 'فشل الاسترجاع'); setBackfilling(false); return; }
      const summary = (d.results || []).map(r => r.error ? `${r.account}: ${r.error}` : `${r.account}: ${r.stillMissingBefore ?? '?'} → ${r.stillMissingAfter ?? '?'}`).join(' | ');
      setSuccess(`تم الاسترجاع — ${summary}`);
    } catch { setError('خطأ في الاتصال'); }
    setBackfilling(false);
  };

  // Same idea as handleBackfillHtml, for attachments on emails that arrived
  // BEFORE they were matched/linked to a case -- those never got uploaded to
  // Drive at the time (no case to file them under yet), only recorded by
  // name/size, so they show as "غير متاح للتحميل" even though the message
  // itself is long since linked to a case.
  const handleBackfillAttachments = async () => {
    setBackfillingAttachments(true); clearFeedback();
    try {
      const r = await fetch(`${BASE}/imap/backfill-attachments`, { method: 'POST', headers: hdrs() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.success === false) { setError(d.error || 'فشل استرجاع المرفقات'); setBackfillingAttachments(false); return; }
      const summary = (d.results || []).map(r => r.error ? `${r.account}: ${r.error}` : `${r.account}: ${r.stillMissingBefore ?? '?'} → ${r.stillMissingAfter ?? '?'}`).join(' | ');
      setSuccess(`تم استرجاع المرفقات — ${summary}`);
    } catch { setError('خطأ في الاتصال'); }
    setBackfillingAttachments(false);
  };

  const handleResetCounters = async () => {
    setResetting(true); clearFeedback();
    try {
      await api.post('/reset-counters', {});
      setSuccess('تم تصفير عدادات الإرسال اليومية');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) { setError(e.message || 'تعذر تصفير العدادات'); }
    setResetting(false);
  };

  const handleSendTest = async () => {
    if (!testEmail.account_id || !testEmail.to || !testEmail.subject) return;
    setSending(true); clearFeedback();
    try {
      const r = await fetch(`${BASE}/email/test-compose`, {
        method: 'POST', headers: hdrs(),
        body: JSON.stringify({ to: testEmail.to, subject: testEmail.subject, body: testEmail.body, account_id: parseInt(testEmail.account_id) }),
      });
      const text = await r.text();
      let d;
      try { d = JSON.parse(text); } catch { d = { error: text.substring(0, 200) }; }
      // /email/test-compose always answers HTTP 200 and signals failure via
      // {success:false} in the body (e.g. a real SMTP auth rejection) --
      // checking only r.ok meant this branch was never reachable, so a
      // failed send still showed "sent successfully" with no indication
      // anything was wrong.
      if (!r.ok || d.success === false) {
        setError(d.error || 'فشل الإرسال'); setSending(false); return;
      }
      setSuccess('تم إرسال الإيميل بنجاح');
      setTimeout(() => setSuccess(''), 3000);
      setTestEmail({ account_id: '', to: '', subject: '', body: '' });
    } catch (e) { setError('خطأ: ' + (e.message || '')); }
    setSending(false);
  };

  const applyGmailDefaults = () => {
    setForm(f => ({ ...f, ...GMAIL_DEFAULTS }));
  };

  if (loading) return <Spinner full />;

  return (
    <div className="space-y-6 animate-fadeIn" dir="rtl">
      <PageHeader eyebrow="إدارة" title="حسابات البريد" meta={`${accounts.length} حساب`}
        actions={<>
          {success && <div className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>{success}</div>}
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={handleResetCounters} disabled={resetting}>تصفير العدادات</Button>
          <Button variant="secondary" size="sm" icon={Loader2} onClick={handleFetchAll} disabled={fetching}>جلب الإيميلات</Button>
          {getCurrentUser()?.role === 'admin' && (
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={handleBackfillHtml} disabled={backfilling} title="جلب نسخة HTML كاملة للإيميلات القديمة التي وصلت قبل إضافة هذه الميزة">
              {backfilling ? 'جارٍ الاسترجاع...' : 'استرجاع HTML للإيميلات القديمة'}
            </Button>
          )}
          {getCurrentUser()?.role === 'admin' && (
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={handleBackfillAttachments} disabled={backfillingAttachments} title="استرجاع مرفقات الإيميلات القديمة (مربوطة بقضية أو لا) التي لم تُرفع من قبل">
              {backfillingAttachments ? 'جارٍ الاسترجاع...' : 'استرجاع مرفقات الإيميلات القديمة'}
            </Button>
          )}
          {canManage && <Button icon={Plus} onClick={() => { setShowForm(true); clearFeedback(); }}>إضافة حساب</Button>}
        </>} />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <AlertCircle className="w-4 h-4 shrink-0" style={{ color: '#ef4444' }} />
          <span className="text-xs" style={{ color: '#ef4444' }}>{error}</span>
          <button onClick={() => setError('')} className="mr-auto p-0.5" style={{ color: '#ef4444' }}><X className="w-3 h-3" /></button>
        </div>
      )}

      {accounts.length === 0 ? (
        <EmptyState icon={Mail} title="لا توجد حسابات بريد" description="قم بإضافة حساب بريد جديد للبدء" />
      ) : (
        <TableShell>
          <Thead>
            <Th>الحالة</Th><Th>البريد</Th><Th>الاسم</Th><Th>المزود</Th><Th>الحد / اليوم</Th><Th>أرسل اليوم</Th><Th>تاريخ الإنشاء</Th><Th align="center">الإجراءات</Th>
          </Thead>
          <tbody>
            {accounts.map((acc) => (
              <Tr key={acc.id}>
                <Td>
                  {canManage ? (
                    <button onClick={() => toggleActive(acc)}>
                      <Badge variant={acc.is_active ? 'success' : 'danger'} dot>{acc.is_active ? 'نشط' : 'غير نشط'}</Badge>
                    </button>
                  ) : (
                    <Badge variant={acc.is_active ? 'success' : 'danger'} dot>{acc.is_active ? 'نشط' : 'غير نشط'}</Badge>
                  )}
                </Td>
                <Td className="font-medium" style={{ color: 'var(--text-primary)' }}>{acc.email}</Td>
                <Td>{acc.name}</Td>
                <Td>{acc.provider || '—'}</Td>
                <Td>
                  {!canManage ? (
                    <span style={{ color: 'var(--text-primary)' }}>{acc.daily_limit ?? '—'}</span>
                  ) : editingLimitId === acc.id ? (
                    <input type="number" min="1" autoFocus value={editingLimitValue}
                      onChange={e => setEditingLimitValue(e.target.value)}
                      onBlur={() => saveDailyLimit(acc.id)}
                      onKeyDown={e => { if (e.key === 'Enter') saveDailyLimit(acc.id); if (e.key === 'Escape') setEditingLimitId(null); }}
                      className="w-20 px-1.5 py-0.5 rounded text-xs"
                      style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }} />
                  ) : (
                    <button onClick={() => { setEditingLimitId(acc.id); setEditingLimitValue(String(acc.daily_limit ?? 100)); }}
                      className="underline decoration-dashed" title="اضغط للتعديل" style={{ color: 'var(--text-primary)' }}>
                      {acc.daily_limit ?? '—'}
                    </button>
                  )}
                </Td>
                <Td>
                  <span className="font-medium" style={{ color: (acc.sent_today || 0) >= (acc.daily_limit || 100) ? 'var(--danger)' : 'var(--success)' }}>{acc.sent_today ?? 0}</span>
                </Td>
                <Td className="text-xs" style={{ color: 'var(--text-muted)' }}>{acc.created_at ? formatArabicDate(acc.created_at) : '—'}</Td>
                <Td align="center">
                  {canManage ? (
                    <div className="flex items-center justify-center gap-1">
                      {/* Assignment is deliberately admin-only server-side (email.js) --
                          'manage' alone would let a manager-level role grant ITSELF
                          access to any mailbox, defeating whatever restriction an
                          admin just set up for that same role. Gated separately from
                          canManage here to match. */}
                      {getCurrentUser()?.role === 'admin' && (
                        <button onClick={() => openAssignModal(acc)} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}
                          onMouseOver={e => e.currentTarget.style.color = 'var(--accent)'} onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}
                          title="تخصيص الموظفين المسموح لهم برؤية/استخدام هذا الحساب">
                          <Users className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => startEditAccount(acc)} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}
                        onMouseOver={e => e.currentTarget.style.color = 'var(--accent)'} onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}
                        title="تعديل الإعدادات وكلمات المرور">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => toggleActive(acc)} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}
                        onMouseOver={e => e.currentTarget.style.color = 'var(--accent)'} onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}
                        title={acc.is_active ? 'تعطيل' : 'تفعيل'}>
                        {acc.is_active ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                      </button>
                      <button onClick={() => deleteAccount(acc.id)} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}
                        onMouseOver={e => e.currentTarget.style.color = 'var(--danger)'} onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ) : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      )}

      {/* Add Account Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fadeIn" style={{ background: 'var(--bg-overlay)' }} onClick={() => !saving && setShowForm(false)}>
          <div className="w-full max-w-2xl rounded-2xl border p-6 animate-scaleIn max-h-[85vh] overflow-y-auto"
            style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>إضافة حساب بريد جديد</h3>
              <button onClick={() => !saving && setShowForm(false)} className="p-1 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
            </div>

            {/* Gmail Quick Fill */}
            <button onClick={applyGmailDefaults} className="text-[10px] px-2.5 py-1 rounded-lg mb-3 transition-colors"
              style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px dashed rgba(59,130,246,0.3)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(59,130,246,0.1)'}>
              <Mail className="w-3 h-3 inline" /> تعبئة إعدادات Gmail تلقائياً
            </button>

            <div className="grid grid-cols-2 gap-3">
              <Input containerClassName="col-span-2" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="اسم الحساب" />
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="البريد الإلكتروني" />
              <Input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="المزود (مثل Gmail, Outlook)" />
              <Input value={form.daily_limit} onChange={(e) => setForm({ ...form, daily_limit: e.target.value })} placeholder="الحد اليومي" type="number" />

              <h4 className="col-span-2 text-xs font-semibold mt-2" style={{ color: 'var(--text-muted)' }}>إعدادات SMTP (إرسال)</h4>
              <Input value={form.smtp_host} onChange={(e) => setForm({ ...form, smtp_host: e.target.value })} placeholder="SMTP Host" />
              <Input value={form.smtp_port} onChange={(e) => setForm({ ...form, smtp_port: e.target.value })} placeholder="SMTP Port" type="number" />
              <Input value={form.smtp_user} onChange={(e) => setForm({ ...form, smtp_user: e.target.value })} placeholder="SMTP User" />
              <Input value={form.smtp_pass} onChange={(e) => setForm({ ...form, smtp_pass: e.target.value })} placeholder="SMTP Password" type="password" />

              <h4 className="col-span-2 text-xs font-semibold mt-2" style={{ color: 'var(--text-muted)' }}>إعدادات IMAP (استقبال)</h4>
              <Input value={form.imap_host} onChange={(e) => setForm({ ...form, imap_host: e.target.value })} placeholder="IMAP Host" />
              <Input value={form.imap_port} onChange={(e) => setForm({ ...form, imap_port: e.target.value })} placeholder="IMAP Port" type="number" />
              <Input value={form.imap_user} onChange={(e) => setForm({ ...form, imap_user: e.target.value })} placeholder="IMAP User" />
              <Input value={form.imap_pass} onChange={(e) => setForm({ ...form, imap_pass: e.target.value })} placeholder="IMAP Password" type="password" />
            </div>

            {/* Inline error in form */}
            {error && showForm && (
              <div className="flex items-center gap-1 mt-3 p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)' }}>
                <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: '#ef4444' }} />
                <span className="text-[11px]" style={{ color: '#ef4444' }}>{error}</span>
              </div>
            )}

            <div className="flex gap-2 justify-end mt-4">
              <Button variant="secondary" onClick={() => setShowForm(false)} disabled={saving}>إلغاء</Button>
              <Button onClick={createAccount} disabled={saving}>
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" />جارٍ الحفظ...</> : 'إضافة'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Account Modal -- host/port/user/provider + optional password replacement */}
      {editingAccount && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fadeIn" style={{ background: 'var(--bg-overlay)' }} onClick={() => !saving && setEditingAccount(null)}>
          <div className="w-full max-w-2xl rounded-2xl border p-6 animate-scaleIn max-h-[85vh] overflow-y-auto"
            style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>تعديل حساب: {editingAccount.email}</h3>
              <button onClick={() => !saving && setEditingAccount(null)} className="p-1 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input containerClassName="col-span-2" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="اسم الحساب" />
              <Input containerClassName="col-span-2" value={editForm.provider} onChange={(e) => setEditForm({ ...editForm, provider: e.target.value })} placeholder="المزود (مثل Gmail, Outlook)" />

              <h4 className="col-span-2 text-xs font-semibold mt-2" style={{ color: 'var(--text-muted)' }}>إعدادات SMTP (إرسال)</h4>
              <Input value={editForm.smtp_host} onChange={(e) => setEditForm({ ...editForm, smtp_host: e.target.value })} placeholder="SMTP Host" />
              <Input value={editForm.smtp_port} onChange={(e) => setEditForm({ ...editForm, smtp_port: e.target.value })} placeholder="SMTP Port" type="number" />
              <Input value={editForm.smtp_user} onChange={(e) => setEditForm({ ...editForm, smtp_user: e.target.value })} placeholder="SMTP User" />
              <Input value={editForm.smtp_pass} onChange={(e) => setEditForm({ ...editForm, smtp_pass: e.target.value })} placeholder="SMTP Password (اتركه فارغًا لعدم التغيير)" type="password" />

              <h4 className="col-span-2 text-xs font-semibold mt-2" style={{ color: 'var(--text-muted)' }}>إعدادات IMAP (استقبال)</h4>
              <Input value={editForm.imap_host} onChange={(e) => setEditForm({ ...editForm, imap_host: e.target.value })} placeholder="IMAP Host" />
              <Input value={editForm.imap_port} onChange={(e) => setEditForm({ ...editForm, imap_port: e.target.value })} placeholder="IMAP Port" type="number" />
              <Input value={editForm.imap_user} onChange={(e) => setEditForm({ ...editForm, imap_user: e.target.value })} placeholder="IMAP User" />
              <Input value={editForm.imap_pass} onChange={(e) => setEditForm({ ...editForm, imap_pass: e.target.value })} placeholder="IMAP Password (اتركه فارغًا لعدم التغيير)" type="password" />
            </div>

            {error && editingAccount && (
              <div className="flex items-center gap-1 mt-3 p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)' }}>
                <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: '#ef4444' }} />
                <span className="text-[11px]" style={{ color: '#ef4444' }}>{error}</span>
              </div>
            )}

            <div className="flex gap-2 justify-end mt-4">
              <Button variant="secondary" onClick={() => setEditingAccount(null)} disabled={saving}>إلغاء</Button>
              <Button onClick={saveEditedAccount} disabled={saving}>
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" />جارٍ الحفظ...</> : 'حفظ التعديلات'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Employees Modal -- who may see/use this specific mailbox.
          Doesn't gate anything on its own: a role must ALSO have
          email_accounts.view_all=false (set from فريق العمل → الصلاحيات) for
          this list to actually restrict anyone -- until then every account
          stays visible to everyone exactly as before, same opt-in convention
          as the cases.view_all restriction. */}
      {assigningAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fadeIn" style={{ background: 'var(--bg-overlay)' }} onClick={() => !savingAssignees && setAssigningAccount(null)}>
          <div className="w-full max-w-md rounded-2xl border p-6 animate-scaleIn max-h-[85vh] overflow-y-auto"
            style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>الموظفون المخصصون: {assigningAccount.email}</h3>
              <button onClick={() => !savingAssignees && setAssigningAccount(null)} className="p-1 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
            </div>
            <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
              يسري هذا فقط على الأدوار التي تم تقييدها من "فريق العمل ← الصلاحيات ← حسابات البريد ← view_all". أي دور آخر يرى كل الحسابات كالمعتاد.
            </p>
            {loadingAssignees ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-muted)' }} /></div>
            ) : (
              <div className="space-y-1.5">
                {allUsers.map(u => (
                  <label key={u.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors"
                    style={{ background: assignedUserIds.has(u.id) ? 'var(--bg-tertiary)' : 'transparent' }}>
                    <input type="checkbox" checked={assignedUserIds.has(u.id)} onChange={() => toggleAssignedUser(u.id)} />
                    <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{u.name}</span>
                    <span className="text-[10px] mr-auto" style={{ color: 'var(--text-muted)' }}>{u.email}</span>
                  </label>
                ))}
                {allUsers.length === 0 && <div className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>لا يوجد موظفون</div>}
              </div>
            )}
            <div className="flex gap-2 justify-end mt-4">
              <Button variant="secondary" onClick={() => setAssigningAccount(null)} disabled={savingAssignees}>إلغاء</Button>
              <Button onClick={saveAssignees} disabled={savingAssignees || loadingAssignees}>
                {savingAssignees ? <><Loader2 className="w-4 h-4 animate-spin" />جارٍ الحفظ...</> : 'حفظ'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Test Email Section */}
      <Card title="إرسال بريد تجريبي" icon={<Send className="w-4 h-4" style={{ color: 'var(--accent)' }} />}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Select value={testEmail.account_id} onChange={(e) => setTestEmail({ ...testEmail, account_id: e.target.value })}>
            <option value="">اختر الحساب</option>
            {accounts.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.email} ({a.name})</option>)}
          </Select>
          <Input value={testEmail.to} onChange={(e) => setTestEmail({ ...testEmail, to: e.target.value })} placeholder="إلى (البريد المستهدف)" />
          <Input value={testEmail.subject} onChange={(e) => setTestEmail({ ...testEmail, subject: e.target.value })} placeholder="الموضوع" />
        </div>
        <textarea value={testEmail.body} onChange={(e) => setTestEmail({ ...testEmail, body: e.target.value })} placeholder="نص الرسالة" rows={3}
          className="w-full mt-3 px-3.5 py-2.5 rounded-xl border text-sm resize-none outline-none" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }} />
        <div className="flex justify-end mt-3">
          <Button icon={Send} onClick={handleSendTest} disabled={sending || !testEmail.account_id || !testEmail.to || !testEmail.subject}>
            {sending ? 'جارٍ الإرسال...' : 'إرسال'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
