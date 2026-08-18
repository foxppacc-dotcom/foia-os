import { api } from '../../../api';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Plus, Trash2, Mail, Phone, Globe, MapPin, UserPlus, XCircle, CheckCircle, AlertTriangle, CalendarClock, History, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCaseContext } from '../context/CaseContext';
import { useRequests } from '../../request/hooks/useRequests';
import { classifyRequest } from '../../request/services/requestApi';
import { getStatusBadge, filterUnusedAgencies, formatAgencyLocation } from '../../request/utils';
import AppSection from '../../../components/ds/AppSection';
import AppButton from '../../../components/ds/AppButton';
import AppSelect from '../../../components/ds/AppSelect';
import AppBadge from '../../../components/ds/AppBadge';
import AppEmptyState from '../../../components/ds/AppEmptyState';

const AGENCY_TYPES = [
  { value: '', label: 'اختر النوع' },
  { value: 'federal', label: 'فيدرالي' },
  { value: 'state', label: 'ولاية' },
  { value: 'municipal', label: 'بلدية' },
  { value: 'sheriff', label: 'شريف' },
];

const BLANK_AGENCY = { name_en: '', name_ar: '', state: '', city: '', type: '', email: '', phone: '', portal_url: '', website: '', tracking_portal_url: '' };

const CLASS_OPTIONS = [
  { value: 'arrest', label: 'جهة قبض' },
  { value: 'investigation', label: 'جهة تحقيق' },
  { value: 'both', label: 'قبض وتحقيق' },
];

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.toLocaleDateString('ar-SA')} ${d.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}`;
}

// One agency's full card: basic info + channels + requests + a SINGLE unified
// correspondence feed for everything ever sent/received/logged with this
// agency on this case -- previously this same history was nested one level
// deeper, per-request, so reviewing "what's happened with this agency"
// meant opening every request separately. Split out of the old single
// 429-line AgenciesTab.jsx so this section can be reasoned about on its own.
function AgencyCard({
  agency, reqs, channels, emailAccounts, agencyLog,
  showChannelForm, newChannel, setNewChannel, setShowChannelForm, addChannel, removeChannel,
  showPortalForm, setShowPortalForm, portalForm, setPortalForm, logPortalSubmission,
  setClassification, acknowledgeOverdue, handleRemove, navigate,
}) {
  const firstReq = reqs[0];
  const key = agency?.id || firstReq.agency_id || firstReq.id;
  const openReqs = reqs.filter(r => r.status !== 'closed').length;
  const closedReqs = reqs.filter(r => r.status === 'closed').length;
  const defaultAccount = (emailAccounts || []).find(a => String(a.id) === String(agency?.default_email_account_id));
  const location = formatAgencyLocation(agency);
  const todayStr = new Date().toISOString().split('T')[0];

  return (
    <div className="shrink-0 flex flex-col rounded-lg" style={{ width: '340px', background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)' }}>
      {/* Header — always visible, no expand/collapse anymore: the whole
          point of this redesign is seeing an agency's info + correspondence
          at a glance, not behind a click. */}
      <div className="p-3 rounded-t-lg" style={{ background: 'var(--ds-bg-secondary)', borderBottom: '1px solid var(--ds-border)' }}>
        <div className="flex items-start gap-2.5">
          <Building2 className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--ds-accent)' }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm font-semibold truncate" style={{ color: 'var(--ds-text-primary)' }}>{agency?.name_ar || agency?.name_en || 'جهة'}</span>
            </div>
            {agency?.name_ar && agency?.name_en && <div className="text-[10px] truncate" style={{ color: 'var(--ds-text-muted)' }}>{agency.name_en}</div>}
            <div className="flex items-center gap-2 text-[10px] flex-wrap mt-0.5" style={{ color: 'var(--ds-text-muted)' }}>
              {location && <span><MapPin className="w-3 h-3 inline" /> {location}</span>}
              <span>· {openReqs} مفتوح</span>
              <span>· {closedReqs} مغلق</span>
            </div>
          </div>
          <button onClick={() => handleRemove(firstReq.id)} title="إزالة الجهة من القضية" className="p-1 shrink-0" style={{ color: 'var(--ds-text-muted)' }}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3 overflow-y-auto" style={{ maxHeight: '520px' }}>
        {/* Real agency details */}
        <div className="grid grid-cols-1 gap-y-1 text-[11px] p-2.5 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', color: 'var(--ds-text-secondary)' }}>
          {agency?.type && <span>النوع: {AGENCY_TYPES.find(t => t.value === agency.type)?.label || agency.type}</span>}
          {agency?.phone && <span><Phone className="w-3 h-3 inline" /> {agency.phone}</span>}
          {agency?.email && <span><Mail className="w-3 h-3 inline" /> {agency.email}</span>}
          {agency?.address && <span><MapPin className="w-3 h-3 inline" /> {agency.address}</span>}
          {agency?.portal_url && <a href={agency.portal_url} target="_blank" rel="noreferrer" style={{ color: '#3b82f6' }}><Globe className="w-3 h-3 inline" /> بوابة الطلبات</a>}
          {agency?.website && <a href={agency.website} target="_blank" rel="noreferrer" style={{ color: '#3b82f6' }}><Globe className="w-3 h-3 inline" /> الموقع الرسمي</a>}
          {agency?.tracking_portal_url && <a href={agency.tracking_portal_url} target="_blank" rel="noreferrer" style={{ color: '#3b82f6' }}><Globe className="w-3 h-3 inline" /> متابعة الطلب</a>}
          {agency?.reply_to && <span>الرد على: {agency.reply_to}</span>}
          {defaultAccount && <span><Mail className="w-3 h-3 inline" /> حساب الإرسال: {defaultAccount.email}</span>}
        </div>

        {/* Communication channels */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--ds-text-muted)' }}>بيانات التواصل ({(channels[agency?.id] || []).length})</span>
            <button onClick={() => setShowChannelForm(p => ({ ...p, [agency.id]: true }))}
              className="text-[10px] px-2 py-0.5 rounded" style={{ color: '#3b82f6', background: 'rgba(59,130,246,0.1)' }}>
              <UserPlus className="w-3 h-3 inline" /> إضافة</button>
          </div>
          {showChannelForm[agency?.id] && (
            <div className="p-2 mb-1 rounded-lg space-y-1" style={{ background: 'var(--ds-bg-tertiary)', border: '1px dashed var(--ds-border)' }}>
              <input placeholder="رابط البوابة" value={newChannel[agency.id]?.portal_link || ''} onChange={e => setNewChannel(p => ({ ...p, [agency.id]: { ...p[agency.id], portal_link: e.target.value } }))}
                className="w-full px-2 py-1 rounded text-[11px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
              <input placeholder="البريد الإلكتروني" value={newChannel[agency.id]?.email || ''} onChange={e => setNewChannel(p => ({ ...p, [agency.id]: { ...p[agency.id], email: e.target.value } }))}
                className="w-full px-2 py-1 rounded text-[11px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
              <textarea placeholder="كلمات تساعد الفلتر في ربط الإيميل بالقضية"
                value={newChannel[agency.id]?.filter_keywords || ''} onChange={e => setNewChannel(p => ({ ...p, [agency.id]: { ...p[agency.id], filter_keywords: e.target.value } }))}
                rows={2} className="w-full px-2 py-1 rounded text-[11px] resize-none" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
              <div className="flex gap-1.5 pt-0.5">
                <AppButton size="sm" onClick={() => addChannel(agency.id)}><CheckCircle className="w-3.5 h-3.5" />حفظ</AppButton>
                <AppButton size="sm" variant="secondary" onClick={() => setShowChannelForm(p => ({ ...p, [agency.id]: false }))}>إلغاء</AppButton>
              </div>
            </div>
          )}
          <div className="space-y-1">
            {(channels[agency?.id] || []).map(ch => (
              <div key={ch.id} className="flex items-center gap-1.5 p-1.5 rounded-lg text-[11px]" style={{ background: 'var(--ds-bg-tertiary)' }}>
                <Mail className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ds-text-muted)' }} />
                <div className="flex-1 min-w-0">
                  {ch.email && <span className="font-medium" style={{ color: 'var(--ds-text-primary)' }}>{ch.email}</span>}
                  {ch.portal_link && <a href={ch.portal_link} target="_blank" rel="noreferrer" className="mr-1" style={{ color: '#3b82f6' }}>· رابط البوابة</a>}
                  {ch.filter_keywords && <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--ds-text-muted)' }}>كلمات الفلترة: {ch.filter_keywords}</div>}
                </div>
                <button onClick={() => removeChannel(agency.id, ch.id)} className="p-0.5 shrink-0" style={{ color: 'var(--ds-text-muted)' }}>
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Requests — status/classification/portal-log actions per request;
            correspondence itself moved out of here into the unified feed below. */}
        <div>
          <span className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--ds-text-muted)' }}>الطلبات ({reqs.length})</span>
          <div className="space-y-1.5">
            {reqs.map(req => {
              const rBadge = getStatusBadge(req.status);
              const isLate = !!(req.expected_response_date && req.expected_response_date < todayStr && !req.response_date);
              const isAcked = isLate && !!req.overdue_ack_by;
              const isPortalFormOpen = showPortalForm[req.id];
              return (
                <div key={req.id} className="p-2 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', borderRight: isLate && !isAcked ? '3px solid #ef4444' : '3px solid transparent' }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: 'var(--ds-accent)', color: 'white' }}>#{req.id}</div>
                    {req.reference_number && <span className="text-[10px] truncate" style={{ color: 'var(--ds-text-muted)' }}>مرجع: {req.reference_number}</span>}
                    <AppBadge variant={rBadge.variant}>{rBadge.text}</AppBadge>
                    {isLate && !isAcked && <AlertTriangle className="w-3.5 h-3.5" style={{ color: '#ef4444' }} />}
                  </div>
                  <select value={req.agency_classification || ''} onChange={e => setClassification(req.id, e.target.value || null)}
                    className="w-full px-2 py-1 rounded text-[11px] font-medium mb-1.5" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}>
                    <option value="">— غير محدد —</option>
                    {CLASS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {isLate && !isAcked && (
                    <div className="flex items-center justify-between gap-1.5 mb-1.5 text-[10px] px-2 py-1 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                      <span>تخطّى الموعد المتوقع ({req.expected_response_date})</span>
                      <button onClick={() => acknowledgeOverdue(req.id)} className="px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--ds-bg-secondary)', color: '#ef4444' }}>تم الاطلاع</button>
                    </div>
                  )}
                  {isAcked && (
                    <div className="flex items-center gap-1 mb-1.5 text-[10px] px-2 py-1 rounded-lg flex-wrap" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-muted)' }}>
                      <CheckCircle className="w-3.5 h-3.5" /> تم الاطلاع من{' '}
                      <button onClick={() => navigate(`/profile/${req.overdue_ack_user?.id}`)} className="underline" style={{ color: 'var(--ds-accent)' }}>
                        {req.overdue_ack_user?.name || 'مستخدم'}
                      </button>
                    </div>
                  )}
                  {!isLate && req.expected_response_date && (
                    <div className="flex items-center gap-1 mb-1.5 text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>
                      <CalendarClock className="w-3.5 h-3.5" /> موعد الرد المتوقع: {req.expected_response_date}
                    </div>
                  )}
                  <button onClick={() => setShowPortalForm(p => ({ ...p, [req.id]: !p[req.id] }))} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg" style={{ background: 'rgba(139,92,246,0.1)', color: '#8b5cf6' }}>
                    <Globe className="w-3 h-3" />تسجيل تقديم عبر البوابة</button>
                  {isPortalFormOpen && (
                    <div className="mt-1.5 p-2 rounded-lg space-y-1.5" style={{ background: 'var(--ds-bg-tertiary)', border: '1px dashed var(--ds-border)' }}>
                      <input type="number" min="1" max="30" placeholder="مهلة الرد (أيام)"
                        value={portalForm[req.id]?.expected_response_days ?? ''}
                        onChange={e => setPortalForm(p => ({ ...p, [req.id]: { ...p[req.id], expected_response_days: e.target.value } }))}
                        className="w-full px-2 py-1 rounded text-[11px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                      <input placeholder="رقم تأكيد التقديم (اختياري)" value={portalForm[req.id]?.confirmation_number || ''} onChange={e => setPortalForm(p => ({ ...p, [req.id]: { ...p[req.id], confirmation_number: e.target.value } }))}
                        className="w-full px-2 py-1 rounded text-[11px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                      <input placeholder="ملاحظة (اختياري)" value={portalForm[req.id]?.note || ''} onChange={e => setPortalForm(p => ({ ...p, [req.id]: { ...p[req.id], note: e.target.value } }))}
                        className="w-full px-2 py-1 rounded text-[11px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                      <div className="flex gap-1.5 justify-end pt-0.5">
                        <AppButton size="sm" variant="secondary" onClick={() => setShowPortalForm(p => ({ ...p, [req.id]: false }))}>إلغاء</AppButton>
                        <AppButton size="sm" onClick={() => logPortalSubmission(req.id, agency?.id)}><CheckCircle className="w-3.5 h-3.5" />تسجيل</AppButton>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Unified correspondence -- every message/log tied to THIS agency for
            this case, newest first, instead of split per-request. Portal
            submissions land here too since they're logged as their own
            communications row (documentCenter.js's portal-log route). */}
        <div>
          <div className="text-[11px] font-semibold mb-1 flex items-center gap-1.5" style={{ color: 'var(--ds-text-muted)' }}>
            <History className="w-3.5 h-3.5" /> كل المراسلات مع هذه الجهة ({agencyLog.length})
          </div>
          {agencyLog.length === 0 ? (
            <p className="text-[11px]" style={{ color: 'var(--ds-text-muted)' }}>لا توجد مراسلات مسجلة بعد</p>
          ) : (
            <div className="space-y-1">
              {agencyLog.map(c => {
                const relatedReq = reqs.find(r => r.id === c.request_id);
                const isInbound = c.direction === 'inbound';
                return (
                  <div key={c.id} onClick={() => window.open(`/inbox/message/${c.id}`, '_blank', 'noopener,noreferrer')}
                    title="فتح الرسالة"
                    className="text-[11px] p-2 rounded-lg cursor-pointer ds-transition-colors"
                    style={{ background: 'var(--ds-bg-tertiary)', borderRight: isInbound ? '3px solid #22c55e' : '3px solid #3b82f6' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate" style={{ color: 'var(--ds-text-primary)' }}>
                        {c.type === 'portal' ? '🌐' : c.type === 'email' ? '📧' : '📄'} {c.subject || '—'}
                        {relatedReq && <span className="mr-1 font-normal" style={{ color: 'var(--ds-text-muted)' }}>· #{relatedReq.id}</span>}
                      </span>
                      <span className="shrink-0" style={{ color: 'var(--ds-text-muted)' }}>{formatDateTime(c.created_at)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="shrink-0 px-1 rounded text-[9px] font-medium" style={{ background: isInbound ? 'rgba(34,197,94,0.12)' : 'rgba(59,130,246,0.12)', color: isInbound ? '#22c55e' : '#3b82f6' }}>
                        {isInbound ? 'وارد' : 'صادر'}
                      </span>
                      {c.body && <span className="line-clamp-1" style={{ color: 'var(--ds-text-secondary)' }}>{c.body}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AgenciesTab() {
  const navigate = useNavigate();
  const { id, requests, allAgencies, refetch, channels: caseChannels } = useCaseContext();
  const { showAdd, setShowAdd, selectedAgencyId, setSelectedAgencyId, handleAdd, handleRemove } = useRequests(id, refetch);
  const [extraAgencies, setExtraAgencies] = useState([]);
  const unusedAgencies = filterUnusedAgencies([...(allAgencies || []), ...extraAgencies], requests);
  const [emailAccounts, setEmailAccounts] = useState([]);
  const [newChannel, setNewChannel] = useState({});
  const [showChannelForm, setShowChannelForm] = useState({});
  const [showNewAgencyForm, setShowNewAgencyForm] = useState(false);
  const [newAgency, setNewAgency] = useState(BLANK_AGENCY);
  const [savingAgency, setSavingAgency] = useState(false);
  const [showPortalForm, setShowPortalForm] = useState({});
  const [portalForm, setPortalForm] = useState({});
  const [commRecords, setCommRecords] = useState([]);
  const [commRecordsError, setCommRecordsError] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    api.get('/email-accounts').then(d => setEmailAccounts(d.data || d.accounts || [])).catch(() => {});
  }, []);

  const fetchThreads = () => {
    // A failed fetch previously left commRecords at [] silently -- every
    // agency card's "كل المراسلات مع هذه الجهة" feed would then show "لا
    // توجد مراسلات مسجلة بعد" (no correspondence recorded), indistinguishable
    // from a genuinely quiet agency instead of a load failure.
    api.get(`/cases/${id}/threads`).then(d => { setCommRecords(d.threads || []); setCommRecordsError(''); })
      .catch(e => setCommRecordsError(e.message || 'تعذر تحميل المراسلات'));
  };
  useEffect(() => { fetchThreads(); }, [id, requests]);

  const grouped = useMemo(() => {
    const map = {};
    (requests || []).forEach(r => {
      const key = r.agencies?.id || r.agency_id || r.id;
      if (!map[key]) map[key] = { agency: r.agencies, requests: [] };
      map[key].requests.push(r);
    });
    return Object.values(map);
  }, [requests]);

  const channels = useMemo(() => {
    const map = {};
    (caseChannels || []).forEach(ch => { (map[ch.agency_id] ||= []).push(ch); });
    return map;
  }, [caseChannels]);

  // Matches by agency_id (now reliably stamped on every send/receive, see
  // documentCenter.js) OR by request_id falling under this agency's own
  // requests -- keeps older rows that predate agency_id being saved
  // correctly attributed too.
  const getAgencyLog = (agencyId, reqIds) => (commRecords || [])
    .filter(c => c.agency_id === agencyId || (c.request_id && reqIds.includes(c.request_id)))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const createAgencyInline = async () => {
    if (!newAgency.name_en.trim()) return alert('الاسم بالإنجليزية مطلوب');
    setSavingAgency(true);
    try {
      const created = await api.createAgency(newAgency);
      const newId = created.id;
      setExtraAgencies(p => [...p, { ...newAgency, id: newId }]);
      setNewAgency(BLANK_AGENCY);
      setShowNewAgencyForm(false);
      await handleAdd(newId);
    } catch (e) { alert('❌ ' + e.message); }
    setSavingAgency(false);
  };

  const addChannel = async (agencyId) => {
    const c = newChannel[agencyId];
    if (!c?.portal_link && !c?.email && !c?.filter_keywords) return;
    try {
      await api.post(`/cases/${id}/agencies/${agencyId}/channels`, c);
      setNewChannel(p => ({ ...p, [agencyId]: {} }));
      setShowChannelForm(p => ({ ...p, [agencyId]: false }));
      refetch?.(true);
    } catch (e) { alert('❌ ' + e.message); }
  };

  const removeChannel = async (agencyId, channelId) => {
    try { await api.delete(`/cases/${id}/agencies/${agencyId}/channels/${channelId}`); refetch?.(true); }
    catch (e) { alert('❌ ' + e.message); }
  };

  const setClassification = async (reqId, value) => {
    try { await classifyRequest(id, reqId, value); refetch?.(true); }
    catch (e) { alert('❌ ' + e.message); }
  };

  const acknowledgeOverdue = async (reqId) => {
    try { await api.post(`/requests/${reqId}/acknowledge-overdue`); refetch?.(true); }
    catch (e) { alert('❌ فشل تسجيل الاطلاع: ' + e.message); }
  };

  const [rescanning, setRescanning] = useState(false);
  const runRescan = async () => {
    setRescanning(true);
    try {
      const r = await api.post('/cases/rescan-unmatched');
      alert(r.linked > 0 ? `✅ تم ربط ${r.linked} رسالة من أصل ${r.scanned} رسالة غير مرتبطة تمت مراجعتها` : `لم يتم العثور على تطابقات جديدة (تمت مراجعة ${r.scanned} رسالة غير مرتبطة)`);
      if (r.linked > 0) refetch?.(true);
    } catch (e) { alert('❌ ' + e.message); }
    setRescanning(false);
  };

  const logPortalSubmission = async (reqId, agencyId) => {
    const form = portalForm[reqId] || {};
    const days = Math.min(30, Math.max(1, parseInt(form.expected_response_days) || 20));
    try {
      await api.post(`/cases/${id}/portal-log`, {
        agency_id: agencyId, request_id: reqId,
        note: form.note || '', confirmation_number: form.confirmation_number || '',
        expected_response_days: days,
      });
      setPortalForm(p => ({ ...p, [reqId]: {} }));
      setShowPortalForm(p => ({ ...p, [reqId]: false }));
      refetch?.(true);
    } catch (e) { alert('❌ ' + e.message); }
  };

  const scrollBy = (dx) => scrollRef.current?.scrollBy({ left: dx, behavior: 'smooth' });

  return (
    <AppSection title={'الجهات (' + (grouped?.length || 0) + ')'}
      actions={<>
        {grouped.length > 3 && (
          <div className="flex gap-1">
            <AppButton size="sm" variant="secondary" onClick={() => scrollBy(-360)}><ChevronRight className="w-3.5 h-3.5" /></AppButton>
            <AppButton size="sm" variant="secondary" onClick={() => scrollBy(360)}><ChevronLeft className="w-3.5 h-3.5" /></AppButton>
          </div>
        )}
        <AppButton size="sm" variant="secondary" disabled={rescanning} onClick={runRescan} title="إعادة فحص الرسائل الواردة غير المرتبطة بناءً على بيانات القضية والجهات الحالية">
          {rescanning ? 'جارٍ الفحص...' : 'إعادة فحص الرسائل غير المرتبطة'}
        </AppButton>
        <AppButton size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowAdd(!showAdd)}>إضافة</AppButton>
      </>}>
      {commRecordsError && (
        <div className="flex items-center justify-between gap-2 mb-3 px-2.5 py-1.5 rounded-lg text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
          <span>⚠️ تعذر تحميل سجل المراسلات: {commRecordsError}</span>
          <button onClick={fetchThreads} className="underline shrink-0 font-medium">إعادة المحاولة</button>
        </div>
      )}
      {showAdd && (
        <div className="space-y-2 mb-3 p-2.5 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)', border: '1px dashed var(--ds-border)' }}>
          <div className="flex items-center gap-2">
            <AppSelect value={selectedAgencyId} onChange={e => setSelectedAgencyId(e.target.value)}
              placeholder="اختر جهة..."
              options={unusedAgencies.map(a => ({ value: String(a.id), label: `${a.name_en}${formatAgencyLocation(a) ? ' (' + formatAgencyLocation(a) + ')' : ''}` }))}
              className="flex-1" />
            <AppButton size="sm" disabled={!selectedAgencyId} onClick={() => handleAdd(parseInt(selectedAgencyId))}>إضافة</AppButton>
          </div>
          <button onClick={() => setShowNewAgencyForm(s => !s)} className="text-[10px]" style={{ color: '#3b82f6' }}>
            {showNewAgencyForm ? 'إلغاء تسجيل جهة جديدة' : '+ الجهة غير موجودة؟ سجّل جهة جديدة'}
          </button>

          {showNewAgencyForm && (
            <div className="p-2.5 rounded-lg space-y-1.5" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                <input placeholder="English Name *" value={newAgency.name_en} onChange={e => setNewAgency(f => ({ ...f, name_en: e.target.value }))}
                  className="px-2 py-1.5 rounded text-[11px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                <input placeholder="الاسم بالعربية" value={newAgency.name_ar} onChange={e => setNewAgency(f => ({ ...f, name_ar: e.target.value }))}
                  className="px-2 py-1.5 rounded text-[11px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                <select value={newAgency.type} onChange={e => setNewAgency(f => ({ ...f, type: e.target.value }))}
                  className="px-2 py-1.5 rounded text-[11px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}>
                  {AGENCY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <input placeholder="الولاية" value={newAgency.state} onChange={e => setNewAgency(f => ({ ...f, state: e.target.value }))}
                  className="px-2 py-1.5 rounded text-[11px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                <input placeholder="المدينة" value={newAgency.city} onChange={e => setNewAgency(f => ({ ...f, city: e.target.value }))}
                  className="px-2 py-1.5 rounded text-[11px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                <input placeholder="البريد الإلكتروني" value={newAgency.email} onChange={e => setNewAgency(f => ({ ...f, email: e.target.value }))}
                  className="px-2 py-1.5 rounded text-[11px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                <input placeholder="الهاتف" value={newAgency.phone} onChange={e => setNewAgency(f => ({ ...f, phone: e.target.value }))}
                  className="px-2 py-1.5 rounded text-[11px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                <input placeholder="رابط البوابة (Portal URL)" value={newAgency.portal_url} onChange={e => setNewAgency(f => ({ ...f, portal_url: e.target.value }))}
                  className="px-2 py-1.5 rounded text-[11px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                <input placeholder="الموقع الرسمي (Website)" value={newAgency.website} onChange={e => setNewAgency(f => ({ ...f, website: e.target.value }))}
                  className="px-2 py-1.5 rounded text-[11px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
              </div>
              <div className="flex gap-1.5 justify-end pt-0.5">
                <AppButton size="sm" variant="secondary" onClick={() => setShowNewAgencyForm(false)}>إلغاء</AppButton>
                <AppButton size="sm" disabled={savingAgency} onClick={createAgencyInline}>{savingAgency ? 'جارٍ الحفظ...' : 'تسجيل وإضافة للقضية'}</AppButton>
              </div>
            </div>
          )}
        </div>
      )}

      {grouped?.length > 0 ? (
        <div ref={scrollRef} className="flex gap-3 overflow-x-auto pb-1" style={{ scrollSnapType: 'x proximity' }}>
          {grouped.map(group => {
            const agency = group.agency;
            const reqs = group.requests;
            const key = agency?.id || reqs[0].agency_id || reqs[0].id;
            const reqIds = reqs.map(r => r.id);
            return (
              <div key={key} style={{ scrollSnapAlign: 'start' }}>
                <AgencyCard
                  agency={agency} reqs={reqs} channels={channels} emailAccounts={emailAccounts}
                  agencyLog={getAgencyLog(agency?.id, reqIds)}
                  showChannelForm={showChannelForm} newChannel={newChannel} setNewChannel={setNewChannel} setShowChannelForm={setShowChannelForm}
                  addChannel={addChannel} removeChannel={removeChannel}
                  showPortalForm={showPortalForm} setShowPortalForm={setShowPortalForm} portalForm={portalForm} setPortalForm={setPortalForm}
                  logPortalSubmission={logPortalSubmission}
                  setClassification={setClassification} acknowledgeOverdue={acknowledgeOverdue}
                  handleRemove={handleRemove} navigate={navigate}
                />
              </div>
            );
          })}
        </div>
      ) : <AppEmptyState compact icon={Building2} title="لم تضف جهات" description="أضف الجهات لمتابعة التواصل" />}
    </AppSection>
  );
}
