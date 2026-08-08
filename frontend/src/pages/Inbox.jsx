import { useState, useEffect } from 'react';
import { api, getApiBase } from '../api';
import { Mail, Search, Inbox, Archive, Link2, Eye, ChevronDown, RefreshCw, Loader2, ExternalLink, Trash2, Send, X, Paperclip } from 'lucide-react';
import AppSection from '../components/ds/AppSection';
import AppButton from '../components/ds/AppButton';
import AppBadge from '../components/ds/AppBadge';
import AppEmptyState from '../components/ds/AppEmptyState';

const BASE = getApiBase();
const tok = () => localStorage.getItem('foia_token');
const hdrs = () => ({ 'Authorization': `Bearer ${tok()}`, 'Content-Type': 'application/json' });

// Native <input type="date"> renders its numerals/segment order from the
// BROWSER'S OWN locale, not the page's dir/lang attributes -- Chrome in
// particular keeps showing Arabic-Indic digits and a reversed-looking
// order regardless of dir="ltr"/lang="en-GB" on the element itself. Three
// plain, always-English-digit day/month/year fields sidestep that
// entirely instead of fighting the native widget's locale rendering.
function DateField({ value, onChange }) {
  // Local buffer, not derived straight from `value` on every render: if the
  // three segments were parsed from the committed value alone, clearing
  // just the day (leaving month/year filled) would never form a complete
  // date, onChange would never fire, the parent's value would stay
  // unchanged, and the controlled input would immediately snap the
  // just-cleared digit back on re-render. Local state lets a segment sit
  // empty mid-edit; only sync FROM the parent when it changes externally
  // (e.g. the "مسح" clear button), not on every keystroke.
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  useEffect(() => {
    const [y, m, d] = value ? value.split('-') : ['', '', ''];
    setYear(y || ''); setMonth(m || ''); setDay(d || '');
  }, [value]);

  const commit = (d, m, y) => {
    if (d.length === 2 && m.length === 2 && y.length === 4) {
      // Length-only checks let e.g. day=99 or month=13 through to the
      // backend as a query param -- Postgres rejects the resulting date
      // string, but the frontend never surfaced that (see fetchInbox),
      // so it looked exactly like "no messages in range."
      const dn = parseInt(d, 10), mn = parseInt(m, 10);
      if (dn >= 1 && dn <= 31 && mn >= 1 && mn <= 12) onChange(`${y}-${m}-${d}`);
    } else if (!d && !m && !y) onChange('');
  };
  const numeric = (v) => v.replace(/[^0-9]/g, '');

  return (
    <div className="flex items-center gap-0.5" dir="ltr">
      <input type="text" inputMode="numeric" placeholder="DD" maxLength={2} value={day}
        onChange={e => { const v = numeric(e.target.value); setDay(v); commit(v, month, year); }}
        className="w-8 px-1 py-1 rounded text-[11px] text-center"
        style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
      <span className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>/</span>
      <input type="text" inputMode="numeric" placeholder="MM" maxLength={2} value={month}
        onChange={e => { const v = numeric(e.target.value); setMonth(v); commit(day, v, year); }}
        className="w-8 px-1 py-1 rounded text-[11px] text-center"
        style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
      <span className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>/</span>
      <input type="text" inputMode="numeric" placeholder="YYYY" maxLength={4} value={year}
        onChange={e => { const v = numeric(e.target.value); setYear(v); commit(day, month, v); }}
        className="w-12 px-1 py-1 rounded text-[11px] text-center"
        style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
    </div>
  );
}

export default function InboxPage() {
  const [messages, setMessages] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [status, setStatus] = useState('all');
  const [direction, setDirection] = useState('all');
  const [accountId, setAccountId] = useState('all');
  const [accounts, setAccounts] = useState([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [polling, setPolling] = useState(false);
  const [unread, setUnread] = useState(0);
  const [showComposer, setShowComposer] = useState(false);
  const [composeForm, setComposeForm] = useState({ account_id: '', to: '', cc: '', subject: '', body: '' });
  const [composeFiles, setComposeFiles] = useState([]);
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState('');
  const [sendSuccess, setSendSuccess] = useState('');

  const closeComposer = () => {
    setShowComposer(false);
    setComposeForm({ account_id: '', to: '', cc: '', subject: '', body: '' });
    setComposeFiles([]);
    setComposeError('');
  };

  const fetchInbox = async () => {
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (status !== 'all') params.set('status', status);
      if (direction !== 'all') params.set('direction', direction);
      if (accountId !== 'all') params.set('account_id', accountId);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (search) params.set('search', search);
      const r = await fetch(`${BASE}/inbox?${params}`, { headers: hdrs() });
      const d = await r.json().catch(() => ({}));
      // A 500 (e.g. an invalid date range Postgres rejects) still resolves
      // here with d.data undefined -- rendering as an empty list, identical
      // to "genuinely no messages in range" with zero indication the query
      // itself never ran.
      if (!r.ok) { setFetchError(d.error || 'فشل تحميل الرسائل'); setMessages([]); setTotal(0); setLoading(false); return; }
      setFetchError('');
      setMessages(d.data || []);
      setTotal(d.total || 0);
    } catch (e) { setFetchError('خطأ في الاتصال'); console.error('Inbox fetch error:', e); }
    setLoading(false);
  };

  const fetchAccounts = async () => {
    try {
      const r = await fetch(`${BASE}/email-accounts`, { headers: hdrs() });
      const d = await r.json();
      setAccounts(d.data || []);
    } catch {}
  };

  const fetchUnread = async () => {
    try {
      const r = await fetch(`${BASE}/inbox/unread-count`, { headers: hdrs() });
      const d = await r.json();
      setUnread(d.unread || 0);
    } catch {}
  };

  useEffect(() => { fetchInbox(); }, [status, direction, accountId, dateFrom, dateTo, search]);
  useEffect(() => { fetchUnread(); fetchAccounts(); }, []);

  const handlePoll = async () => {
    setPolling(true);
    try {
      const r = await fetch(`${BASE}/imap/poll`, { method: 'POST', headers: hdrs(), body: '{}' });
      const d = await r.json();
      if (d.newMessages > 0) fetchInbox();
      fetchUnread();
    } catch {}
    setPolling(false);
  };

  const handleLink = async (id, caseId, agencyId) => {
    await fetch(`${BASE}/inbox/${id}/link`, { method: 'PUT', headers: hdrs(), body: JSON.stringify({ case_id: caseId, agency_id: agencyId }) });
    fetchInbox();
  };

  // Expanding a message previously called nothing at all -- it stayed
  // counted as "unread" forever unless separately linked or archived, which
  // is part of why the unread badge looked wrong.
  const handleOpen = (msg) => {
    setSelected(selected === msg.id ? null : msg.id);
    if (msg.is_read === false) {
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, is_read: true } : m));
      setUnread(prev => Math.max(0, prev - 1));
      // fetch() resolves for ANY http status, including 4xx/5xx -- only
      // .catch() here meant a server-side rejection still left the UI
      // showing "read" with the badge decremented, out of sync with the
      // real row until the next full refetch silently flipped it back.
      fetch(`${BASE}/inbox/${msg.id}/read`, { method: 'PUT', headers: hdrs() }).then(r => {
        if (!r.ok) { setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, is_read: false } : m)); setUnread(prev => prev + 1); }
      }).catch(() => {
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, is_read: false } : m));
        setUnread(prev => prev + 1);
      });
    }
  };

  // Sending a fresh, case-unrelated email previously had nowhere to go --
  // compose only existed inside a case's الاتصالات tab (POST /cases/:id/compose,
  // hard-requires a case). This uses the new /inbox/compose route instead.
  const sendCompose = async () => {
    if (!composeForm.account_id || !composeForm.to || !composeForm.subject) return;
    setComposing(true); setComposeError('');
    try {
      const fd = new FormData();
      Object.entries(composeForm).forEach(([k, v]) => fd.append(k, v));
      composeFiles.forEach(f => fd.append('attachments', f));
      const r = await fetch(`${BASE}/inbox/compose`, {
        method: 'POST', headers: { Authorization: `Bearer ${tok()}` },
        body: fd,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.success === false) { setComposeError(d.error || 'فشل الإرسال'); setComposing(false); return; }
      closeComposer();
      setSendSuccess('تم إرسال الرسالة بنجاح ✓');
      setTimeout(() => setSendSuccess(''), 4000);
      fetchInbox();
    } catch (e) { setComposeError('خطأ: ' + (e.message || '')); }
    setComposing(false);
  };

  const handleArchive = async (id) => {
    await fetch(`${BASE}/inbox/${id}/archive`, { method: 'PUT', headers: hdrs() });
    fetchInbox();
  };

  const handleDelete = async (id) => {
    if (!confirm('حذف هذه الرسالة نهائيًا؟')) return;
    await fetch(`${BASE}/communications/${id}`, { method: 'DELETE', headers: hdrs() });
    fetchInbox();
    fetchUnread();
  };

  const statusCounts = [
    { key: 'all', label: `الكل (${total})`, color: 'var(--ds-text-primary)' },
    { key: 'unread', label: `غير مقروء (${unread})`, color: '#3b82f6' },
    { key: 'unlinked', label: 'غير مرتبط', color: '#eab308' },
    { key: 'linked', label: 'مرتبط', color: '#22c55e' },
  ];

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      {sendSuccess && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium" style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}>
          {sendSuccess}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Inbox className="w-5 h-5" style={{ color: 'var(--ds-accent)' }} />
          <h1 className="text-lg font-semibold" style={{ color: 'var(--ds-text-primary)' }}>صندوق البريد</h1>
        </div>
        <div className="flex items-center gap-2">
          <AppButton size="sm" variant="secondary" icon={<Send className="w-3.5 h-3.5" />} onClick={() => { setShowComposer(true); setComposeError(''); }}>
            رسالة جديدة
          </AppButton>
          <AppButton size="sm" icon={polling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} onClick={handlePoll} disabled={polling}>
            {polling ? 'جاري الجلب...' : 'جلب الإيميلات'}
          </AppButton>
        </div>
      </div>

      {/* Standalone composer -- not tied to any case */}
      {showComposer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => !composing && closeComposer()}>
          <div className="w-full max-w-lg rounded-2xl p-5 max-h-[85vh] overflow-y-auto"
            style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>رسالة جديدة</h3>
              <button onClick={closeComposer} style={{ color: 'var(--ds-text-muted)' }}><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-2">
              <select value={composeForm.account_id} onChange={e => setComposeForm({ ...composeForm, account_id: e.target.value })}
                className="w-full px-2 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}>
                <option value="">اختر الحساب المرسل منه</option>
                {accounts.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.email} ({a.name})</option>)}
              </select>
              <input value={composeForm.to} onChange={e => setComposeForm({ ...composeForm, to: e.target.value })} placeholder="إلى..."
                className="w-full px-2 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
              <input value={composeForm.cc} onChange={e => setComposeForm({ ...composeForm, cc: e.target.value })} placeholder="CC (اختياري)"
                className="w-full px-2 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
              <input value={composeForm.subject} onChange={e => setComposeForm({ ...composeForm, subject: e.target.value })} placeholder="الموضوع"
                className="w-full px-2 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
              <textarea value={composeForm.body} onChange={e => setComposeForm({ ...composeForm, body: e.target.value })} placeholder="نص الرسالة..." rows={6}
                className="w-full px-2 py-1.5 rounded-lg text-xs resize-none" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />

              {composeFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {composeFiles.map((f, i) => (
                    <span key={i} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-secondary)' }}>
                      {f.name}
                      <button onClick={() => setComposeFiles(composeFiles.filter((_, fi) => fi !== i))} style={{ color: 'var(--ds-text-muted)' }}><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1 text-[11px] cursor-pointer" style={{ color: 'var(--ds-accent)' }}>
                  <Paperclip className="w-3.5 h-3.5" />مرفقات
                  <input type="file" multiple hidden onChange={e => setComposeFiles([...composeFiles, ...Array.from(e.target.files || [])])} />
                </label>
              </div>

              {composeError && <div className="text-[11px] p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{composeError}</div>}
              <div className="flex justify-end gap-2 pt-1">
                <AppButton size="sm" variant="secondary" onClick={closeComposer} disabled={composing}>إلغاء</AppButton>
                <AppButton size="sm" onClick={sendCompose} disabled={composing || !composeForm.account_id || !composeForm.to || !composeForm.subject}>
                  {composing ? 'جارٍ الإرسال...' : 'إرسال'}
                </AppButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Status tabs + direction/account filters, all in one row */}
      <div className="flex gap-1.5 flex-wrap items-center">
        {statusCounts.map(s => (
          <button key={s.key} onClick={() => setStatus(s.key)}
            className="px-3 py-1.5 text-xs rounded-lg ds-transition-colors"
            style={{ background: status === s.key ? 'var(--ds-bg-tertiary)' : 'transparent', color: s.color, border: status === s.key ? '1px solid var(--ds-border)' : '1px solid transparent' }}>
            {s.label}
          </button>
        ))}
        <div className="w-px h-5 mx-0.5" style={{ background: 'var(--ds-border)' }} />
        {[
          { key: 'all', label: 'كل الاتجاهات' },
          { key: 'inbound', label: 'وارد' },
          { key: 'outbound', label: 'صادر' },
        ].map(d => (
          <button key={d.key} onClick={() => setDirection(d.key)}
            className="px-2.5 py-1 text-[11px] rounded-lg ds-transition-colors"
            style={{ background: direction === d.key ? 'var(--ds-accent)' : 'var(--ds-bg-tertiary)', color: direction === d.key ? 'white' : 'var(--ds-text-muted)' }}>
            {d.label}
          </button>
        ))}
        {accounts.length > 0 && (
          <select value={accountId} onChange={e => setAccountId(e.target.value)}
            className="text-[11px] px-2 py-1 rounded-lg"
            style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}>
            <option value="all">كل الإيميلات المرتبطة</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
          </select>
        )}
        <div className="w-px h-5 mx-0.5" style={{ background: 'var(--ds-border)' }} />
        <div className="flex items-center gap-1.5 text-[11px] shrink-0" style={{ color: 'var(--ds-text-muted)' }}>
          <span>من</span>
          <DateField value={dateFrom} onChange={setDateFrom} />
          <span>إلى</span>
          <DateField value={dateTo} onChange={setDateTo} />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-[11px] underline shrink-0" style={{ color: 'var(--ds-accent)' }}>
              مسح
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ds-text-muted)' }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث في البريد..."
          className="w-full text-xs p-2 pl-8 rounded-lg ds-transition-colors"
          style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--ds-accent)' }} /></div>
      ) : fetchError ? (
        <AppEmptyState icon={Mail} title="تعذر تحميل الرسائل" description={fetchError} />
      ) : messages.length === 0 ? (
        <AppEmptyState icon={Mail} title="لا توجد رسائل" description="اضغط على 'جلب الإيميلات' لاستقبال الرسائل" />
      ) : (
        <div className="space-y-1">
          {messages.map(msg => (
            <div key={msg.id} onClick={() => handleOpen(msg)}
              className="p-3 rounded-lg cursor-pointer ds-transition-colors"
              style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', borderRight: msg.case_id ? '3px solid #22c55e' : '3px solid #eab308' }}>
              <div className="flex items-start gap-2">
                <Mail className="w-4 h-4 shrink-0 mt-0.5" style={{ color: msg.is_read === false ? '#3b82f6' : 'var(--ds-text-muted)' }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold" style={{ color: 'var(--ds-text-primary)' }}>{msg.sender || 'مجهول'}</span>
                    <AppBadge variant={msg.direction === 'inbound' ? 'info' : 'success'} size="xs">{msg.direction === 'inbound' ? 'وارد' : 'صادر'}</AppBadge>
                    {msg.case_id && <AppBadge variant="success" size="xs">مرتبط (#{msg.case_id})</AppBadge>}
                  </div>
                  <div className="text-xs font-medium mb-0.5" style={{ color: 'var(--ds-text-primary)' }}>{msg.subject}</div>
                  <div className="text-[10px] flex items-center gap-2" style={{ color: 'var(--ds-text-muted)' }}>
                    <span>إلى: {msg.recipient}</span>
                    <span>{msg.created_at ? `${new Date(msg.created_at).toLocaleDateString('ar-SA')} ${new Date(msg.created_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
                    {msg.metadata?.attachments?.length > 0 && <span>📎 {msg.metadata.attachments.length}</span>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={e => { e.stopPropagation(); window.open(`/inbox/message/${msg.id}`, '_blank', 'noopener,noreferrer'); }}
                    className="p-1 rounded" title="فتح في تاب جديد (للمراجعة/النسخ/الرد)" style={{ color: 'var(--ds-text-muted)' }}>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                  {!msg.case_id && (
                    <button onClick={e => { e.stopPropagation(); const cid = prompt('رقم التحقيق:'); if(cid) handleLink(msg.id, parseInt(cid), null); }}
                      className="p-1 rounded" title="ربط بتحقيق" style={{ color: 'var(--ds-text-muted)' }}>
                      <Link2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={e => { e.stopPropagation(); handleArchive(msg.id); }}
                    className="p-1 rounded" title="أرشفة" style={{ color: 'var(--ds-text-muted)' }}>
                    <Archive className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={e => { e.stopPropagation(); handleDelete(msg.id); }}
                    className="p-1 rounded" title="حذف" style={{ color: '#ef4444' }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Expanded message */}
              {selected === msg.id && (
                <div className="mt-2 p-2 rounded text-xs leading-relaxed whitespace-pre-wrap"
                  style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-secondary)', fontFamily: 'monospace' }}>
                  {msg.body || '(لا يوجد محتوى)'}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
