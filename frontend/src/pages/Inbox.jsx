import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { api, getApiBase, getCurrentUser } from '../api';
import { Mail, Search, Inbox, Archive, ArchiveRestore, Link2, Unlink, ChevronDown, RefreshCw, Loader2, ExternalLink, Trash2, Send, X, Paperclip, Download, CheckCircle2, ChevronLeft, ChevronRight, AlertTriangle, Filter } from 'lucide-react';
import AppSection from '../components/ds/AppSection';
import AppButton from '../components/ds/AppButton';
import AppBadge from '../components/ds/AppBadge';
import AppEmptyState from '../components/ds/AppEmptyState';
import AppDialog from '../components/ds/AppDialog';
import EmailBodyView from '../components/EmailBodyView';
import { formatArabicDate, formatArabicTime } from '../utils/formatDate';

// English uses the browser's own en-GB formatting (already Gregorian by
// default, no calendar quirk to guard against); Arabic goes through the
// shared formatArabicDate/Time helpers, which force calendar: 'gregory'.
function formatMsgDateTime(date, lang) {
  if (!date) return '';
  if (lang === 'en') return `${new Date(date).toLocaleDateString('en-GB')} ${new Date(date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  return `${formatArabicDate(date)} ${formatArabicTime(date)}`;
}

const BASE = getApiBase();
const tok = () => localStorage.getItem('foia_token');
const hdrs = () => ({ 'Authorization': `Bearer ${tok()}`, 'Content-Type': 'application/json' });

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// One message inside an expanded conversation. The message that was
// actually clicked opens expanded by default; every other message in the
// same thread starts collapsed to a one-line summary (sender/recipient +
// date), tap to expand -- matches Gmail's "only the relevant message is
// open, the rest of the thread is a quick scroll away" pattern.
function ThreadMiniRow({ msg, isActive, i18n }) {
  const [open, setOpen] = useState(isActive);
  useEffect(() => { setOpen(isActive); }, [isActive]);
  const dateStr = formatMsgDateTime(msg.created_at, i18n.language);
  return (
    <div className="rounded-lg" style={{ background: isActive ? 'var(--ds-bg-tertiary)' : 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', borderRight: msg.direction === 'inbound' ? '3px solid #22c55e' : '3px solid #3b82f6' }}>
      <div className="p-2 flex items-center justify-between gap-2 cursor-pointer" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-1.5 min-w-0">
          <Mail className="w-3 h-3 shrink-0" style={{ color: msg.direction === 'inbound' ? '#22c55e' : '#3b82f6' }} />
          <span className="text-[11px] truncate" style={{ color: 'var(--ds-text-primary)' }}>{msg.direction === 'inbound' ? msg.sender : msg.recipient}</span>
        </div>
        <span className="text-[9px] shrink-0" style={{ color: 'var(--ds-text-muted)' }}>{dateStr}</span>
      </div>
      {open && <div className="px-2 pb-2"><EmailBodyView html={msg.body_html} text={msg.body} /></div>}
    </div>
  );
}

// A clickable popup calendar instead of typed digit segments. Native
// <input type="date"> renders its numerals/segment order from the BROWSER'S
// OWN locale, not the page's dir/lang attributes -- Chrome in particular
// keeps showing Arabic-Indic digits and a reversed-looking order regardless
// of dir="ltr"/lang="en-GB" on the element itself. Rendering the calendar
// grid ourselves (plain divs/buttons, not a native date widget) sidesteps
// that entirely while still being a single click to pick a date.
function CalendarPopup({ value, onChange, placeholder }) {
  const { t } = useTranslation('common');
  const monthNames = t('common:months', { returnObjects: true });
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => {
    const d = value ? new Date(value + 'T00:00:00') : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const ref = useRef(null);

  useEffect(() => {
    if (!value) return;
    const d = new Date(value + 'T00:00:00');
    setViewDate({ year: d.getFullYear(), month: d.getMonth() });
  }, [value]);

  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const daysInMonth = new Date(viewDate.year, viewDate.month + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewDate.year, viewDate.month, 1).getDay();

  const pick = (day) => {
    const mm = String(viewDate.month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    onChange(`${viewDate.year}-${mm}-${dd}`);
    setOpen(false);
  };

  const prevMonth = () => setViewDate(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 });
  const nextMonth = () => setViewDate(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 });

  const displayValue = value ? new Date(value + 'T00:00:00').toLocaleDateString('en-GB') : placeholder;
  const selectedStr = `${viewDate.year}-${String(viewDate.month + 1).padStart(2, '0')}`;

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="px-2 py-1 rounded text-[11px] min-w-[86px] text-center"
        style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: value ? 'var(--ds-text-primary)' : 'var(--ds-text-muted)' }}
        dir="ltr">
        {displayValue}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 p-2 rounded-xl shadow-lg" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', width: '210px' }} dir="ltr">
          <div className="flex items-center justify-between mb-2 px-0.5">
            <button type="button" onClick={prevMonth} className="p-0.5 rounded" style={{ color: 'var(--ds-text-secondary)' }}><ChevronLeft className="w-3.5 h-3.5" /></button>
            <span className="text-[11px] font-medium" style={{ color: 'var(--ds-text-primary)' }}>{monthNames[viewDate.month]} {viewDate.year}</span>
            <button type="button" onClick={nextMonth} className="p-0.5 rounded" style={{ color: 'var(--ds-text-secondary)' }}><ChevronRight className="w-3.5 h-3.5" /></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <span key={i} className="text-[9px]" style={{ color: 'var(--ds-text-muted)' }}>{d}</span>
            ))}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => <span key={'e' + i} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dayStr = `${selectedStr}-${String(day).padStart(2, '0')}`;
              const isSelected = value === dayStr;
              return (
                <button type="button" key={day} onClick={() => pick(day)}
                  className="w-6 h-6 rounded text-[10px] ds-transition-colors"
                  style={{ background: isSelected ? 'var(--ds-accent)' : 'transparent', color: isSelected ? 'white' : 'var(--ds-text-primary)' }}>
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 50;

export default function InboxPage() {
  const { t, i18n } = useTranslation(['inbox', 'common']);
  const [messages, setMessages] = useState([]);
  const [total, setTotal] = useState(0);
  // Independent of `total` (which reflects whichever tab is CURRENTLY
  // selected) -- without this, switching to "غير مقروء" (5 messages)
  // overwrote `total` to 5, and the "الكل" tab button itself then displayed
  // "الكل (5)" instead of the real all-messages count until switching back.
  const [allCount, setAllCount] = useState(0);
  const [archivedMatches, setArchivedMatches] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const [pageInput, setPageInput] = useState('1');
  const [accounts, setAccounts] = useState([]);
  const [canManageCriteria, setCanManageCriteria] = useState(false);
  const [showCriteriaPanel, setShowCriteriaPanel] = useState(false);
  useEffect(() => {
    api.get('/permissions/mine').then(d => {
      const isAdmin = getCurrentUser()?.role === 'admin';
      setCanManageCriteria(isAdmin || !!(d.permissions || []).find(p => p.resource === 'email_matching' && p.action === 'manage_criteria'));
    }).catch(() => {});
  }, []);

  // Filters are staged in `pending` and only take effect once "تطبيق
  // الفلترة" is pressed, copying into `applied` (which fetchInbox actually
  // reads) -- previously every keystroke/change re-fetched immediately, so
  // picking a date range meant a fetch fired after the FROM date alone, then
  // again after TO, with no way to set both first and confirm once.
  const blankFilters = { direction: 'all', accountId: 'all', dateFrom: '', dateTo: '', search: '' };
  const [pending, setPending] = useState(blankFilters);
  const [applied, setApplied] = useState(blankFilters);

  const [selected, setSelected] = useState(null);
  // Cache of thread_id -> every message sharing it (sent + received),
  // fetched lazily the first time a message in that thread is opened -- lets
  // an expanded message show its whole conversation like Gmail/Outlook,
  // without restructuring this page's own list/pagination/filters (those
  // stay exactly one row per message, unchanged).
  const [threadMsgs, setThreadMsgs] = useState({});
  const [threadLoadingId, setThreadLoadingId] = useState(null);
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
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (status !== 'all') params.set('status', status);
      if (applied.direction !== 'all') params.set('direction', applied.direction);
      if (applied.accountId !== 'all') params.set('account_id', applied.accountId);
      if (applied.dateFrom) params.set('date_from', applied.dateFrom);
      if (applied.dateTo) params.set('date_to', applied.dateTo);
      if (applied.search) params.set('search', applied.search);
      const r = await fetch(`${BASE}/inbox?${params}`, { headers: hdrs() });
      const d = await r.json().catch(() => ({}));
      // A 500 (e.g. an invalid date range Postgres rejects) still resolves
      // here with d.data undefined -- rendering as an empty list, identical
      // to "genuinely no messages in range" with zero indication the query
      // itself never ran.
      if (!r.ok) { setFetchError(d.error || t('inbox:errors.loadFailedGeneric')); setMessages([]); setTotal(0); setLoading(false); return; }
      setFetchError('');
      setMessages(d.data || []);
      setTotal(d.total || 0);
      setArchivedMatches(d.archivedMatches || 0);
    } catch (e) { setFetchError(t('inbox:errors.connectionError')); console.error('Inbox fetch error:', e); }
    setLoading(false);
  };

  // Fetched independently of the currently-selected tab (status is always
  // omitted here, i.e. "all"), so the "الكل" button's count stays accurate
  // no matter which tab the user is actually viewing. Only re-runs when the
  // OTHER filters change, not on every tab switch or page turn.
  const fetchAllCount = async () => {
    try {
      const params = new URLSearchParams({ limit: '1', offset: '0' });
      if (applied.direction !== 'all') params.set('direction', applied.direction);
      if (applied.accountId !== 'all') params.set('account_id', applied.accountId);
      if (applied.dateFrom) params.set('date_from', applied.dateFrom);
      if (applied.dateTo) params.set('date_to', applied.dateTo);
      if (applied.search) params.set('search', applied.search);
      const r = await fetch(`${BASE}/inbox?${params}`, { headers: hdrs() });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setAllCount(d.total || 0);
    } catch {}
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

  useEffect(() => { setLoading(true); fetchInbox(); }, [status, page, applied]);
  useEffect(() => { fetchAllCount(); }, [applied]);
  useEffect(() => { fetchUnread(); fetchAccounts(); }, []);
  useEffect(() => { setPageInput(String(page + 1)); }, [page]);

  const applyFilters = () => { setPage(0); setApplied(pending); };
  const clearFilters = () => { setPending(blankFilters); setPage(0); setApplied(blankFilters); };
  const filtersDirty = JSON.stringify(pending) !== JSON.stringify(applied);

  const handlePoll = async () => {
    setPolling(true);
    try {
      const r = await fetch(`${BASE}/imap/poll`, { method: 'POST', headers: hdrs(), body: '{}' });
      const d = await r.json();
      if (d.newMessages > 0) fetchInbox();
      fetchUnread();
      // Not a hard failure (the poll still ran), but a warning here means
      // the incremental-fetch cursor didn't save -- left unnoticed, every
      // future click keeps re-scanning the same ever-widening window,
      // which is exactly what made this button look like it hangs.
      if (d.warnings?.length) alert('⚠️ ' + d.warnings.join('\n'));
    } catch {}
    setPolling(false);
  };

  const handleLink = async (id, caseId, agencyId) => {
    try {
      const r = await fetch(`${BASE}/inbox/${id}/link`, { method: 'PUT', headers: hdrs(), body: JSON.stringify({ case_id: caseId, agency_id: agencyId }) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(t('inbox:actionErrors.linkFailed', { message: d.error || t('inbox:actionErrors.linkFailedGeneric') })); return; }
      fetchInbox();
    } catch (e) { alert(t('inbox:actionErrors.linkFailed', { message: e.message })); }
  };

  const handleUnlink = async (id) => {
    if (!confirm(t('inbox:confirm.unlink'))) return;
    try {
      const r = await fetch(`${BASE}/inbox/${id}/unlink`, { method: 'PUT', headers: hdrs() });
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(t('inbox:actionErrors.unlinkFailed', { message: d.error || t('inbox:actionErrors.unlinkFailedGeneric') })); return; }
      fetchInbox();
    } catch (e) { alert(t('inbox:actionErrors.unlinkFailed', { message: e.message })); }
  };

  // Distinct from a plain unlink -- also tells the matching-criteria system
  // the reason behind this link was wrong, so "معايير ربط الإيميلات" can
  // show which tiers actually produce bad matches.
  const handleRejectMatch = async (id) => {
    if (!confirm(t('inbox:confirm.rejectMatch'))) return;
    try {
      const r = await fetch(`${BASE}/inbox/${id}/reject-match`, { method: 'PUT', headers: hdrs() });
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(t('inbox:actionErrors.rejectFailed', { message: d.error || t('inbox:actionErrors.rejectFailedGeneric') })); return; }
      fetchInbox();
    } catch (e) { alert(t('inbox:actionErrors.rejectFailed', { message: e.message })); }
  };

  const handleReview = async (id) => {
    try {
      const r = await fetch(`${BASE}/inbox/${id}/review`, { method: 'PUT', headers: hdrs() });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setMessages(prev => prev.map(m => m.id === id ? { ...m, reviewed_by: d.reviewed_by, reviewed_by_name: d.reviewed_by_name, reviewed_at: d.reviewed_at } : m));
      else alert(t('inbox:actionErrors.reviewFailed', { message: d.error || t('inbox:actionErrors.reviewFailedGeneric') }));
    } catch (e) { alert(t('inbox:actionErrors.reviewFailed', { message: e.message })); }
  };

  // Expanding a message previously called nothing at all -- it stayed
  // counted as "unread" forever unless separately linked or archived, which
  // is part of why the unread badge looked wrong.
  const handleOpen = (msg) => {
    const opening = selected !== msg.id;
    setSelected(opening ? msg.id : null);
    if (opening && msg.thread_id && !threadMsgs[msg.thread_id]) {
      setThreadLoadingId(msg.id);
      fetch(`${BASE}/communications/thread/${encodeURIComponent(msg.thread_id)}`, { headers: hdrs() })
        .then(r => r.json())
        .then(d => { if (d.success) setThreadMsgs(prev => ({ ...prev, [msg.thread_id]: d.data || [] })); })
        .catch(() => {})
        .finally(() => setThreadLoadingId(null));
    }
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

  const downloadAttachment = async (msgId, index) => {
    try {
      const r = await fetch(`${BASE}/communications/${msgId}/attachments/${index}/download`, { headers: hdrs() });
      const d = await r.json().catch(() => ({}));
      if (d.url) window.open(d.url, '_blank', 'noopener,noreferrer');
      else alert(t('inbox:message.downloadFailed'));
    } catch { alert(t('inbox:message.downloadFailed')); }
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
      if (!r.ok || d.success === false) { setComposeError(d.error || t('inbox:composer.sendFailed')); setComposing(false); return; }
      closeComposer();
      setSendSuccess(t('inbox:composer.sendSuccess'));
      setTimeout(() => setSendSuccess(''), 4000);
      fetchInbox();
    } catch (e) { setComposeError(t('inbox:composer.sendError', { message: e.message || '' })); }
    setComposing(false);
  };

  const handleArchive = async (id) => {
    try {
      const r = await fetch(`${BASE}/inbox/${id}/archive`, { method: 'PUT', headers: hdrs() });
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(t('inbox:actionErrors.archiveFailed', { message: d.error || t('inbox:actionErrors.reviewFailedGeneric') })); return; }
      fetchInbox();
    } catch (e) { alert(t('inbox:actionErrors.archiveFailed', { message: e.message })); }
  };

  const handleUnarchive = async (id) => {
    try {
      const r = await fetch(`${BASE}/inbox/${id}/unarchive`, { method: 'PUT', headers: hdrs() });
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(t('inbox:actionErrors.unarchiveFailed', { message: d.error || t('inbox:actionErrors.reviewFailedGeneric') })); return; }
      fetchInbox();
    } catch (e) { alert(t('inbox:actionErrors.unarchiveFailed', { message: e.message })); }
  };

  const handleDelete = async (id) => {
    if (!confirm(t('inbox:confirm.delete'))) return;
    try {
      const r = await fetch(`${BASE}/communications/${id}`, { method: 'DELETE', headers: hdrs() });
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(t('inbox:actionErrors.deleteFailed', { message: d.error || t('inbox:actionErrors.reviewFailedGeneric') })); return; }
      fetchInbox();
      fetchUnread();
    } catch (e) { alert(t('inbox:actionErrors.deleteFailed', { message: e.message })); }
  };

  const statusCounts = [
    { key: 'all', label: t('inbox:status.all', { count: allCount }), color: 'var(--ds-text-primary)' },
    { key: 'unread', label: t('inbox:status.unread', { count: unread }), color: '#3b82f6' },
    { key: 'unlinked', label: t('inbox:status.unlinked'), color: '#eab308' },
    { key: 'linked', label: t('inbox:status.linked'), color: '#22c55e' },
    { key: 'archived', label: t('inbox:status.archived'), color: '#8b5cf6' },
  ];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const goToPage = () => {
    const n = parseInt(pageInput);
    if (Number.isFinite(n) && n >= 1 && n <= totalPages) setPage(n - 1);
    else setPageInput(String(page + 1));
  };

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
          <h1 className="text-lg font-semibold" style={{ color: 'var(--ds-text-primary)' }}>{t('inbox:title')}</h1>
        </div>
        <div className="flex items-center gap-2">
          {canManageCriteria && (
            <AppButton size="sm" variant="secondary" icon={<Filter className="w-3.5 h-3.5" />} onClick={() => setShowCriteriaPanel(true)}>
              {t('inbox:criteriaButton')}
            </AppButton>
          )}
          <AppButton size="sm" variant="secondary" icon={<Send className="w-3.5 h-3.5" />} onClick={() => { setShowComposer(true); setComposeError(''); }}>
            {t('inbox:newMessage')}
          </AppButton>
          <AppButton size="sm" icon={polling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} onClick={handlePoll} disabled={polling}>
            {polling ? t('inbox:fetching') : t('inbox:fetchEmails')}
          </AppButton>
        </div>
      </div>

      <MatchingCriteriaPanel open={showCriteriaPanel} onClose={() => setShowCriteriaPanel(false)} />

      {/* Standalone composer -- not tied to any case */}
      {showComposer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => !composing && closeComposer()}>
          <div className="w-full max-w-lg rounded-2xl p-5 max-h-[85vh] overflow-y-auto"
            style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>{t('inbox:composer.heading')}</h3>
              <button onClick={closeComposer} style={{ color: 'var(--ds-text-muted)' }}><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-2">
              <select value={composeForm.account_id} onChange={e => setComposeForm({ ...composeForm, account_id: e.target.value })}
                className="w-full px-2 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}>
                <option value="">{t('inbox:composer.selectAccount')}</option>
                {accounts.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.email} ({a.name})</option>)}
              </select>
              <input value={composeForm.to} onChange={e => setComposeForm({ ...composeForm, to: e.target.value })} placeholder={t('inbox:composer.to')}
                className="w-full px-2 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
              <input value={composeForm.cc} onChange={e => setComposeForm({ ...composeForm, cc: e.target.value })} placeholder={t('inbox:composer.cc')}
                className="w-full px-2 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
              <input value={composeForm.subject} onChange={e => setComposeForm({ ...composeForm, subject: e.target.value })} placeholder={t('inbox:composer.subject')}
                className="w-full px-2 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
              <textarea value={composeForm.body} onChange={e => setComposeForm({ ...composeForm, body: e.target.value })} placeholder={t('inbox:composer.body')} rows={6}
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
                  <Paperclip className="w-3.5 h-3.5" />{t('inbox:composer.attachments')}
                  <input type="file" multiple hidden onChange={e => {
                    setComposeFiles([...composeFiles, ...Array.from(e.target.files || [])]);
                    // Reset immediately (append pattern, never fully empties
                    // on its own) -- otherwise re-picking the same file(s)
                    // after removing them from the list fires no change
                    // event, since the browser sees the input's value as
                    // unchanged.
                    e.target.value = '';
                  }} />
                </label>
              </div>

              {composeError && <div className="text-[11px] p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{composeError}</div>}
              <div className="flex justify-end gap-2 pt-1">
                <AppButton size="sm" variant="secondary" onClick={closeComposer} disabled={composing}>{t('inbox:composer.cancel')}</AppButton>
                <AppButton size="sm" onClick={sendCompose} disabled={composing || !composeForm.account_id || !composeForm.to || !composeForm.subject}>
                  {composing ? t('inbox:composer.sending') : t('inbox:composer.send')}
                </AppButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Status tabs */}
      <div className="flex gap-1.5 flex-wrap items-center">
        {statusCounts.map(s => (
          <button key={s.key} onClick={() => { setStatus(s.key); setPage(0); }}
            className="px-3 py-1.5 text-xs rounded-lg ds-transition-colors"
            style={{ background: status === s.key ? 'var(--ds-bg-tertiary)' : 'transparent', color: s.color, border: status === s.key ? '1px solid var(--ds-border)' : '1px solid transparent' }}>
            {s.key === 'archived' && <Archive className="w-3 h-3 inline ml-1" />}
            {s.label}
          </button>
        ))}
      </div>

      {/* Filters -- staged, only applied on the button below */}
      <div className="flex gap-2 flex-wrap items-center p-2.5 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
        {[
          { key: 'all', label: t('inbox:filters.direction.all') },
          { key: 'inbound', label: t('inbox:filters.direction.inbound') },
          { key: 'outbound', label: t('inbox:filters.direction.outbound') },
        ].map(d => (
          <button key={d.key} onClick={() => setPending(p => ({ ...p, direction: d.key }))}
            className="px-2.5 py-1 text-[11px] rounded-lg ds-transition-colors"
            style={{ background: pending.direction === d.key ? 'var(--ds-accent)' : 'var(--ds-bg-tertiary)', color: pending.direction === d.key ? 'white' : 'var(--ds-text-muted)' }}>
            {d.label}
          </button>
        ))}
        {accounts.length > 0 && (
          <select value={pending.accountId} onChange={e => setPending(p => ({ ...p, accountId: e.target.value }))}
            className="text-[11px] px-2 py-1 rounded-lg"
            style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}>
            <option value="all">{t('inbox:filters.allAccounts')}</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
          </select>
        )}
        <div className="w-px h-5 mx-0.5" style={{ background: 'var(--ds-border)' }} />
        <div className="flex items-center gap-1.5 text-[11px] shrink-0" style={{ color: 'var(--ds-text-muted)' }}>
          <span>{t('inbox:filters.from')}</span>
          <CalendarPopup value={pending.dateFrom} onChange={d => setPending(p => ({ ...p, dateFrom: d }))} placeholder={t('inbox:filters.datePlaceholder')} />
          <span>{t('inbox:filters.to')}</span>
          <CalendarPopup value={pending.dateTo} onChange={d => setPending(p => ({ ...p, dateTo: d }))} placeholder={t('inbox:filters.datePlaceholder')} />
        </div>
        <div className="relative flex-1 min-w-[160px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ds-text-muted)' }} />
          <input value={pending.search} onChange={e => setPending(p => ({ ...p, search: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') applyFilters(); }}
            placeholder={t('inbox:filters.searchPlaceholder')}
            className="w-full text-xs p-2 pl-8 rounded-lg ds-transition-colors"
            style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
        </div>
        <AppButton size="sm" icon={<Filter className="w-3.5 h-3.5" />} onClick={applyFilters}>
          {t('inbox:filters.apply')}
        </AppButton>
        {(applied.direction !== 'all' || applied.accountId !== 'all' || applied.dateFrom || applied.dateTo || applied.search) && (
          <button onClick={clearFilters} className="text-[11px] underline" style={{ color: 'var(--ds-accent)' }}>{t('inbox:filters.clearAll')}</button>
        )}
      </div>

      {archivedMatches > 0 && status !== 'archived' && applied.search && (
        <button onClick={() => { setStatus('archived'); setPage(0); }}
          className="w-full text-right flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
          style={{ background: 'rgba(139,92,246,0.1)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.25)' }}>
          <Archive className="w-3.5 h-3.5" />
          {t('inbox:archivedMatchesHint', { count: archivedMatches })}
        </button>
      )}

      {loading ? (
        <div className="flex items-center justify-center p-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--ds-accent)' }} /></div>
      ) : fetchError ? (
        <AppEmptyState icon={Mail} title={t('inbox:errors.loadFailed')} description={fetchError} />
      ) : messages.length === 0 ? (
        <AppEmptyState icon={Mail} title={t('inbox:empty.title')} description={t('inbox:empty.description')} />
      ) : (
        <div className="space-y-1">
          {messages.map(msg => {
            const attachments = msg.metadata?.attachments || [];
            const possibleMatches = msg.metadata?.possible_matches || [];
            return (
            <div key={msg.id} onClick={() => handleOpen(msg)}
              className="p-3 rounded-lg cursor-pointer ds-transition-colors"
              style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', borderRight: msg.case_id ? '3px solid #22c55e' : '3px solid #eab308' }}>
              <div className="flex items-start gap-2">
                <Mail className="w-4 h-4 shrink-0 mt-0.5" style={{ color: msg.is_read === false ? '#3b82f6' : 'var(--ds-text-muted)' }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }} title={t('inbox:message.idTooltip')}>#{msg.id}</span>
                    <span className="text-xs font-semibold" style={{ color: 'var(--ds-text-primary)' }}>{msg.sender || t('inbox:message.unknownSender')}</span>
                    <AppBadge variant={msg.direction === 'inbound' ? 'info' : 'success'} size="xs">{msg.direction === 'inbound' ? t('inbox:message.inbound') : t('inbox:message.outbound')}</AppBadge>
                    {msg.case_id && <AppBadge variant="success" size="xs">{t('inbox:message.linked', { id: msg.case_id })}</AppBadge>}
                    {msg.is_archived && <AppBadge variant="neutral" size="xs">{t('inbox:message.archived')}</AppBadge>}
                    {!msg.case_id && possibleMatches.length > 0 && (
                      <AppBadge variant="warning" size="xs"><AlertTriangle className="w-2.5 h-2.5 inline ml-0.5" />{t('inbox:message.possibleMatch', { count: possibleMatches.length })}</AppBadge>
                    )}
                  </div>
                  <div className="text-xs font-medium mb-0.5" style={{ color: 'var(--ds-text-primary)' }}>{msg.subject}</div>
                  <div className="text-[10px] flex items-center gap-2 flex-wrap" style={{ color: 'var(--ds-text-muted)' }}>
                    <span>{t('inbox:message.to', { recipient: msg.recipient })}</span>
                    <span>{formatMsgDateTime(msg.created_at, i18n.language)}</span>
                    {attachments.length > 0 && <span>📎 {attachments.length}</span>}
                    {msg.reviewed_by_name && (
                      <span className="flex items-center gap-0.5" style={{ color: '#22c55e' }}>
                        <CheckCircle2 className="w-3 h-3" />{t('inbox:message.reviewedBy', { name: msg.reviewed_by_name })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {!msg.reviewed_by_name && (
                    <button onClick={e => { e.stopPropagation(); handleReview(msg.id); }}
                      className="p-1 rounded" title={t('inbox:message.markReviewed')} style={{ color: 'var(--ds-text-muted)' }}>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={e => { e.stopPropagation(); window.open(`/inbox/message/${msg.id}`, '_blank', 'noopener,noreferrer'); }}
                    className="p-1 rounded" title={t('inbox:message.openInNewTab')} style={{ color: 'var(--ds-text-muted)' }}>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                  {!msg.case_id ? (
                    <button onClick={e => { e.stopPropagation(); const cid = prompt(t('inbox:message.linkPrompt')); if(cid) handleLink(msg.id, parseInt(cid), null); }}
                      className="p-1 rounded" title={t('inbox:message.linkToCase')} style={{ color: 'var(--ds-text-muted)' }}>
                      <Link2 className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button onClick={e => { e.stopPropagation(); handleUnlink(msg.id); }}
                      className="p-1 rounded" title={t('inbox:message.unlink')} style={{ color: 'var(--ds-text-muted)' }}>
                      <Unlink className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {msg.is_archived ? (
                    <button onClick={e => { e.stopPropagation(); handleUnarchive(msg.id); }}
                      className="p-1 rounded" title={t('inbox:message.unarchive')} style={{ color: 'var(--ds-text-muted)' }}>
                      <ArchiveRestore className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button onClick={e => { e.stopPropagation(); handleArchive(msg.id); }}
                      className="p-1 rounded" title={t('inbox:message.archive')} style={{ color: 'var(--ds-text-muted)' }}>
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={e => { e.stopPropagation(); handleDelete(msg.id); }}
                    className="p-1 rounded" title={t('inbox:message.delete')} style={{ color: '#ef4444' }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Confirmed-match reason -- previously a linked email showed
                  no explanation at all, so a wrong auto-link was
                  indistinguishable from a correct one. */}
              {msg.case_id && msg.match_reason && (
                <div className="mt-2 p-2 rounded text-[11px] flex items-center justify-between gap-2" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }} onClick={e => e.stopPropagation()}>
                  <span style={{ color: 'var(--ds-text-secondary)' }}>{t('inbox:message.matchReasonPrefix', { reason: msg.match_reason.label_ar })}</span>
                  {msg.match_reason.tier_key !== 'manual' && (
                    <button onClick={() => handleRejectMatch(msg.id)} className="px-2 py-0.5 rounded shrink-0 text-[10px]" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                      {t('inbox:message.rejectMatch')}
                    </button>
                  )}
                </div>
              )}

              {/* Ambiguous-match hint: the smart matcher found more than one
                  plausible case and deliberately did NOT auto-link, so the
                  user picks instead of risking a silent wrong link. */}
              {!msg.case_id && possibleMatches.length > 0 && (
                <div className="mt-2 p-2 rounded text-[11px]" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)' }} onClick={e => e.stopPropagation()}>
                  <p className="font-medium mb-1" style={{ color: '#eab308' }}>{t('inbox:message.ambiguousHint')}</p>
                  {possibleMatches.map((pm, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 py-0.5">
                      <span style={{ color: 'var(--ds-text-secondary)' }}>
                        {pm.source === 'ai' && <span style={{ color: 'var(--ds-accent)' }}>{t('inbox:message.aiSuggestion')}</span>}
                        {t('inbox:message.caseRef', { id: pm.caseId, reasons: (pm.reasons || []).join('، ') })}
                      </span>
                      <button onClick={() => handleLink(msg.id, pm.caseId, null)}
                        className="px-2 py-0.5 rounded shrink-0" style={{ background: 'var(--ds-accent)', color: 'white' }}>
                        {t('inbox:message.linkThis')}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Expanded message -- if this message belongs to a multi-message
                  thread, show the whole conversation (sent + received)
                  stacked chronologically instead of just this one row, so
                  it's clear which reply answered which message. */}
              {selected === msg.id && (
                <div className="mt-2 space-y-2" onClick={e => e.stopPropagation()}>
                  {(() => {
                    const thread = threadMsgs[msg.thread_id];
                    const siblings = thread ? thread.filter(m => m.id !== msg.id) : [];
                    if (siblings.length > 0) {
                      const all = [...siblings, msg].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
                      return (
                        <div className="space-y-1.5">
                          <div className="text-[10px] font-medium" style={{ color: 'var(--ds-text-muted)' }}>
                            {t('inbox:message.conversationCount', { count: all.length })}
                          </div>
                          {all.map(m => <ThreadMiniRow key={m.id} msg={m} isActive={m.id === msg.id} i18n={i18n} />)}
                        </div>
                      );
                    }
                    if (threadLoadingId === msg.id) {
                      return <div className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--ds-text-muted)' }}><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('inbox:message.loadingConversation')}</div>;
                    }
                    return <EmailBodyView html={msg.body_html} text={msg.body} />;
                  })()}
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {attachments.map((att, i) => (
                        <span key={i} className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-secondary)' }}>
                          <Paperclip className="w-3 h-3" />
                          {att.filename}{att.size != null && ` (${formatSize(att.size)})`}
                          {(att.driveFileId || att.storageKey) ? (
                            <button onClick={() => downloadAttachment(msg.id, i)} title={t('inbox:message.download')} style={{ color: 'var(--ds-accent)' }}>
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <span style={{ color: 'var(--ds-text-muted)' }}>{t('inbox:message.downloadUnavailable')}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );})}
        </div>
      )}

      {/* Pagination */}
      {!loading && !fetchError && total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-2 flex-wrap pt-1">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="p-1.5 rounded-lg disabled:opacity-40" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-secondary)' }}>
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="text-xs" style={{ color: 'var(--ds-text-muted)' }}>{t('inbox:pagination.pageOf', { page: page + 1, total: totalPages, count: total })}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
            className="p-1.5 rounded-lg disabled:opacity-40" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-secondary)' }}>
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1.5 mr-1">
            <span className="text-[11px]" style={{ color: 'var(--ds-text-muted)' }}>{t('inbox:pagination.goToPage')}</span>
            <input value={pageInput} onChange={e => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={e => { if (e.key === 'Enter') goToPage(); }}
              className="w-12 px-1.5 py-1 rounded-lg text-xs text-center"
              style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
            <button onClick={goToPage}
              className="px-2.5 py-1 rounded-lg text-xs font-medium" style={{ background: 'var(--ds-accent)', color: 'white' }}>
              {t('inbox:pagination.go')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// "معايير ربط الإيميلات" -- self-service control over mailPoller.js's
// matching heuristics, mirroring AIIntake.jsx's CriteriaAdminPanel pattern
// (list/toggle criteria) plus a second section for admin-added global
// keyword rules, since built-in tiers can only be toggled/relabeled (they
// map to real code paths) while custom rules are fully admin-managed.
function MatchingCriteriaPanel({ open, onClose }) {
  const { t } = useTranslation('inbox');
  const [criteria, setCriteria] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newKeyword, setNewKeyword] = useState('');
  const [newCaseId, setNewCaseId] = useState('');
  const [adding, setAdding] = useState(false);
  const [pendingTiers, setPendingTiers] = useState(() => new Set());
  const [pendingDeletes, setPendingDeletes] = useState(() => new Set());

  const fetchAll = () => {
    setLoading(true);
    Promise.all([api.get('/inbox/matching-criteria'), api.get('/inbox/matching-keywords')])
      .then(([c, k]) => { setCriteria(c.data || []); setKeywords(k.data || []); })
      .catch(e => alert(t('inbox:criteriaPanel.loadFailed', { message: e.message })))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (open) fetchAll(); }, [open]);

  const toggleCriterion = async (item) => {
    // Without this guard a rapid double-click/tap fired the same PUT twice
    // before the first response landed -- redundant but harmless here, still
    // the same missing-guard pattern as addKeyword below, so closed for
    // consistency.
    if (pendingTiers.has(item.tier_key)) return;
    setPendingTiers(prev => new Set(prev).add(item.tier_key));
    try { await api.put(`/inbox/matching-criteria/${item.tier_key}`, { is_active: !item.is_active }); fetchAll(); }
    catch (e) { alert(t('inbox:criteriaPanel.loadFailed', { message: e.message })); }
    finally { setPendingTiers(prev => { const next = new Set(prev); next.delete(item.tier_key); return next; }); }
  };

  const addKeyword = async () => {
    if (!newKeyword.trim() || !newCaseId || adding) return;
    setAdding(true);
    try {
      await api.post('/inbox/matching-keywords', { keyword_phrase: newKeyword.trim(), case_id: parseInt(newCaseId) });
      setNewKeyword(''); setNewCaseId(''); fetchAll();
    } catch (e) { alert(t('inbox:criteriaPanel.loadFailed', { message: e.message })); }
    finally { setAdding(false); }
  };

  const deleteKeyword = async (id) => {
    if (pendingDeletes.has(id) || !confirm(t('inbox:criteriaPanel.deleteConfirm'))) return;
    setPendingDeletes(prev => new Set(prev).add(id));
    try { await api.delete(`/inbox/matching-keywords/${id}`); fetchAll(); }
    catch (e) { alert(t('inbox:criteriaPanel.loadFailed', { message: e.message })); }
    finally { setPendingDeletes(prev => { const next = new Set(prev); next.delete(id); return next; }); }
  };

  return (
    <AppDialog open={open} onClose={onClose} title={t('inbox:criteriaPanel.title')} width="640px">
      {loading ? (
        <div className="flex items-center justify-center p-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--ds-accent)' }} /></div>
      ) : (
        <div className="space-y-5">
          <div>
            <p className="text-xs mb-2" style={{ color: 'var(--ds-text-muted)' }}>
              {t('inbox:criteriaPanel.explanation')}
            </p>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {/* c.label_ar/c.description are admin-authored backend content
                  (email_matching_criteria table) -- not UI chrome, so they
                  stay whatever language the admin wrote them in, same as
                  every other backend-sourced string in this phase. */}
              {criteria.map(c => (
                <div key={c.tier_key} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)', opacity: c.is_active ? 1 : 0.5 }}>
                  <div className="min-w-0">
                    <div className="text-sm" style={{ color: 'var(--ds-text-primary)' }}>{c.label_ar}</div>
                    <div className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>
                      {c.description} — ✅ {c.confirmed_count || 0} · ❌ {c.rejected_count || 0}
                    </div>
                  </div>
                  <button onClick={() => toggleCriterion(c)} disabled={pendingTiers.has(c.tier_key)} className="text-[11px] px-2 py-1 rounded-lg shrink-0 disabled:opacity-50" style={{ background: 'var(--ds-bg-secondary)', color: c.is_active ? '#22c55e' : 'var(--ds-text-muted)' }}>
                    {c.is_active ? t('inbox:criteriaPanel.active') : t('inbox:criteriaPanel.inactive')}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs mb-2 font-medium" style={{ color: 'var(--ds-text-primary)' }}>{t('inbox:criteriaPanel.customKeywords')}</p>
            <p className="text-[11px] mb-2" style={{ color: 'var(--ds-text-muted)' }}>{t('inbox:criteriaPanel.customKeywordsHint')}</p>
            <div className="flex gap-2 mb-2">
              <input value={newKeyword} onChange={e => setNewKeyword(e.target.value)} placeholder={t('inbox:criteriaPanel.keywordPlaceholder')}
                className="flex-1 px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
              <input value={newCaseId} onChange={e => setNewCaseId(e.target.value)} placeholder={t('inbox:criteriaPanel.caseIdPlaceholder')} type="number"
                className="w-28 px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
              <AppButton size="sm" onClick={addKeyword} disabled={adding} loading={adding}>{t('inbox:criteriaPanel.add')}</AppButton>
            </div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {keywords.map(k => (
                <div key={k.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)' }}>
                  <span className="text-xs" style={{ color: 'var(--ds-text-primary)' }}>"{k.keyword_phrase}" ← {t('inbox:message.caseLabel', { id: k.case_id })}{k.case_title ? ` (${k.case_title})` : ''}</span>
                  <button onClick={() => deleteKeyword(k.id)} disabled={pendingDeletes.has(k.id)} className="p-1 rounded-lg shrink-0 disabled:opacity-50" style={{ color: 'var(--ds-text-muted)' }}
                    onMouseOver={e => e.currentTarget.style.color = '#ef4444'} onMouseOut={e => e.currentTarget.style.color = 'var(--ds-text-muted)'}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {keywords.length === 0 && <p className="text-[11px] text-center py-2" style={{ color: 'var(--ds-text-muted)' }}>{t('inbox:criteriaPanel.noKeywords')}</p>}
            </div>
          </div>
        </div>
      )}
    </AppDialog>
  );
}
