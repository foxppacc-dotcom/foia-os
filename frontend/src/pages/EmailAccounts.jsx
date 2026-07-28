import { useState, useEffect } from 'react';
import { api, getApiBase } from '../api';
import { Mail, Plus, Trash2, RefreshCw, Send, Power, PowerOff, Loader2, X, CheckCircle, AlertCircle } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import { TableShell, Thead, Th, Td, Tr } from '../components/ui/Table';

const GMAIL_DEFAULTS = {
  smtp_host: 'smtp.gmail.com', smtp_port: '587', imap_host: 'imap.gmail.com', imap_port: '993',
};

export default function EmailAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [fetching, setFetching] = useState(false);
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

  const fetchAccounts = async () => {
    try {
      const r = await fetch(`${BASE}/email-accounts`, { headers: hdrs() });
      const d = await r.json();
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
      await fetch(`${BASE}/email-accounts/${account.id}`, {
        method: 'PUT', headers: hdrs(),
        body: JSON.stringify({ is_active: !account.is_active }),
      });
      fetchAccounts();
    } catch { setError('فشل تغيير حالة الحساب'); }
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
      const r = await fetch(`${BASE}/email/imap-poll`, { method: 'POST', headers: hdrs() });
      if (!r.ok) { setError('فشل جلب الإيميلات'); }
    } catch { setError('خطأ في الاتصال'); }
    setFetching(false);
  };

  const handleResetCounters = async () => {
    setResetting(true);
    try { await api.post('/reset-counters', {}); } catch {}
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
      if (!r.ok) {
        const text = await r.text();
        let d;
        try { d = JSON.parse(text); } catch { d = { error: text.substring(0, 200) }; }
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
          <Button icon={Plus} onClick={() => { setShowForm(true); clearFeedback(); }}>إضافة حساب</Button>
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
                  <button onClick={() => toggleActive(acc)}>
                    <Badge variant={acc.is_active ? 'success' : 'danger'} dot>{acc.is_active ? 'نشط' : 'غير نشط'}</Badge>
                  </button>
                </Td>
                <Td className="font-medium" style={{ color: 'var(--text-primary)' }}>{acc.email}</Td>
                <Td>{acc.name}</Td>
                <Td>{acc.provider || '—'}</Td>
                <Td>{acc.daily_limit ?? '—'}</Td>
                <Td>
                  <span className="font-medium" style={{ color: (acc.sent_today || 0) >= (acc.daily_limit || 100) ? 'var(--danger)' : 'var(--success)' }}>{acc.sent_today ?? 0}</span>
                </Td>
                <Td className="text-xs" style={{ color: 'var(--text-muted)' }}>{acc.created_at ? new Date(acc.created_at).toLocaleDateString('ar-SA') : '—'}</Td>
                <Td align="center">
                  <div className="flex items-center justify-center gap-1">
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
