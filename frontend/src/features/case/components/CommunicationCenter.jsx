import { getApiBase } from '../../../api';
import { useCaseContext } from '../context/CaseContext';
import { useState, useEffect, useMemo, useRef } from 'react';
import { Send, Reply, Forward, Paperclip, Search, Clock, AlertCircle, Inbox, FileText, Building2, User, Mail, Tag, ChevronDown, ExternalLink, X, Download, Trash2 } from 'lucide-react';
import Button from '../../../components/ui/Button';
import { formatAgencyLocation } from '../../request/utils';
import { formatArabicDateTime } from '../../../utils/formatDate';
import { splitQuotedHistory } from '../../../utils/emailQuote';

const API = getApiBase();
const tok = () => localStorage.getItem('foia_token');
const hdrs = () => ({ 'Authorization': `Bearer ${tok()}`, 'Content-Type': 'application/json' });
const authHdrs = () => ({ 'Authorization': `Bearer ${tok()}` });

const formatDateTime = formatArabicDateTime;

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
  const date = formatArabicDateTime(thread.created_at);
  return `\n\n---------- رسالة معاد توجيهها ----------\nمن: ${thread.sender || ''}\nبتاريخ: ${date}\nالموضوع: ${thread.subject || ''}\n\n${thread.body || ''}`;
}

// Reply/Reply-All quoting, Gmail/Outlook-style: the new text sits above an
// attribution line + "> "-quoted copy of the message being replied to.
// Quoting only the parent's OWN fresh text (via splitQuotedHistory) --  not
// its full raw body -- matters because that raw body already carries every
// earlier generation's quote nested inside it (each reply's body includes
// its own parent quoted the same way). Re-quoting the whole thing verbatim
// used to send the entire accumulated chain back out on every single reply,
// producing a dense, jumbled wall of "> "-prefixed text with a lot of detail
// irrelevant to this specific reply -- confusing for the recipient, and
// exactly the complaint that led to this fix. The recipient's own mail
// client already has the full history via the thread's own
// References/In-Reply-To headers, so nothing is actually lost by trimming
// what gets re-quoted here to just the immediate message's new content.
function quoteReply(thread) {
  if (!thread) return '';
  const date = formatArabicDateTime(thread.created_at);
  const { fresh } = splitQuotedHistory(thread.body || '');
  const quotedBody = fresh.split('\n').map(line => '> ' + line).join('\n');
  return `في ${date}, كتب ${thread.sender || ''}:\n${quotedBody}`;
}

function EmailComposer({ caseId, onClose, accounts, agencies, replyTo, mode = 'new', onSent, initialDraft }) {
  const { requests } = useCaseContext();
  const isForward = mode === 'forward';
  // Default to the case's own agency (from its requests) when composing fresh --
  // the investigator shouldn't have to look up and re-select it every time.
  const defaultAgencyId = !replyTo ? (requests || []).find(r => r.agency_id)?.agency_id || '' : '';
  const [to, setTo] = useState(isForward ? '' : (initialDraft?.to || replyTo?.sender || (agencies || []).find(a => a.id === defaultAgencyId)?.email || ''));
  const [cc, setCc] = useState(mode === 'replyAll' ? (replyTo?.metadata?.cc || '') : '');
  const [bcc, setBcc] = useState('');
  const [agencyId, setAgencyId] = useState(replyTo?.agency_id || defaultAgencyId);

  const handleAgencyChange = (newAgencyId) => {
    setAgencyId(newAgencyId);
    // Only auto-fill "to" if it's empty or still matches the previous agency's
    // email -- never clobber an address the user deliberately typed in.
    // <select> onChange always gives a string, but agency.id from the API is
    // a number -- comparing them directly with === never matched, so
    // newAgency was always undefined and this never fired at all. Coerce
    // both sides to string so the lookup actually finds the agency.
    const prevAgencyEmail = (agencies || []).find(a => String(a.id) === String(agencyId))?.email;
    const newAgency = (agencies || []).find(a => String(a.id) === String(newAgencyId));
    if (newAgency?.email && (!to || to === prevAgencyEmail)) setTo(newAgency.email);
  };
  const [accountId, setAccountId] = useState(replyTo?.email_account_id || replyTo?.assigned_email_account_id || accounts?.[0]?.id || '');
  // Once an account has emailed this agency for ANOTHER case, reusing it
  // here is blocked server-side (documentCenter.js's /compose) -- checked
  // here too so the reason shows up as soon as both are picked, not only
  // after a failed send attempt.
  const [lockInfo, setLockInfo] = useState(null);
  const [unlocking, setUnlocking] = useState(false);
  // A failed check silently defaulting to "not locked" would be a false
  // negative for the very feature this exists to enforce (Part 4) -- a
  // transient network error could otherwise let a locked account send
  // through the frontend with no warning at all (the backend's own check on
  // /compose is the real backstop, but the user would still see a confusing
  // 409 with no context instead of this clear inline warning). Failing
  // closed here: a check that couldn't complete blocks sending too, same as
  // a check that came back genuinely locked.
  const [lockCheckFailed, setLockCheckFailed] = useState(false);
  const checkAgencyLock = () => {
    if (!accountId || !agencyId) { setLockInfo(null); setLockCheckFailed(false); return; }
    fetch(`${API}/email-accounts/${accountId}/agency-lock?agency_id=${agencyId}&case_id=${caseId}`, { headers: authHdrs() })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { setLockInfo(d); setLockCheckFailed(false); })
      .catch(() => { setLockInfo(null); setLockCheckFailed(true); });
  };
  useEffect(() => { checkAgencyLock(); }, [accountId, agencyId]);
  const overrideLock = async () => {
    setUnlocking(true);
    try {
      const r = await fetch(`${API}/email-accounts/${accountId}/agency-lock/override`, {
        method: 'POST', headers: hdrs(), body: JSON.stringify({ agency_id: agencyId, case_id: caseId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert('❌ ' + (d.error || 'تعذر فك القيد')); setUnlocking(false); return; }
      checkAgencyLock();
      checkAllAccountLocks();
    } catch (e) { alert('❌ ' + e.message); }
    setUnlocking(false);
  };
  // Locked accounts should be marked right in the <select>'s own options --
  // otherwise the only way to discover a lock is to pick each account one
  // at a time and wait for checkAgencyLock above to report back. Purely
  // advisory (the selected-account check above is what actually gates
  // sending), so a failure here just logs instead of blocking anything.
  const [accountLocks, setAccountLocks] = useState({});
  const checkAllAccountLocks = () => {
    if (!agencyId) { setAccountLocks({}); return; }
    fetch(`${API}/email-accounts/agency-lock-status?agency_id=${agencyId}&case_id=${caseId}`, { headers: authHdrs() })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => setAccountLocks(d.statuses || {}))
      .catch(e => { console.error('[compose] account lock status check failed:', e.message); setAccountLocks({}); });
  };
  useEffect(() => { checkAllAccountLocks(); }, [agencyId]);
  const [subject, setSubject] = useState(
    isForward ? `Fwd: ${replyTo?.subject || ''}` : replyTo ? `Re: ${replyTo.subject}` : (initialDraft?.subject || '')
  );
  const isReply = mode === 'reply' || mode === 'replyAll';
  const [body, setBody] = useState(
    isForward ? quoteOriginal(replyTo).trim()
      : isReply && replyTo ? `\n\n${quoteReply(replyTo)}`
      : (initialDraft?.body || '')
  );
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState([]);
  const fileInputRef = useRef(null);
  // Grows with the actual email content instead of staying a small fixed
  // box -- same auto-grow approach as components/ds/AppTextarea.jsx, ported
  // inline to keep this composer's own compact styling. Resetting to 'auto'
  // first (not just reading scrollHeight) is what lets it shrink back down
  // too when text is deleted, not just grow.
  const bodyRef = useRef(null);
  const autoGrowBody = () => {
    const el = bodyRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = Math.max(el.scrollHeight, 100) + 'px'; }
  };
  useEffect(() => { autoGrowBody(); }, [body]);
  // Reply/Reply-All seed the body with the new-text area on top and the
  // quoted original below (see quoteReply above) -- without this the cursor
  // would land at the very end, inside the quote, forcing the user to
  // manually scroll up before they can start typing their actual reply.
  useEffect(() => {
    if (isReply && bodyRef.current) { bodyRef.current.focus(); bodyRef.current.setSelectionRange(0, 0); }
  }, []);
  const [expectedDays, setExpectedDays] = useState(!isForward && !replyTo ? '14' : '');
  const [customDays, setCustomDays] = useState('');
  const [sendError, setSendError] = useState('');

  const send = async () => {
    if (!to || !subject || !body) return;
    setSending(true); setSendError('');
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
      const d = await r.json().catch(() => ({}));
      // Previously only checked `if (d.success)` with no else -- a failed
      // send (bad credentials, daily limit reached, etc.) just left the
      // composer sitting open with zero feedback, indistinguishable from
      // the request still being in flight.
      if (!r.ok || !d.success) { setSendError(d.error || 'فشل الإرسال'); setSending(false); return; }
      onSent?.(d, subject);
      onClose?.();
    } catch(e) { setSendError('خطأ: ' + (e.message || '')); }
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
            {(agencies || []).map(a => {
              const name = a.name_en || a.name || a.name_ar || '';
              const loc = formatAgencyLocation(a);
              // Same disambiguation already used in AgenciesTab.jsx's own
              // agency picker -- several agencies here share a name and only
              // differ by state/city, so the name alone silently picked the
              // wrong one.
              return <option key={a.id} value={a.id}>{loc ? `${name} — ${loc}` : name}</option>;
            })}
          </select>
          <select className="flex-1 px-2 py-1.5 rounded text-xs" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
            value={accountId} onChange={e => setAccountId(e.target.value)}>
            <option value="">اختر حساب البريد</option>
            {(accounts || []).map(a => {
              // Marked directly in the option label -- not just after picking
              // it and waiting for the single-account check below -- so a
              // locked account is visible at a glance while browsing the list.
              const lock = accountLocks[a.id];
              const label = lock?.locked
                ? `🔒 ${a.display_name || a.email} — مستخدم لقضية رقم #${lock.lockedByCase?.id}`
                : (a.display_name || a.email);
              return <option key={a.id} value={a.id}>{label}</option>;
            })}
          </select>
        </div>
        {lockCheckFailed && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded text-[11px]" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#EF4444' }}>
            ⚠️ تعذر التحقق من قيد استخدام هذا الحساب لهذه الجهة — لا يمكن الإرسال حتى يتم التحقق.
            <button type="button" onClick={checkAgencyLock} className="underline font-semibold">إعادة المحاولة</button>
          </div>
        )}
        {lockInfo?.locked && (
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded text-[11px]" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#EF4444' }}>
            <span className="flex items-center gap-1.5 flex-wrap">
              ⚠️ هذا الحساب مستخدم بالفعل لمراسلة هذه الجهة في
              <a href={`/cases/${lockInfo.lockedByCase?.id}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(234,179,8,0.15)', color: '#eab308' }}>
                <ExternalLink className="w-2.5 h-2.5" />قضية #{lockInfo.lockedByCase?.id}
              </a>
              — اختر حسابًا آخر.
            </span>
            {lockInfo.canOverride && (
              <button type="button" onClick={overrideLock} disabled={unlocking}
                className="shrink-0 px-2 py-1 rounded font-medium" style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444' }}>
                {unlocking ? '...' : 'فك القيد'}
              </button>
            )}
          </div>
        )}
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
        <textarea ref={bodyRef} className="w-full px-2 py-1.5 rounded text-xs min-h-[100px] resize-none overflow-hidden"
          style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
          placeholder="محتوى الرسالة..." value={body} onChange={e => setBody(e.target.value)} onInput={autoGrowBody} />
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
        {sendError && (
          <div className="text-[11px] px-2 py-1.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{sendError}</div>
        )}
        <div className="flex items-center justify-between">
          <input ref={fileInputRef} type="file" multiple hidden onChange={e => setFiles([...files, ...Array.from(e.target.files || [])])} />
          <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}><Paperclip className="w-3 h-3" />مرفقات</Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>حفظ كمسودة</Button>
            <Button variant="primary" size="sm" onClick={send} disabled={sending || lockInfo?.locked || (accountId && agencyId && lockCheckFailed)}>
              {sending ? 'جاري الإرسال...' : <><Send className="w-3 h-3" />إرسال</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThreadCard({ thread, accounts, onReply, onAttachmentDeleted, onDeleted, onRead }) {
  const acct = (accounts || []).find(a => a.id === thread.email_account_id);
  const daysWaiting = thread.created_at ? Math.floor((Date.now() - new Date(thread.created_at)) / (1000*60*60*24)) : 0;
  const attachments = thread.metadata?.attachments || [];
  const [expanded, setExpanded] = useState(false);

  // Opening a message here previously called nothing at all -- the card
  // just showed a truncated preview with no expand/read interaction, so a
  // message read only from inside a case's الاتصالات tab stayed "unread" in
  // the main صندوق البريد forever (same is_read column, shared everywhere).
  const toggleExpand = () => {
    setExpanded(e => !e);
    if (!expanded && thread.is_read === false) {
      // fetch()'s promise resolves for ANY http status, including 4xx/5xx --
      // .then() alone isn't a success check, so a rejected update still
      // marked the thread read in local state with the real row untouched.
      fetch(`${API}/inbox/${thread.id}/read`, { method: 'PUT', headers: authHdrs() })
        .then(r => { if (r.ok) onRead?.(thread.id); })
        .catch(() => {});
    }
  };

  const download = async (index) => {
    try {
      const r = await fetch(`${API}/communications/${thread.id}/attachments/${index}/download`, { headers: authHdrs() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) { alert('❌ ' + (d.error || 'تعذر تحميل المرفق')); return; }
      window.open(d.url, '_blank', 'noopener,noreferrer');
    } catch (e) { alert('❌ ' + e.message); }
  };

  const remove = async (index) => {
    try {
      const r = await fetch(`${API}/communications/${thread.id}/attachments/${index}`, { method: 'DELETE', headers: authHdrs() });
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert('❌ ' + (d.error || 'تعذر حذف المرفق')); return; }
      onAttachmentDeleted?.();
    } catch (e) { alert('❌ ' + e.message); }
  };

  const deleteMessage = async (e) => {
    e.stopPropagation();
    if (!confirm('سيتم نقل هذه الرسالة إلى سلة المحذوفات -- يمكن استعادتها لاحقًا من هناك. هل تريد المتابعة؟')) return;
    try {
      const r = await fetch(`${API}/communications/${thread.id}`, { method: 'DELETE', headers: authHdrs() });
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert('❌ ' + (d.error || 'تعذر حذف الرسالة')); return; }
      onDeleted?.();
    } catch (e) { alert('❌ ' + e.message); }
  };

  return (
    <div className="rounded-lg p-3 ds-transition-colors cursor-pointer" onClick={toggleExpand}
      style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', borderRight: thread.direction === 'inbound' ? '3px solid #22c55e' : '3px solid #3b82f6' }}
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
        <div className="text-right shrink-0 flex items-start gap-1.5">
          <div>
            <div className="text-[10px]" style={{ color: daysWaiting > 14 ? '#ef4444' : daysWaiting > 7 ? '#eab308' : 'var(--ds-text-muted)' }}>{daysWaiting} يوم</div>
            <div className="text-[9px]" style={{ color: 'var(--ds-text-muted)' }}>{formatDateTime(thread.created_at)}</div>
          </div>
          <button onClick={e => { e.stopPropagation(); window.open(`/inbox/message/${thread.id}`, '_blank', 'noopener,noreferrer'); }}
            title="فتح في تاب جديد (للمراجعة/النسخ/الرد)" style={{ color: 'var(--ds-text-muted)' }}><ExternalLink className="w-3.5 h-3.5" /></button>
          <button onClick={deleteMessage} title="حذف الرسالة" style={{ color: '#ef4444' }}><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* Thread body -- truncated preview, or full text once expanded */}
      {expanded ? (
        <div className="text-[11px] mt-1 whitespace-pre-wrap" style={{ color: 'var(--ds-text-secondary)' }}>{thread.body || '(لا يوجد محتوى)'}</div>
      ) : (
        <div className="text-[11px] mt-1 line-clamp-2" style={{ color: 'var(--ds-text-secondary)' }}>{thread.body?.substring(0, 150)}</div>
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5" onClick={e => e.stopPropagation()}>
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
      <div className="flex items-center gap-1.5 mt-2" onClick={e => e.stopPropagation()}>
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

// Groups a flat message list into conversations by `thread_id` (falling back
// to the row's own id for anything with none -- non-email communication
// types never set one), each sorted oldest-first so a conversation reads
// top-to-bottom like Gmail/Outlook.
function groupByThread(list) {
  const map = new Map();
  (list || []).forEach(t => {
    const key = t.thread_id || `single-${t.id}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  });
  return [...map.values()].map(msgs => [...msgs].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)));
}

// One conversation: collapsed to a one-line summary (subject, participants,
// message count, latest date) like Gmail's inbox row; expanding it stacks
// every message in the thread -- both sent and received -- so it's obvious
// which reply answered which message. A single-message "thread" (the common
// case: most correspondence never gets a reply) renders as a plain
// ThreadCard, unchanged from before this feature existed.
function ConversationGroup({ messages, accounts, onReply, onAttachmentDeleted, onDeleted, onRead }) {
  const [expanded, setExpanded] = useState(false);
  if (messages.length === 1) {
    const t = messages[0];
    return <ThreadCard thread={t} accounts={accounts} onReply={onReply} onAttachmentDeleted={onAttachmentDeleted}
      onDeleted={() => onDeleted(t.id)} onRead={onRead} />;
  }
  const latest = messages[messages.length - 1];
  const hasUnread = messages.some(m => m.direction === 'inbound' && m.is_read === false);
  const participants = [...new Set(messages.map(m => m.direction === 'inbound' ? m.sender : m.recipient).filter(Boolean))];
  return (
    <div className="rounded-lg ds-transition-colors" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
      <div className="p-3 cursor-pointer flex items-start justify-between gap-2" onClick={() => setExpanded(e => !e)}
        style={expanded ? { borderBottom: '1px solid var(--ds-border)' } : undefined}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Mail className="w-3.5 h-3.5 shrink-0" style={{ color: '#3b82f6' }} />
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--ds-text-primary)' }}>{latest.subject}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-muted)' }}>{messages.length} رسائل</span>
            {hasUnread && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#3b82f6' }} />}
          </div>
          <div className="text-[10px] truncate" style={{ color: 'var(--ds-text-muted)' }}>{participants.join('، ')}</div>
        </div>
        <div className="text-[9px] shrink-0" style={{ color: 'var(--ds-text-muted)' }}>{formatDateTime(latest.created_at)}</div>
      </div>
      {expanded && (
        <div className="p-2 space-y-1.5">
          {messages.map(m => (
            <ThreadCard key={m.id} thread={m} accounts={accounts} onReply={onReply} onAttachmentDeleted={onAttachmentDeleted}
              onDeleted={() => onDeleted(m.id)} onRead={onRead} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CommunicationCenter({ caseId }) {
  const { requests } = useCaseContext();
  const [threads, setThreads] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [showComposer, setShowComposer] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [composerMode, setComposerMode] = useState('new');
  const [aiDraft, setAiDraft] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [sendSuccess, setSendSuccess] = useState('');
  const [threadsError, setThreadsError] = useState('');

  // Previously had no .catch anywhere -- a rejected fetch (network error)
  // left `threads` at its initial [] forever with no distinction from "this
  // case genuinely has no correspondence yet", and no console/user-visible
  // trace that anything had failed at all.
  const refetchThreads = () => fetch(`${API}/cases/${caseId}/threads`, { headers: hdrs() })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(d => { setThreads(d.threads || []); setThreadsError(''); })
    .catch(e => setThreadsError('تعذر تحميل المراسلات: ' + e.message));

  // Only agencies actually registered on this case (via its requests) should
  // be selectable here -- this composer isn't a way to start correspondence
  // with an agency the case doesn't involve, that belongs in AgenciesTab's
  // own "add agency" flow first.
  const agencies = useMemo(() => {
    const map = new Map();
    (requests || []).forEach(r => { if (r.agencies?.id) map.set(r.agencies.id, r.agencies); });
    return [...map.values()];
  }, [requests]);

  useEffect(() => {
    if (!caseId) return;
    refetchThreads();
    fetch(`${API}/email-accounts`, { headers: hdrs() }).then(r => r.json()).then(d => setAccounts(d.data || d.accounts || [])).catch(() => {});
  }, [caseId]);

  // Picks up a draft the AI assistant just composed (aiTools.js's
  // compose_email, handed off via sessionStorage by useAIChat.js) and opens
  // the composer pre-filled with it -- the assistant never sends anything
  // itself, this only saves the human from retyping what it already wrote.
  useEffect(() => {
    if (!caseId) return;
    const key = `ai_email_draft_${caseId}`;
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      sessionStorage.removeItem(key);
      const draft = JSON.parse(raw);
      setReplyTo(null); setComposerMode('new'); setAiDraft(draft); setShowComposer(true);
    } catch {}
  }, [caseId]);

  // Filtering/searching applies at the CONVERSATION level, not per-message --
  // a thread qualifies if ANY message in it matches, then every message in
  // that thread still renders together once expanded. Otherwise filtering to
  // "الصادر" would hide the very inbound replies the user wants to see
  // alongside their own sent message, defeating the point of grouping at all.
  const filtered = useMemo(() => {
    const matches = (t) => {
      if (search && !((t.subject || '').toLowerCase().includes(search.toLowerCase()) || (t.body || '').toLowerCase().includes(search.toLowerCase()) || (t.sender || '').toLowerCase().includes(search.toLowerCase()))) return false;
      if (filter === 'inbox' && t.direction !== 'inbound') return false;
      if (filter === 'sent' && t.direction !== 'outbound') return false;
      if (filter === 'drafts' && !t.draft) return false;
      return true;
    };
    const groups = groupByThread(threads).filter(msgs => msgs.some(matches));
    groups.sort((a, b) => {
      const aLatest = new Date(a[a.length - 1].created_at || 0), bLatest = new Date(b[b.length - 1].created_at || 0);
      return sortBy === 'date' ? bLatest - aLatest : aLatest - bLatest;
    });
    return groups;
  }, [threads, search, filter, sortBy]);

  const openComposer = (thread = null, mode = 'new') => { setReplyTo(thread); setComposerMode(thread ? mode : 'new'); setShowComposer(true); };

  return (
    <div className="space-y-3">
      {sendSuccess && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium" style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}>
          {sendSuccess}
        </div>
      )}
      {threadsError && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
          <span>⚠️ {threadsError}</span>
          <button onClick={refetchThreads} className="underline shrink-0">إعادة المحاولة</button>
        </div>
      )}
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
        // Keyed on which message (if any) is being replied to/forwarded --
        // EmailComposer's to/subject/body/account/agency are all seeded via
        // useState(initialValueFromProps), mount-only. Without a key,
        // clicking "رد" on a second message while a composer for a first
        // message was still open reused the same component instance: the
        // title updated (reads `mode` live) but every seeded field stayed
        // stale from the first message while `replyTo.id` (used as
        // reply_to_id at send time) silently pointed at the second one --
        // a real misdirected/mis-threaded send. A key forces a fresh mount
        // (fresh state) any time the reply target actually changes.
        <EmailComposer key={`${replyTo?.id ?? (aiDraft ? 'ai-draft' : 'new')}:${composerMode}`} caseId={caseId} onClose={() => { setShowComposer(false); setReplyTo(null); setAiDraft(null); }} accounts={accounts} agencies={agencies} replyTo={replyTo} mode={composerMode} initialDraft={aiDraft}
          onSent={(sentData, subject) => {
            refetchThreads();
            const warningNote = sentData?.warnings?.length ? ` (تنبيه: ${sentData.warnings.join(' — ')})` : '';
            setSendSuccess(`تم إرسال "${subject || ''}" بنجاح ✓${warningNote}`);
            setTimeout(() => setSendSuccess(''), 6000);
          }} />
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
            {filtered.map(msgs => <ConversationGroup key={msgs[0].thread_id || msgs[0].id} messages={msgs} accounts={accounts} onReply={openComposer}
              onAttachmentDeleted={refetchThreads}
              onDeleted={(id) => setThreads(prev => prev.filter(x => x.id !== id))}
              onRead={id => setThreads(prev => prev.map(x => x.id === id ? { ...x, is_read: true } : x))} />)}
          </>
        )}
      </div>
    </div>
  );
}
