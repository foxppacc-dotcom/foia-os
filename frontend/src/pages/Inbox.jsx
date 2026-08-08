import { useState, useEffect } from 'react';
import { api, getApiBase } from '../api';
import { Mail, Search, Inbox, Archive, Link2, Eye, ChevronDown, RefreshCw, Loader2, ExternalLink, Trash2 } from 'lucide-react';
import AppSection from '../components/ds/AppSection';
import AppButton from '../components/ds/AppButton';
import AppBadge from '../components/ds/AppBadge';
import AppEmptyState from '../components/ds/AppEmptyState';

const BASE = getApiBase();
const tok = () => localStorage.getItem('foia_token');
const hdrs = () => ({ 'Authorization': `Bearer ${tok()}`, 'Content-Type': 'application/json' });

export default function InboxPage() {
  const [messages, setMessages] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [direction, setDirection] = useState('all');
  const [accountId, setAccountId] = useState('all');
  const [accounts, setAccounts] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [polling, setPolling] = useState(false);
  const [unread, setUnread] = useState(0);

  const fetchInbox = async () => {
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (status !== 'all') params.set('status', status);
      if (direction !== 'all') params.set('direction', direction);
      if (accountId !== 'all') params.set('account_id', accountId);
      if (search) params.set('search', search);
      const r = await fetch(`${BASE}/inbox?${params}`, { headers: hdrs() });
      const d = await r.json();
      setMessages(d.data || []);
      setTotal(d.total || 0);
    } catch (e) { console.error('Inbox fetch error:', e); }
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

  useEffect(() => { fetchInbox(); }, [status, direction, accountId, search]);
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
      fetch(`${BASE}/inbox/${msg.id}/read`, { method: 'PUT', headers: hdrs() }).catch(() => {});
    }
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Inbox className="w-5 h-5" style={{ color: 'var(--ds-accent)' }} />
          <h1 className="text-lg font-semibold" style={{ color: 'var(--ds-text-primary)' }}>صندوق الوارد</h1>
        </div>
        <AppButton size="sm" icon={polling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} onClick={handlePoll} disabled={polling}>
          {polling ? 'جاري الجلب...' : 'جلب الإيميلات'}
        </AppButton>
      </div>

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
