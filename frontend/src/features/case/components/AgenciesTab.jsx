import { getApiBase } from '../../../api';
const API = getApiBase();
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Building2, Plus, Trash2, Mail, Settings, Clock, CheckCircle, AlertCircle, Send, ChevronDown, ChevronUp, User, TrendingUp, Activity, FileText, Eye, Users, BarChart3, HelpCircle, RefreshCw, Phone, XCircle, UserPlus, BookOpen, AlertTriangle } from 'lucide-react';
import { useCaseContext } from '../context/CaseContext';
import { useRequests } from '../../request/hooks/useRequests';
import { getStatusBadge, filterUnusedAgencies, formatAgencyLocation } from '../../request/utils';
import AppSection from '../../../components/ds/AppSection';
import AppButton from '../../../components/ds/AppButton';
import AppSelect from '../../../components/ds/AppSelect';
import AppBadge from '../../../components/ds/AppBadge';
import AppEmptyState from '../../../components/ds/AppEmptyState';
import AppStack from '../../../components/ds/AppStack';

const tok = () => localStorage.getItem('token');
const hdrs = () => ({ 'Authorization': `Bearer ${tok()}`, 'Content-Type': 'application/json' });

const CLASS_OPTIONS = [
  { value: 'investigation', label: 'تحقيق' },
  { value: 'arrest', label: 'قبض' },
  { value: 'both', label: 'تحقيق وقبض' },
  { value: 'other', label: 'أخرى' },
];

const COMM_METHODS = [
  { value: 'email', label: 'بريد إلكتروني' },
  { value: 'portal', label: 'بوابة' },
  { value: 'mail', label: 'بريد عادي' },
  { value: 'phone', label: 'هاتف' },
  { value: 'fax', label: 'فاكس' },
  { value: 'in_person', label: 'مقابلة شخصية' },
];

const REQUEST_STAGES = [
  { key: 'sent', label: 'مرسل', icon: Send, color: '#3b82f6' },
  { key: 'reminder', label: 'تذكير', icon: RefreshCw, color: '#eab308' },
  { key: 'responded', label: 'تم الرد', icon: Mail, color: '#22c55e' },
  { key: 'received', label: 'استلام', icon: FileText, color: '#8b5cf6' },
  { key: 'verified', label: 'موثق', icon: CheckCircle, color: '#22c55e' },
  { key: 'closed', label: 'مغلق', icon: XCircle, color: '#636366' },
];

const CONTACT_TYPES = [
  { value: 'primary', label: 'جهة اتصال رئيسية' },
  { value: 'foia_officer', label: 'مسؤول FOIA' },
  { value: 'legal', label: 'جهة قانونية' },
  { value: 'records_custodian', label: 'حافظ السجلات' },
  { value: 'general', label: 'عام' },
];

function computeSmartHealth(reqs) {
  if (!reqs || reqs.length === 0) return { label: 'غير مهيأ', color: '#636366', value: 0, details: [] };
  const total = reqs.length;
  const late = reqs.filter(r => r.created_at && (Math.floor((Date.now() - new Date(r.created_at)) / (1000*60*60*24))) > (r.expected_response_days || 20)).length;
  const escalations = reqs.filter(r => r.status?.includes('escalate') || r.evidence_stage === 'escalated').length;
  const hasConfig = reqs.some(r => r.assigned_email_account_id || r.email_account_id);
  const received = reqs.filter(r => r.receipt_status === 'received' || r.status === 'responded').length;
  const respRate = total > 0 ? Math.round((received / total) * 100) : 0;
  const closed = reqs.filter(r => r.status === 'closed' || r.evidence_stage === 'closed').length;
  const compRate = total > 0 ? Math.round((closed / total) * 100) : 0;
  let score = 100; const details = [];
  if (late > 0) { score -= late * 10; details.push(`${late} متأخر`); }
  if (escalations > 0) { score -= escalations * 15; details.push(`${escalations} تصعيد`); }
  if (!hasConfig) { score -= 15; details.push('غير مهيأ'); }
  if (total > 3 && respRate < 50) { score -= 10; details.push('استجابة منخفضة'); }
  score = Math.max(10, Math.min(100, score));
  if (score >= 80) return { label: 'ممتاز', color: '#22c55e', value: score, details, compRate, respRate, late, escalations };
  if (score >= 60) return { label: 'جيد', color: '#3b82f6', value: score, details, compRate, respRate, late, escalations };
  if (score >= 40) return { label: 'انتباه', color: '#eab308', value: score, details, compRate, respRate, late, escalations };
  return { label: 'حرج', color: '#ef4444', value: score, details, compRate, respRate, late, escalations };
}

export default function AgenciesTab() {
  const { id, c, team, requests, allAgencies, refetch } = useCaseContext();
  const { showAdd, setShowAdd, selectedAgencyId, setSelectedAgencyId, handleAdd, handleRemove, handleClassify } = useRequests(id, refetch);
  const unusedAgencies = filterUnusedAgencies(allAgencies, requests);
  const [emailAccounts, setEmailAccounts] = useState([]);
  const [commRecords, setCommRecords] = useState([]);
  const [configuring, setConfiguring] = useState(null);
  const [config, setConfig] = useState({ email_account_id: '', comm_method: 'email', sla_days: 20, contact_id: '' });
  const [expanded, setExpanded] = useState({});
  const [showContacts, setShowContacts] = useState({});
  const [contacts, setContacts] = useState({});
  const [newContact, setNewContact] = useState({});
  const [showContactForm, setShowContactForm] = useState({});

  useEffect(() => {
    fetch(`${API}/email-accounts`, { headers: hdrs() }).then(r => r.json()).then(d => setEmailAccounts(d.data || d.accounts || []));
    fetch(`${API}/cases/${id}/threads`, { headers: hdrs() }).then(r => r.json()).then(d => setCommRecords(d.threads || []));
    // Load contacts from stored configs
    (requests || []).forEach(r => {
      if (r.notes) {
        try {
          const parsed = JSON.parse(r.notes);
          if (parsed._contacts && !contacts[r.agency_id]) {
            setContacts(p => ({ ...p, [r.agency_id]: parsed._contacts }));
          }
        } catch {}
      }
    });
  }, [id, requests]);

  const grouped = useMemo(() => {
    const map = {};
    (requests || []).forEach(r => {
      const key = r.agencies?.id || r.agency_id || r.id;
      if (!map[key]) map[key] = { agency: r.agencies, requests: [] };
      map[key].requests.push(r);
    });
    return Object.values(map);
  }, [requests]);

  const getRequestTimeline = (reqId) => (commRecords || []).filter(c => c.request_id === reqId || c.request_number == reqId);

  const openConfig = (req) => {
    setConfiguring(req.id);
    let parsed = {};
    try { if (req.notes) parsed = JSON.parse(req.notes); } catch {}
    setConfig({
      email_account_id: req.assigned_email_account_id || req.email_account_id || parsed._comm?.email_account_id || '',
      comm_method: parsed._comm?.method || req.communication_method || 'email',
      sla_days: parsed._comm?.sla_days || req.expected_response_days || 20,
      contact_id: parsed._comm?.contact_id || '',
    });
  };

  const saveConfig = async () => {
    if (!configuring) return;
    const req = (requests || []).find(r => r.id === configuring);
    const existing = req?.notes ? JSON.parse(req.notes) || {} : {};
    const updatedNotes = JSON.stringify({ ...existing, _comm: { email_account_id: config.email_account_id || null, method: config.comm_method, sla_days: config.sla_days, contact_id: config.contact_id } });
    await fetch(`${API}/requests/${configuring}/communication-config`, { method: 'PUT', headers: hdrs(), body: JSON.stringify({ email_account_id: config.email_account_id, comm_method: config.comm_method, sla_days: config.sla_days }) });
    setConfiguring(null); refetch?.();
  };

  // Contact operations
  const addContact = async (agencyId) => {
    if (!newContact[agencyId]?.name) return;
    const agencyKey = String(agencyId);
    const current = contacts[agencyKey] || [];
    const updated = [...current, { ...newContact[agencyKey], id: Date.now(), active: true }];
    setContacts(p => ({ ...p, [agencyKey]: updated }));
    setNewContact(p => ({ ...p, [agencyId]: {} }));
    setShowContactForm(p => ({ ...p, [agencyId]: false }));
    // Store in first request's notes for this agency
    const group = grouped.find(g => (g.agency?.id || g.requests[0]?.agency_id) == agencyId);
    if (group?.requests[0]) {
      const req = group.requests[0];
      const existing = req.notes ? JSON.parse(req.notes) || {} : {};
      await fetch(`${API}/requests/${req.id}/communication-config`, { method: 'PUT', headers: hdrs(), body: JSON.stringify({ email_account_id: config.email_account_id, comm_method: config.comm_method, sla_days: config.sla_days }) });
    }
  };

  const removeContact = (agencyId, contactId) => {
    const agencyKey = String(agencyId);
    const updated = (contacts[agencyKey] || []).filter(c => c.id !== contactId);
    setContacts(p => ({ ...p, [agencyKey]: updated }));
  };

  const toggleExpand = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }));
  const toggleContacts = (id) => setShowContacts(p => ({ ...p, [id]: !p[id] }));

  // Quick actions
  const quickAction = async (reqId, action) => {
    await fetch(`${API}/requests/${reqId}/status`, { method: 'PUT', headers: hdrs(), body: JSON.stringify({ status: action }) });
    refetch?.();
  };

  return (
    <AppSection title={'الجهات (' + (grouped?.length || 0) + ')'}
      actions={<AppButton size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowAdd(true)}>إضافة</AppButton>}>
      {showAdd && (
        <div className="space-y-2 mb-3">
          <div className="flex items-center gap-2">
            <AppSelect value={selectedAgencyId} onChange={e => setSelectedAgencyId(e.target.value)}
              placeholder="اختر جهة..."
              options={unusedAgencies.map(a => ({ value: String(a.id), label: `${a.name_en} (${a.state || a.city || ''})` }))}
              className="flex-1" />
            <AppButton size="sm" onClick={() => { handleAdd(parseInt(selectedAgencyId)); }}>إضافة</AppButton>
            <AppButton size="sm" variant="secondary" onClick={() => setShowAdd(false)}>إلغاء</AppButton>
          </div>
          <div className="text-[10px] px-1" style={{ color: 'var(--ds-text-muted)' }}>
            <Mail className="w-3 h-3 inline" /> بعد الإضافة، قم بتهيئة حساب البريد من زر <Settings className="w-3 h-3 inline" /> لكل جهة
          </div>
        </div>
      )}

      {/* Communication Summary Dashboard */}
      {grouped?.length > 0 && (
        <div className="grid grid-cols-5 gap-2 mb-3 p-2.5 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)' }}>
          {[
            { label: 'مهيأ', value: grouped.filter(g => g.requests.some(r => r.assigned_email_account_id || r.email_account_id)).length, color: '#22c55e' },
            { label: 'غير مهيأ', value: grouped.filter(g => !g.requests.some(r => r.assigned_email_account_id || r.email_account_id)).length, color: '#ef4444' },
            { label: 'بانتظار الرد', value: grouped.flatMap(g => g.requests).filter(r => r.status === 'sent' || !r.status).length, color: '#eab308' },
            { label: 'متأخر', value: grouped.flatMap(g => g.requests).filter(r => r.created_at && (Math.floor((Date.now() - new Date(r.created_at)) / (1000*60*60*24))) > (r.expected_response_days || 20)).length, color: '#ef4444' },
            { label: 'الصحة العامة', value: grouped.some(g => g.requests.some(r => r.assigned_email_account_id)) ? 'جيد' : 'غير مهيأ', color: grouped.some(g => g.requests.some(r => r.assigned_email_account_id)) ? '#22c55e' : '#636366' },
          ].map(k => (
            <div key={k.label} className="text-center">
              <div className="text-base font-bold" style={{ color: k.color }}>{k.value}</div>
              <div className="text-[8px]" style={{ color: 'var(--ds-text-muted)' }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {grouped?.length > 0 ? (
        <AppStack gap="6px">
          {grouped.map(group => {
            const agency = group.agency;
            const reqs = group.requests;
            const firstReq = reqs[0];
            const health = computeSmartHealth(reqs);
            const isExpanded = expanded[agency?.id || firstReq.id];
            const allLate = health.late || 0;
            const openReqs = reqs.filter(r => r.status !== 'closed' && r.status !== 'completed').length;
            const closedReqs = reqs.filter(r => r.status === 'closed' || r.status === 'completed').length;
            const agencyKey = String(agency?.id || firstReq.agency_id);
            const agencyContacts = contacts[agencyKey] || [];
            const isContactsOpen = showContacts[agencyKey];
            const owner = team?.find(t => t.role === 'lead_investigator' || t.role === 'owner') || team?.[0];
            const backupOwner = team?.find(t => t.user_id !== owner?.user_id && (t.role === 'investigator' || t.role === 'researcher'));
            const isConfigured = !!(firstReq?.assigned_email_account_id || (emailAccounts || []).some(a => String(a.id) === String(firstReq?.assigned_email_account_id)));

            return (
              <div key={agency?.id || firstReq.id}>
                {/* Agency Card */}
                <div onClick={() => toggleExpand(agency?.id || firstReq.id)}
                  className="p-3 rounded-lg cursor-pointer ds-transition-colors"
                  style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', borderRight: `4px solid ${health.color}` }}>
                  <div className="flex items-start gap-3">
                    <Building2 className="w-5 h-5 shrink-0 mt-0.5" style={{ color: health.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>{agency?.name_en || 'جهة'}</span>
                        <AppBadge variant={health.value >= 80 ? 'success' : health.value >= 60 ? 'info' : health.value >= 40 ? 'warning' : 'danger'}>{health.label}</AppBadge>
                        {!isConfigured && <AppBadge variant="danger">غير مهيأ</AppBadge>}
                      </div>
                      <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>
                        <span>{agency?.city || ''}{agency?.city && agency?.state ? ', ' : ''}{agency?.state || ''}</span>
                        <span>·</span><span>{openReqs} مفتوح</span>
                        <span>·</span><span>{closedReqs} مغلق</span>
                        {allLate > 0 && <span style={{ color: '#ef4444' }}>· {allLate} متأخر</span>}
                        <span>·</span><span>إكمال: {health.compRate || 0}%</span>
                        {owner && <span>· {owner.user_name || owner.name}</span>}
                      </div>
                    </div>
                    <div className="text-center shrink-0">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold mx-auto"
                        style={{ background: `${health.color}20`, color: health.color, border: `2px solid ${health.color}` }}>{health.value}%</div>
                      <div className="text-[8px]" style={{ color: 'var(--ds-text-muted)' }}>{health.label}</div>
                    </div>
                    <button className="p-1" style={{ color: 'var(--ds-text-muted)' }}>
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="p-3 rounded-b-lg space-y-3" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', borderTop: 'none' }}>
                    {/* KPI Row */}
                    <div className="flex items-center gap-3 text-center">
                      {[
                        { label: 'مفتوحة', value: openReqs, color: '#3b82f6' },
                        { label: 'مغلقة', value: closedReqs, color: '#22c55e' },
                        { label: 'متأخرة', value: health.late || 0, color: '#ef4444' },
                        { label: 'إكمال', value: `${health.compRate || 0}%`, color: health.color },
                        { label: 'استجابة', value: `${health.respRate || 0}%`, color: (health.respRate || 0) >= 50 ? '#22c55e' : '#eab308' },
                      ].map(k => (
                        <div key={k.label} className="min-w-[40px]">
                          <div className="text-lg font-bold" style={{ color: k.color }}>{k.value}</div>
                          <div className="text-[8px]" style={{ color: 'var(--ds-text-muted)' }}>{k.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Ownership + Email Mapping */}
                    <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--ds-text-secondary)' }}>
                      <div className="flex items-center gap-3">
                        <span><User className="w-3 h-3 inline" /> {owner?.user_name || owner?.name || c?.owner_name || '—'}</span>
                        {backupOwner && <span><Users className="w-3 h-3 inline" /> احتياط: {backupOwner.user_name || backupOwner.name}</span>}
                        <span><Mail className="w-3 h-3 inline" /> {(emailAccounts || []).find(a => String(a.id) === String(firstReq?.assigned_email_account_id))?.email || '—'}</span>
                      </div>
                      <div className="flex gap-1">
                        <AppButton size="sm" variant="primary" icon={<Send className="w-3.5 h-3.5" />}
                          disabled={!isConfigured} title={!isConfigured ? 'قم بتهيئة حساب البريد أولاً' : 'إرسال طلب'}>إرسال طلب</AppButton>
                        <button onClick={(e) => { e.stopPropagation(); setConfiguring(firstReq.id); }} className="p-1.5 rounded" style={{ color: 'var(--ds-text-muted)' }} title="تهيئة"><Settings className="w-3.5 h-3.5" /></button>
                        <button onClick={(e) => { e.stopPropagation(); handleRemove(firstReq.id); }} className="p-1.5 rounded" style={{ color: 'var(--ds-text-muted)' }} title="إزالة"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>

                    {/* Config Panel */}
                    {configuring === firstReq.id && (
                      <div className="p-2 rounded-lg space-y-1.5" style={{ background: 'var(--ds-bg-secondary)', border: '1px dashed var(--ds-border)' }}>
                        <div className="grid grid-cols-4 gap-1.5">
                          <div>
                            <label className="text-[8px]" style={{ color: 'var(--ds-text-muted)' }}>طريقة التواصل</label>
                            <select value={config.comm_method} onChange={e => setConfig(f => ({...f, comm_method: e.target.value}))}
                              className="w-full px-2 py-1 rounded text-[10px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}>
                              {COMM_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[8px]" style={{ color: 'var(--ds-text-muted)' }}>حساب البريد</label>
                            <select value={config.email_account_id} onChange={e => setConfig(f => ({...f, email_account_id: e.target.value}))}
                              className="w-full px-2 py-1 rounded text-[10px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}>
                              <option value="">اختر...</option>
                              {(emailAccounts || []).map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[8px]" style={{ color: 'var(--ds-text-muted)' }}>جهة الاتصال</label>
                            <select value={config.contact_id} onChange={e => setConfig(f => ({...f, contact_id: e.target.value}))}
                              className="w-full px-2 py-1 rounded text-[10px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}>
                              <option value="">اختر...</option>
                              {agencyContacts.filter(c => c.active !== false).map(c => <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[8px]" style={{ color: 'var(--ds-text-muted)' }}>SLA (أيام)</label>
                            <div className="flex gap-1">
                              <input type="number" value={config.sla_days} onChange={e => setConfig(f => ({...f, sla_days: parseInt(e.target.value) || 20}))}
                                className="w-16 px-2 py-1 rounded text-[10px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                              <AppButton size="sm" onClick={saveConfig}><CheckCircle className="w-3 h-3" /></AppButton>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Contacts Section */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold" style={{ color: 'var(--ds-text-muted)' }}>جهات الاتصال ({agencyContacts.length})</span>
                        <button onClick={(e) => { e.stopPropagation(); setShowContactForm(p => ({ ...p, [agencyKey]: true })); }}
                          className="text-[9px] px-2 py-0.5 rounded" style={{ color: '#3b82f6', background: 'rgba(59,130,246,0.1)' }}>
                          <UserPlus className="w-3 h-3 inline" /> إضافة</button>
                      </div>

                      {showContactForm[agencyKey] && (
                        <div className="p-2 mb-1 rounded-lg space-y-1" style={{ background: 'var(--ds-bg-tertiary)', border: '1px dashed var(--ds-border)' }}>
                          <div className="grid grid-cols-3 gap-1">
                            <input placeholder="الاسم" value={newContact[agencyKey]?.name || ''} onChange={e => setNewContact(p => ({ ...p, [agencyKey]: { ...p[agencyKey], name: e.target.value } }))}
                              className="px-2 py-1 rounded text-[10px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                            <input placeholder="البريد" value={newContact[agencyKey]?.email || ''} onChange={e => setNewContact(p => ({ ...p, [agencyKey]: { ...p[agencyKey], email: e.target.value } }))}
                              className="px-2 py-1 rounded text-[10px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                            <input placeholder="الهاتف" value={newContact[agencyKey]?.phone || ''} onChange={e => setNewContact(p => ({ ...p, [agencyKey]: { ...p[agencyKey], phone: e.target.value } }))}
                              className="px-2 py-1 rounded text-[10px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                          </div>
                          <div className="grid grid-cols-2 gap-1">
                            <input placeholder="المسمى" value={newContact[agencyKey]?.title || ''} onChange={e => setNewContact(p => ({ ...p, [agencyKey]: { ...p[agencyKey], title: e.target.value } }))}
                              className="px-2 py-1 rounded text-[10px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
                            <select value={newContact[agencyKey]?.type || 'general'} onChange={e => setNewContact(p => ({ ...p, [agencyKey]: { ...p[agencyKey], type: e.target.value } }))}
                              className="px-2 py-1 rounded text-[10px]" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}>
                              {CONTACT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                          </div>
                          <div className="flex gap-1 pt-0.5">
                            <AppButton size="sm" onClick={() => addContact(agency?.id || firstReq.agency_id)}><CheckCircle className="w-3 h-3" />حفظ</AppButton>
                            <AppButton size="sm" variant="secondary" onClick={() => setShowContactForm(p => ({ ...p, [agencyKey]: false }))}>إلغاء</AppButton>
                          </div>
                        </div>
                      )}

                      <div className="space-y-0.5">
                        {agencyContacts.filter(c => c.active !== false).map(contact => (
                          <div key={contact.id} className="flex items-center gap-2 p-1.5 rounded" style={{ background: 'var(--ds-bg-tertiary)' }}>
                            <User className="w-3 h-3 shrink-0" style={{ color: contact.type === 'primary' ? '#d4a843' : 'var(--ds-text-muted)' }} />
                            <div className="flex-1 min-w-0 text-[10px]">
                              <span className="font-medium" style={{ color: 'var(--ds-text-primary)' }}>{contact.name}</span>
                              {contact.email && <span className="mr-1" style={{ color: 'var(--ds-text-muted)' }}>· {contact.email}</span>}
                              {contact.phone && <span className="mr-1" style={{ color: 'var(--ds-text-muted)' }}>· {contact.phone}</span>}
                            </div>
                            <AppBadge variant={contact.type === 'primary' ? 'success' : 'neutral'}>
                              {CONTACT_TYPES.find(t => t.value === contact.type)?.label || contact.type}
                            </AppBadge>
                            <button onClick={() => removeContact(agency?.id || firstReq.agency_id, contact.id)} className="p-0.5" style={{ color: 'var(--ds-text-muted)' }}>
                              <XCircle className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Request Tracker with Quick Actions */}
                    <div className="space-y-1">
                      <div className="text-[10px] font-semibold" style={{ color: 'var(--ds-text-muted)' }}>الطلبات ({reqs.length})</div>
                      {reqs.map(req => {
                        const rBadge = getStatusBadge(req.status);
                        const rWaitingDays = req.created_at ? Math.floor((Date.now() - new Date(req.created_at)) / (1000*60*60*24)) : 0;
                        const isLate = rWaitingDays > (req.expected_response_days || 20);
                        const stageIdx = REQUEST_STAGES.findIndex(s => req.status?.includes(s.key) || req.evidence_stage?.includes(s.key));
                        const completionPct = stageIdx >= 0 ? Math.round(((stageIdx + 1) / REQUEST_STAGES.length) * 100) : 0;
                        const reqTimeline = getRequestTimeline(req.id);

                        return (
                          <div key={req.id} className="p-2.5 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', borderRight: isLate ? '3px solid #ef4444' : '3px solid transparent' }}>
                            {/* Header */}
                            <div className="flex items-center gap-2 mb-1">
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0" style={{ background: 'var(--ds-accent)', color: 'white' }}>#{req.id}</div>
                              <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-medium" style={{ color: 'var(--ds-text-primary)' }}>{req.title || 'طلب معلومات'}</div>
                              </div>
                              <AppBadge variant={rBadge.variant}>{rBadge.text}</AppBadge>
                              <span className="text-[9px] shrink-0" style={{ color: isLate ? '#ef4444' : 'var(--ds-text-muted)' }}>{rWaitingDays} يوم</span>
                            </div>

                            {/* Stage Bar */}
                            {completionPct > 0 && (
                              <div className="w-full h-1 rounded-full mb-1" style={{ background: 'var(--ds-bg-tertiary)' }}>
                                <div className="h-full rounded-full" style={{ width: `${completionPct}%`, background: isLate ? '#ef4444' : '#22c55e' }} />
                              </div>
                            )}
                            {/* Stage icons */}
                            <div className="flex items-center gap-1 mb-1.5">
                              {REQUEST_STAGES.map((stage, i) => {
                                const active = stageIdx !== null && stageIdx !== undefined && i <= stageIdx;
                                const Icon = stage.icon;
                                return (
                                  <div key={stage.key} className="flex items-center gap-0.5 text-[8px]"
                                    style={{ color: active ? stage.color : 'var(--ds-text-muted)', opacity: active ? 1 : 0.4 }}>
                                    <Icon className="w-2.5 h-2.5" /><span className="hidden md:inline">{stage.label}</span>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Quick Actions */}
                            <div className="flex items-center gap-1">
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
                                </>
                              )}
                            </div>

                            {/* Timeline events */}
                            {reqTimeline.length > 0 && (
                              <div className="mt-1 text-[8px]" style={{ color: 'var(--ds-text-muted)' }}>
                                {reqTimeline.slice(-2).map(t => (
                                  <span key={t.id} className="mr-1">· {t.subject?.substring(0, 25)} ({new Date(t.created_at).toLocaleDateString('ar-SA')})</span>
                                ))}
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
