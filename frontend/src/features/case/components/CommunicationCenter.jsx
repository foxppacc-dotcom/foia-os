import { getApiBase } from '../../../api';
import { useState, useEffect, useMemo } from 'react';
import { Send, Reply, Forward, Paperclip, Search, Clock, AlertCircle, Inbox, FileText, Building2, User, Mail, Tag, ChevronDown, ExternalLink } from 'lucide-react';
import Button from '../../../components/ui/Button';

const API = getApiBase();
const tok = () => localStorage.getItem('foia_token');
const hdrs = () => ({ 'Authorization': `Bearer ${tok()}`, 'Content-Type': 'application/json' });

const ACCOUNT_SLA_RULES_KEY = 'foia_last_account_filter';

function EmailComposer({ caseId, onClose, accounts, agencies, replyTo, onSent }) {
  const [to, setTo] = useState(replyTo?.sender || '');
  const [agencyId, setAgencyId] = useState(replyTo?.agency_id || '');
  const [accountId, setAccountId] = useState(replyTo?.email_account_id || replyTo?.assigned_email_account_id || accounts?.[0]?.id || '');
  const [subject, setSubject] = useState(replyTo ? `Re: ${replyTo.subject}` : '');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!to || !subject || !body) return;
    setSending(true);
    try {
      const r = await fetch(`${API}/cases/${caseId}/compose`, { method: 'POST', headers: hdrs(),
        body: JSON.stringify({ to, subject, body, account_id: accountId || null, agency_id: agencyId || null, request_id: replyTo?.request_id }) });
      const d = await r.json();
      if (d.success) { onSent?.(d); onClose?.(); }
    } catch(e) { console.error(e); }
    setSending(false);
  };

  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>رسالة جديدة</span>
        <button onClick={onClose} style={{ color: 'var(--ds-text-muted)' }}>✕</button>
      </div>
      <div className="space-y-2">
        {/* Agency + Account */}
        <div className="flex gap-2">
          <select className="flex-1 px-2 py-1.5 rounded text-xs" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
            value={agencyId} onChange={e => setAgencyId(e.target.value)}>
            <option value="">اختر الجهة</option>
            {(agencies || []).map(a => <option key={a.id} value={a.id}>{a.name_en || a.name || a.name_ar || ''}</option>)}
          </select>
          <select className="flex-1 px-2 py-1.5 rounded text-xs" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
            value={accountId} onChange={e => setAccountId(e.target.value)}>
            <option value="">اختر حساب البريد</option>
            {(accounts || []).map(a => <option key={a.id} value={a.id}>{a.display_name || a.email}</option>)}
          </select>
        </div>
        <input className="w-full px-2 py-1.5 rounded text-xs" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
          placeholder="إلى..." value={to} onChange={e => setTo(e.target.value)} />
        <input className="w-full px-2 py-1.5 rounded text-xs" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
          placeholder="الموضوع..." value={subject} onChange={e => setSubject(e.target.value)} />
        <textarea className="w-full px-2 py-1.5 rounded text-xs min-h-[100px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
          placeholder="محتوى الرسالة..." value={body} onChange={e => setBody(e.target.value)} />
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm"><Paperclip className="w-3 h-3" />مرفقات</Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>حفظ كمسودة</Button>
            <Button variant="primary" size="sm" onClick={send} disabled={sending}>
              {sending ? 'جاري الإرسال...' : <><Send className="w-3 h-3" />إرسال</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThreadCard({ thread, accounts, onReply }) {
  const acct = (accounts || []).find(a => a.id === thread.email_account_id);
  const daysWaiting = thread.created_at ? Math.floor((Date.now() - new Date(thread.created_at)) / (1000*60*60*24)) : 0;

  return (
    <div className="rounded-lg p-3 ds-transition-colors cursor-pointer" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', borderRight: thread.direction === 'inbound' ? '3px solid #22c55e' : '3px solid #3b82f6' }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--ds-bg-tertiary)'}
      onMouseLeave={e => e.currentTarget.style.background = 'var(--ds-bg-secondary)'}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Mail className="w-3.5 h-3.5 shrink-0" style={{ color: thread.direction === 'inbound' ? '#22c55e' : '#3b82f6' }} />
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--ds-text-primary)' }}>{thread.subject}</span>
            {thread.direction === 'inbound' && <span className="text-[9px] px-1 rounded bg-green-100 text-green-600">وارد</span>}
          </div>
          <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>
            <span className="flex items-center gap-1"><User className="w-3 h-3" />{thread.sender}</span>
            <span>→</span>
            <span className="flex items-center gap-1">{thread.recipient}</span>
            {acct && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{acct.email}</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px]" style={{ color: daysWaiting > 14 ? '#ef4444' : daysWaiting > 7 ? '#eab308' : 'var(--ds-text-muted)' }}>{daysWaiting} يوم</div>
          <div className="text-[9px]" style={{ color: 'var(--ds-text-muted)' }}>{new Date(thread.created_at).toLocaleDateString('ar-SA')}</div>
        </div>
      </div>

      {/* Thread body preview */}
      <div className="text-[11px] mt-1 line-clamp-2" style={{ color: 'var(--ds-text-secondary)' }}>{thread.body?.substring(0, 150)}</div>

      {/* Quick actions */}
      <div className="flex items-center gap-1.5 mt-2">
        <button onClick={() => onReply(thread)} className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded" style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>
          <Reply className="w-3 h-3" />رد
        </button>
        <button className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-muted)' }}>
          <Forward className="w-3 h-3" />إعادة توجيه
        </button>
        {thread.agency_name && (
          <span className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded" style={{ background: 'rgba(234,179,8,0.1)', color: '#eab308' }}>
            <Building2 className="w-3 h-3" />{thread.agency_name}
          </span>
        )}
      </div>
    </div>
  );
}

export default function CommunicationCenter({ caseId }) {
  const [threads, setThreads] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [agencies, setAgencies] = useState([]);
  const [showComposer, setShowComposer] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('date');

  useEffect(() => {
    if (!caseId) return;
    fetch(`${API}/cases/${caseId}/threads`, { headers: hdrs() }).then(r => r.json()).then(d => setThreads(d.threads || []));
    fetch(`${API}/email-accounts`, { headers: hdrs() }).then(r => r.json()).then(d => setAccounts(d.data || d.accounts || []));
    fetch(`${API}/agencies`, { headers: hdrs() }).then(r => r.json()).then(d => setAgencies(d.data || d.agencies || d || []));
  }, [caseId]);

  const filtered = useMemo(() => {
    let list = [...threads];
    if (search) list = list.filter(t => (t.subject || '').toLowerCase().includes(search.toLowerCase()) || (t.body || '').toLowerCase().includes(search.toLowerCase()) || (t.sender || '').toLowerCase().includes(search.toLowerCase()));
    if (filter === 'inbox') list = list.filter(t => t.direction === 'inbound');
    if (filter === 'sent') list = list.filter(t => t.direction === 'outbound');
    if (filter === 'drafts') list = list.filter(t => t.draft);
    list.sort((a, b) => sortBy === 'date' ? new Date(b.created_at || 0) - new Date(a.created_at || 0) : new Date(a.created_at || 0) - new Date(b.created_at || 0));
    return list;
  }, [threads, search, filter, sortBy]);

  const openComposer = (thread = null) => { setReplyTo(thread); setShowComposer(true); };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[150px]">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--ds-text-muted)' }} />
          <input className="w-full pr-8 pl-2 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
            placeholder="بحث في المراسلات..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1">
          {['all','inbox','sent','drafts'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="text-[10px] px-2.5 py-1.5 rounded-lg font-medium ds-transition-colors"
              style={{ background: filter === f ? 'var(--ds-accent)' : 'var(--ds-bg-tertiary)', color: filter === f ? 'white' : 'var(--ds-text-muted)' }}>
              {f === 'all' ? 'الكل' : f === 'inbox' ? 'الوارد' : f === 'sent' ? 'الصادر' : 'المسودات'}
            </button>
          ))}
        </div>
        <select className="text-[10px] px-2 py-1.5 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
          value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="date">الأحدث أولاً</option>
          <option value="oldest">الأقدم أولاً</option>
        </select>
        <Button variant="primary" size="sm" onClick={() => openComposer()}><Send className="w-4 h-4" />رسالة جديدة</Button>
      </div>

      {/* Composer */}
      {showComposer && (
        <EmailComposer caseId={caseId} onClose={() => { setShowComposer(false); setReplyTo(null); }} accounts={accounts} agencies={agencies} replyTo={replyTo}
          onSent={() => fetch(`${API}/cases/${caseId}/threads`, { headers: hdrs() }).then(r => r.json()).then(d => setThreads(d.threads || []))} />
      )}

      {/* Thread list */}
      <div className="space-y-1.5">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-sm" style={{ color: 'var(--ds-text-muted)' }}>
            <Inbox className="w-8 h-8 mx-auto mb-2" />
            لا توجد مراسلات
          </div>
        ) : (
          <>
            <div className="text-[10px] font-medium px-1 mb-1" style={{ color: 'var(--ds-text-muted)' }}>{filtered.length} محادثة</div>
            {filtered.map(t => <ThreadCard key={t.id} thread={t} accounts={accounts} onReply={openComposer} />)}
          </>
        )}
      </div>
    </div>
  );
}
