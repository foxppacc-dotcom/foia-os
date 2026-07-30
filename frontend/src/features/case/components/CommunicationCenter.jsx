import { getApiBase } from '../../../api';
import { useCaseContext } from '../context/CaseContext';
import { useState, useEffect, useMemo, useRef } from 'react';
import { Send, Reply, Forward, Paperclip, Search, Clock, AlertCircle, Inbox, FileText, Building2, User, Mail, Tag, ChevronDown, ExternalLink, X, Download, Trash2 } from 'lucide-react';
import Button from '../../../components/ui/Button';

const API = getApiBase();
const tok = () => localStorage.getItem('foia_token');
const hdrs = () => ({ 'Authorization': `Bearer ${tok()}`, 'Content-Type': 'application/json' });
const authHdrs = () => ({ 'Authorization': `Bearer ${tok()}` });

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const ACCOUNT_SLA_RULES_KEY = 'foia_last_account_filter';

const COMPOSER_TITLES = { new: 'رسالة جديدة', reply: 'رد', replyAll: 'رد على الجميع', forward: 'إعادة توجيه' };

function quoteOriginal(thread) {
  if (!thread) return '';
  const date = thread.created_at ? new Date(thread.created_at).toLocaleString('ar-SA') : '';
  return `\n\n---------- رسالة معاد توجيهها ----------\nمن: ${thread.sender || ''}\nبتاريخ: ${date}\nالموضوع: ${thread.subject || ''}\n\n${thread.body || ''}`;
}

function EmailComposer({ caseId, onClose, accounts, agencies, replyTo, mode = 'new', onSent }) {
  const { requests } = useCaseContext();
  const isForward = mode === 'forward';
  // Default to the case's own agency (from its requests) when composing fresh --
  // the investigator shouldn't have to look up and re-select it every time.
  const defaultAgencyId = !replyTo ? (requests || []).find(r => r.agency_id)?.agency_id || '' : '';
  const [to, setTo] = useState(isForward ? '' : (replyTo?.sender || (agencies || []).find(a => a.id === defaultAgencyId)?.email || ''));
  const [cc, setCc] = useState(mode === 'replyAll' ? (replyTo?.metadata?.cc || '') : '');
  const [bcc, setBcc] = useState('');
  const [agencyId, setAgencyId] = useState(replyTo?.agency_id || defaultAgencyId);

  const handleAgencyChange = (newAgencyId) => {
    setAgencyId(newAgencyId);
    // Only auto-fill "to" if it's empty or still matches the previous agency's
    // email -- never clobber an address the user deliberately typed in.
    const prevAgencyEmail = (agencies || []).find(a => a.id === agencyId)?.email;
    const newAgency = (agencies || []).find(a => a.id === newAgencyId);
    if (newAgency?.email && (!to || to === prevAgencyEmail)) setTo(newAgency.email);
  };
  const [accountId, setAccountId] = useState(replyTo?.email_account_id || replyTo?.assigned_email_account_id || accounts?.[0]?.id || '');
  const [subject, setSubject] = useState(
    isForward ? `Fwd: ${replyTo?.subject || ''}` : replyTo ? `Re: ${replyTo.subject}` : ''
  );
  const [body, setBody] = useState(isForward ? quoteOriginal(replyTo).trim() : '');
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState([]);
  const fileInputRef = useRef(null);
  const [expectedDays, setExpectedDays] = useState(!isForward && !replyTo ? '14' : '');
  const [customDays, setCustomDays] = useState('');

  const send = async () => {
    if (!to || !subject || !body) return;
    setSending(true);
    try {
      const fd = new FormData();
      fd.append('to', to);
      if (cc) fd.append('cc', cc);
      if (bcc) fd.append('bcc', bcc);
      fd.append('subject', subject);
      fd.append('body', body);
      if (accountId) fd.append('account_id', accountId);
      if (agencyId) fd.append('agency_id', agencyId);
      if (replyTo?.request_id) fd.append('request_id', replyTo.request_id);
      if (!isForward && replyTo?.id) fd.append('reply_to_id', replyTo.id);
      const daysValue = expectedDays === 'custom' ? customDays : expectedDays;
      if (daysValue) fd.append('expected_response_days', daysValue);
      files.forEach(f => fd.append('attachments', f));

      const r = await fetch(`${API}/cases/${caseId}/compose`, { method: 'POST', headers: authHdrs(), body: fd });
      const d = await r.json();
      if (d.success) { onSent?.(d); onClose?.(); }
    } catch(e) { console.error(e); }
    setSending(false);
  };

  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>{COMPOSER_TITLES[mode] || COMPOSER_TITLES.new}</span>
        <button onClick={onClose} style={{ color: 'var(--ds-text-muted)' }}>✕</button>
      </div>
      <div className="space-y-2">
        {/* Agency + Account */}
        <div className="flex gap-2">
          <select className="flex-1 px-2 py-1.5 rounded text-xs" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
            value={agencyId} onChange={e => handleAgencyChange(e.target.value)}>
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
        <div className="flex gap-2">
          <input className="flex-1 px-2 py-1.5 rounded text-xs" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
            placeholder="CC" value={cc} onChange={e => setCc(e.target.value)} />
          <input className="flex-1 px-2 py-1.5 rounded text-xs" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
            placeholder="BCC" value={bcc} onChange={e => setBcc(e.target.value)} />
        </div>
        <input className="w-full px-2 py-1.5 rounded text-xs" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
          placeholder="الموضوع..." value={subject} onChange={e => setSubject(e.target.value)} />
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ds-text-muted)' }} />
          <select className="flex-1 px-2 py-1.5 rounded text-xs" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
            value={expectedDays} onChange={e => setExpectedDays(e.target.value)}>
            <option value="">بدون موعد رد متوقع</option>
            <option value="1">يوم واحد</option>
            <option value="2">يومان</option>
            <option value="3">3 أيام</option>
            <option value="7">أسبوع (7 أيام)</option>
            <option value="14">أسبوعان (14 يوم)</option>
            <option value="30">شهر (30 يوم)</option>
            <option value="custom">مخصص...</option>
          </select>
          {expectedDays === 'custom' && (
            <input type="number" min="1" className="w-20 px-2 py-1.5 rounded text-xs" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
              placeholder="أيام" value={customDays} onChange={e => setCustomDays(e.target.value)} />
          )}
        </div>
        <textarea className="w-full px-2 py-1.5 rounded text-xs min-h-[100px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
          placeholder="محتوى الرسالة..." value={body} onChange={e => setBody(e.target.value)} />
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <span key={i} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-secondary)' }}>
                <Paperclip className="w-3 h-3" />{f.name} ({formatSize(f.size)})
                <button onClick={() => setFiles(files.filter((_, fi) => fi !== i))} style={{ color: 'var(--ds-text-muted)' }}><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between">
          <input ref={fileInputRef} type="file" multiple hidden onChange={e => setFiles([...files, ...Array.from(e.target.files || [])])} />
          <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}><Paperclip className="w-3 h-3" />مرفقات</Button>
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

function ThreadCard({ thread, accounts, onReply, onAttachmentDeleted }) {
  const acct = (accounts || []).find(a => a.id === thread.email_account_id);
  const daysWaiting = thread.created_at ? Math.floor((Date.now() - new Date(thread.created_at)) / (1000*60*60*24)) : 0;
  const attachments = thread.metadata?.attachments || [];

  const download = async (index) => {
    const r = await fetch(`${API}/communications/${thread.id}/attachments/${index}/download`, { headers: authHdrs() });
    const d = await r.json();
    if (d.url) window.open(d.url, '_blank', 'noopener,noreferrer');
  };

  const remove = async (index) => {
    await fetch(`${API}/communications/${thread.id}/attachments/${index}`, { method: 'DELETE', headers: authHdrs() });
    onAttachmentDeleted?.();
  };

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

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {attachments.map((att, i) => (
            <span key={i} className="flex items-center gap-1 text-[9px] px-2 py-1 rounded" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-secondary)' }}>
              <Paperclip className="w-3 h-3" />{att.filename} {att.size != null && `(${formatSize(att.size)})`}
              {att.storageKey && <button onClick={() => download(i)} title="تحميل" style={{ color: 'var(--ds-text-muted)' }}><Download className="w-3 h-3" /></button>}
              <button onClick={() => remove(i)} title="حذف" style={{ color: '#ef4444' }}><Trash2 className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div className="flex items-center gap-1.5 mt-2">
        <button onClick={() => onReply(thread, 'reply')} className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded" style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>
          <Reply className="w-3 h-3" />رد
        </button>
        <button onClick={() => onReply(thread, 'replyAll')} className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded" style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>
          <Reply className="w-3 h-3" />رد للجميع
        </button>
        <button onClick={() => onReply(thread, 'forward')} className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-muted)' }}>
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
  const [composerMode, setComposerMode] = useState('new');
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

  const openComposer = (thread = null, mode = 'new') => { setReplyTo(thread); setComposerMode(thread ? mode : 'new'); setShowComposer(true); };

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
        <EmailComposer caseId={caseId} onClose={() => { setShowComposer(false); setReplyTo(null); }} accounts={accounts} agencies={agencies} replyTo={replyTo} mode={composerMode}
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
            {filtered.map(t => <ThreadCard key={t.id} thread={t} accounts={accounts} onReply={openComposer}
              onAttachmentDeleted={() => fetch(`${API}/cases/${caseId}/threads`, { headers: hdrs() }).then(r => r.json()).then(d => setThreads(d.threads || []))} />)}
          </>
        )}
      </div>
    </div>
  );
}
