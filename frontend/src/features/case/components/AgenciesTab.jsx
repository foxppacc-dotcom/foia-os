import { api } from '../../../api';
import { useState, useEffect, useMemo } from 'react';
import { Building2, Plus, Trash2, Mail, Phone, Globe, MapPin, Send, ChevronDown, ChevronUp, User, UserPlus, XCircle, RefreshCw, CheckCircle, AlertTriangle, Gavel, Search, CalendarClock } from 'lucide-react';
import { useCaseContext } from '../context/CaseContext';
import { useRequests } from '../../request/hooks/useRequests';
import { classifyRequest } from '../../request/services/requestApi';
import { getStatusBadge, filterUnusedAgencies, formatAgencyLocation } from '../../request/utils';
import AppSection from '../../../components/ds/AppSection';
import AppButton from '../../../components/ds/AppButton';
import AppSelect from '../../../components/ds/AppSelect';
import AppBadge from '../../../components/ds/AppBadge';
import AppEmptyState from '../../../components/ds/AppEmptyState';
import AppStack from '../../../components/ds/AppStack';

const AGENCY_TYPES = [
  { value: '', label: 'اختر النوع' },
  { value: 'federal', label: 'فيدرالي' },
  { value: 'state', label: 'ولاية' },
  { value: 'municipal', label: 'بلدية' },
  { value: 'sheriff', label: 'شريف' },
];

const BLANK_AGENCY = { name_en: '', name_ar: '', state: '', city: '', type: '', email: '', phone: '', portal_url: '', website: '', tracking_portal_url: '' };

const CLASS_OPTIONS = [
  { value: 'arrest', label: 'جهة قبض', icon: Gavel },
  { value: 'investigation', label: 'جهة تحقيق', icon: Search },
  { value: 'both', label: 'قبض وتحقيق', icon: Building2 },
];

const DEADLINE_OPTIONS = [
  { value: '3', label: '3 أيام' },
  { value: '7', label: '7 أيام' },
  { value: '14', label: '14 يوم' },
  { value: '20', label: '20 يوم' },
  { value: '30', label: '30 يوم' },
];

function parseAgencyContacts(notes) {
  if (!notes) return [];
  try { const parsed = JSON.parse(notes); return parsed._contacts || []; } catch { return []; }
}

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.toLocaleDateString('ar-SA')} ${d.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}`;
}

export default function AgenciesTab() {
  const { id, requests, allAgencies, refetch } = useCaseContext();
  const { showAdd, setShowAdd, selectedAgencyId, setSelectedAgencyId, handleAdd, handleRemove } = useRequests(id, refetch);
  const [extraAgencies, setExtraAgencies] = useState([]);
  const unusedAgencies = filterUnusedAgencies([...(allAgencies || []), ...extraAgencies], requests);
  const [emailAccounts, setEmailAccounts] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [newContact, setNewContact] = useState({});
  const [showContactForm, setShowContactForm] = useState({});
  const [showNewAgencyForm, setShowNewAgencyForm] = useState(false);
  const [newAgency, setNewAgency] = useState(BLANK_AGENCY);
  const [savingAgency, setSavingAgency] = useState(false);
  const [showPortalForm, setShowPortalForm] = useState({});
  const [portalForm, setPortalForm] = useState({});

  useEffect(() => {
    api.get('/email-accounts').then(d => setEmailAccounts(d.data || d.accounts || [])).catch(() => {});
  }, []);

  const grouped = useMemo(() => {
    const map = {};
    (requests || []).forEach(r => {
      const key = r.agencies?.id || r.agency_id || r.id;
      if (!map[key]) map[key] = { agency: r.agencies, requests: [] };
      map[key].requests.push(r);
    });
    return Object.values(map);
  }, [requests]);

  const toggleExpand = (key) => setExpanded(p => ({ ...p, [key]: !p[key] }));

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

  const addContact = async (agencyId) => {
    const c = newContact[agencyId];
    if (!c?.name) return;
    try {
      await api.post(`/agencies/${agencyId}/contacts`, c);
      setNewContact(p => ({ ...p, [agencyId]: {} }));
      setShowContactForm(p => ({ ...p, [agencyId]: false }));
      refetch?.(true);
    } catch (e) { alert('❌ ' + e.message); }
  };

  const removeContact = async (agencyId, contactId) => {
    try { await api.delete(`/agencies/${agencyId}/contacts/${contactId}`); refetch?.(true); }
    catch (e) { alert('❌ ' + e.message); }
  };

  const quickAction = async (reqId, status) => {
    try { await api.put(`/requests/${reqId}/status`, { status }); refetch?.(true); }
    catch (e) { alert('❌ ' + e.message); }
  };

  const setClassification = async (reqId, value) => {
    try { await classifyRequest(id, reqId, value); refetch?.(true); }
    catch (e) { alert('❌ ' + e.message); }
  };

  const logPortalSubmission = async (reqId, agencyId) => {
    const form = portalForm[reqId] || {};
    try {
      await api.post(`/cases/${id}/portal-log`, {
        agency_id: agencyId, request_id: reqId,
        note: form.note || '', confirmation_number: form.confirmation_number || '',
        expected_response_days: form.expected_response_days || '20',
      });
      setPortalForm(p => ({ ...p, [reqId]: {} }));
      setShowPortalForm(p => ({ ...p, [reqId]: false }));
      refetch?.(true);
    } catch (e) { alert('❌ ' + e.message); }
  };

  return (
    <AppSection title={'الجهات (' + (grouped?.length || 0) + ')'}
      actions={<AppButton size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowAdd(!showAdd)}>إضافة</AppButton>}>
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
        <AppStack gap="6px">
          {grouped.map(group => {
            const agency = group.agency;
            const reqs = group.requests;
            const firstReq = reqs[0];
            const key = agency?.id || firstReq.agency_id || firstReq.id;
            const isExpanded = expanded[key];
            const openReqs = reqs.filter(r => r.status !== 'closed').length;
            const closedReqs = reqs.filter(r => r.status === 'closed').length;
            const agencyContacts = parseAgencyContacts(agency?.notes);
            const defaultAccount = (emailAccounts || []).find(a => String(a.id) === String(agency?.default_email_account_id));
            const location = formatAgencyLocation(agency);

            return (
              <div key={key}>
                {/* Agency Card */}
                <div onClick={() => toggleExpand(key)}
                  className="p-3 rounded-lg cursor-pointer ds-transition-colors"
                  style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
                  <div className="flex items-start gap-3">
                    <Building2 className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--ds-accent)' }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>{agency?.name_ar || agency?.name_en || 'جهة'}</span>
                        {agency?.name_ar && agency?.name_en && <span className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>{agency.name_en}</span>}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] flex-wrap" style={{ color: 'var(--ds-text-muted)' }}>
                        {location && <span><MapPin className="w-3 h-3 inline" /> {location}</span>}
                        <span>· {openReqs} مفتوح</span>
                        <span>· {closedReqs} مغلق</span>
                        {agency?.email && <span>· <Mail className="w-3 h-3 inline" /> {agency.email}</span>}
                      </div>
                    </div>
                    <button className="p-1" style={{ color: 'var(--ds-text-muted)' }}>
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="p-3 rounded-b-lg space-y-3" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', borderTop: 'none' }}>
                    {/* Real agency details */}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] p-2 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', color: 'var(--ds-text-secondary)' }}>
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

                    {/* Contacts */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold" style={{ color: 'var(--ds-text-muted)' }}>جهات الاتصال ({agencyContacts.length})</span>
                        <button onClick={(e) => { e.stopPropagation(); setShowContactForm(p => ({ ...p, [agency.id]: true })); }}
                          className="text-[9px] px-2 py-0.5 rounded" style={{ color: '#3b82f6', background: 'rgba(59,130,246,0.1)' }}>
                          <UserPlus className="w-3 h-3 inline" /> إضافة</button>
                      </div>

                      {showContactForm[agency?.id] && (
                        <div className="p-2 mb-1 rounded-lg space-y-1" style={{ background: 'var(--ds-bg-tertiary)', border: '1px dashed var(--ds-border)' }}>
                          <div className="grid grid-cols-3 gap-1">
                            <input placeholder="الاسم" value={newContact[agency.id]?.name || ''} onChange={e => setNewContact(p => ({ ...p, [agency.id]: { ...p[agency.id], name: e.target.value } }))}
                              className="px-2 py-1 rounded text-[10px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                            <input placeholder="البريد" value={newContact[agency.id]?.email || ''} onChange={e => setNewContact(p => ({ ...p, [agency.id]: { ...p[agency.id], email: e.target.value } }))}
                              className="px-2 py-1 rounded text-[10px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                            <input placeholder="الهاتف" value={newContact[agency.id]?.phone || ''} onChange={e => setNewContact(p => ({ ...p, [agency.id]: { ...p[agency.id], phone: e.target.value } }))}
                              className="px-2 py-1 rounded text-[10px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                          </div>
                          <input placeholder="المسمى الوظيفي" value={newContact[agency.id]?.title || ''} onChange={e => setNewContact(p => ({ ...p, [agency.id]: { ...p[agency.id], title: e.target.value } }))}
                            className="w-full px-2 py-1 rounded text-[10px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                          <div className="flex gap-1 pt-0.5">
                            <AppButton size="sm" onClick={() => addContact(agency.id)}><CheckCircle className="w-3 h-3" />حفظ</AppButton>
                            <AppButton size="sm" variant="secondary" onClick={() => setShowContactForm(p => ({ ...p, [agency.id]: false }))}>إلغاء</AppButton>
                          </div>
                        </div>
                      )}

                      <div className="space-y-0.5">
                        {agencyContacts.filter(c => c.is_active !== false).map(contact => (
                          <div key={contact.id} className="flex items-center gap-2 p-1.5 rounded" style={{ background: 'var(--ds-bg-tertiary)' }}>
                            <User className="w-3 h-3 shrink-0" style={{ color: 'var(--ds-text-muted)' }} />
                            <div className="flex-1 min-w-0 text-[10px]">
                              <span className="font-medium" style={{ color: 'var(--ds-text-primary)' }}>{contact.name}</span>
                              {contact.title && <span className="mr-1" style={{ color: 'var(--ds-text-muted)' }}>· {contact.title}</span>}
                              {contact.email && <span className="mr-1" style={{ color: 'var(--ds-text-muted)' }}>· {contact.email}</span>}
                              {contact.phone && <span className="mr-1" style={{ color: 'var(--ds-text-muted)' }}>· {contact.phone}</span>}
                            </div>
                            <button onClick={() => removeContact(agency.id, contact.id)} className="p-0.5" style={{ color: 'var(--ds-text-muted)' }}>
                              <XCircle className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Requests */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold" style={{ color: 'var(--ds-text-muted)' }}>الطلبات ({reqs.length})</span>
                        <button onClick={(e) => { e.stopPropagation(); handleRemove(firstReq.id); }} className="text-[9px] px-2 py-0.5 rounded flex items-center gap-1" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.08)' }}>
                          <Trash2 className="w-3 h-3" /> إزالة الجهة من القضية
                        </button>
                      </div>
                      {reqs.map(req => {
                        const rBadge = getStatusBadge(req.status);
                        const rWaitingDays = req.created_at ? Math.floor((Date.now() - new Date(req.created_at)) / (1000*60*60*24)) : 0;
                        const todayStr = new Date().toISOString().split('T')[0];
                        const isLate = !!(req.expected_response_date && req.expected_response_date < todayStr && !req.response_date);
                        const isPortalFormOpen = showPortalForm[req.id];
                        return (
                          <div key={req.id} className="p-2.5 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', borderRight: isLate ? '3px solid #ef4444' : '3px solid transparent' }}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0" style={{ background: 'var(--ds-accent)', color: 'white' }}>#{req.id}</div>
                              <div className="flex-1 min-w-0 text-[11px]" style={{ color: 'var(--ds-text-muted)' }}>
                                {req.reference_number && <span>مرجع: {req.reference_number}</span>}
                              </div>
                              <AppBadge variant={rBadge.variant}>{rBadge.text}</AppBadge>
                              <span className="text-[9px] shrink-0" style={{ color: isLate ? '#ef4444' : 'var(--ds-text-muted)' }}>{rWaitingDays} يوم · {formatDateTime(req.created_at)}</span>
                            </div>

                            {/* Classification */}
                            <div className="flex items-center gap-1 mb-1.5">
                              {CLASS_OPTIONS.map(opt => {
                                const Icon = opt.icon;
                                const active = req.agency_classification === opt.value;
                                return (
                                  <button key={opt.value} onClick={() => setClassification(req.id, active ? null : opt.value)}
                                    className="flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded ds-transition-colors"
                                    style={active ? { background: 'var(--ds-accent)', color: 'white' } : { background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-muted)' }}>
                                    <Icon className="w-2.5 h-2.5" />{opt.label}
                                  </button>
                                );
                              })}
                            </div>

                            {isLate && (
                              <div className="flex items-center gap-1 mb-1.5 text-[9px] px-2 py-1 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                                <AlertTriangle className="w-3 h-3" /> تخطّى الموعد المتوقع للرد ({req.expected_response_date})
                              </div>
                            )}
                            {!isLate && req.expected_response_date && (
                              <div className="flex items-center gap-1 mb-1.5 text-[9px]" style={{ color: 'var(--ds-text-muted)' }}>
                                <CalendarClock className="w-3 h-3" /> الموعد المتوقع للرد: {req.expected_response_date}
                              </div>
                            )}

                            <div className="flex items-center gap-1 flex-wrap">
                              {req.status !== 'sent' && req.status !== 'closed' && (
                                <button onClick={() => quickAction(req.id, 'sent')} className="flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>
                                  <Send className="w-2.5 h-2.5" />إرسال</button>
                              )}
                              {req.status !== 'closed' && (
                                <>
                                  <button onClick={() => quickAction(req.id, 'reminder')} className="flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(234,179,8,0.1)', color: '#eab308' }}>
                                    <RefreshCw className="w-2.5 h-2.5" />تذكير</button>
                                  <button onClick={() => quickAction(req.id, 'escalated')} className="flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                                    <AlertTriangle className="w-2.5 h-2.5" />تصعيد</button>
                                  <button onClick={() => quickAction(req.id, 'verified')} className="flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
                                    <CheckCircle className="w-2.5 h-2.5" />توثيق</button>
                                  <button onClick={() => quickAction(req.id, 'closed')} className="flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(99,99,102,0.1)', color: '#636366' }}>
                                    <XCircle className="w-2.5 h-2.5" />إغلاق</button>
                                  <button onClick={() => setShowPortalForm(p => ({ ...p, [req.id]: !p[req.id] }))} className="flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(139,92,246,0.1)', color: '#8b5cf6' }}>
                                    <Globe className="w-2.5 h-2.5" />تسجيل تقديم عبر البوابة</button>
                                </>
                              )}
                            </div>

                            {isPortalFormOpen && (
                              <div className="mt-1.5 p-2 rounded-lg space-y-1" style={{ background: 'var(--ds-bg-tertiary)', border: '1px dashed var(--ds-border)' }}>
                                <div className="grid grid-cols-2 gap-1">
                                  <select value={portalForm[req.id]?.expected_response_days || '20'} onChange={e => setPortalForm(p => ({ ...p, [req.id]: { ...p[req.id], expected_response_days: e.target.value } }))}
                                    className="px-2 py-1 rounded text-[10px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}>
                                    {DEADLINE_OPTIONS.map(o => <option key={o.value} value={o.value}>مهلة الرد: {o.label}</option>)}
                                  </select>
                                  <input placeholder="رقم تأكيد التقديم (اختياري)" value={portalForm[req.id]?.confirmation_number || ''} onChange={e => setPortalForm(p => ({ ...p, [req.id]: { ...p[req.id], confirmation_number: e.target.value } }))}
                                    className="px-2 py-1 rounded text-[10px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                                </div>
                                <input placeholder="ملاحظة (اختياري)" value={portalForm[req.id]?.note || ''} onChange={e => setPortalForm(p => ({ ...p, [req.id]: { ...p[req.id], note: e.target.value } }))}
                                  className="w-full px-2 py-1 rounded text-[10px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                                <div className="flex gap-1 justify-end pt-0.5">
                                  <AppButton size="sm" variant="secondary" onClick={() => setShowPortalForm(p => ({ ...p, [req.id]: false }))}>إلغاء</AppButton>
                                  <AppButton size="sm" onClick={() => logPortalSubmission(req.id, agency?.id)}><CheckCircle className="w-3 h-3" />تسجيل</AppButton>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </AppStack>
      ) : <AppEmptyState compact icon={Building2} title="لم تضف جهات" description="أضف الجهات لمتابعة التواصل" />}
    </AppSection>
  );
}
