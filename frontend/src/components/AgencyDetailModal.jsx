import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Star, Mail, User, Save } from 'lucide-react';
import { api } from '../api';
import { useToast } from './ui/Toast';
import Button from './ui/Button';
import Input from './ui/Input';
import Select from './ui/Select';
import Tabs from './ui/Tabs';
import Badge from './ui/Badge';
import Spinner from './ui/Spinner';
import ConfirmDialog from './ui/ConfirmDialog';

const TABS = [
  { key: 'info', label: 'المعلومات' },
  { key: 'contacts', label: 'جهات الاتصال' },
  { key: 'emails', label: 'البريد الإلكتروني' },
  { key: 'sending', label: 'إعدادات الإرسال' },
];

const TYPE_OPTIONS = [
  { value: 'federal', label: 'فيدرالي' },
  { value: 'state', label: 'ولاية' },
  { value: 'municipal', label: 'بلدية' },
  { value: 'sheriff', label: 'شريف' },
];

function Row({ children }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
      {children}
    </div>
  );
}

export default function AgencyDetailModal({ agencyId, onClose, onChanged }) {
  const toast = useToast();
  const [tab, setTab] = useState('info');
  const [loading, setLoading] = useState(true);
  const [agency, setAgency] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteContact, setConfirmDeleteContact] = useState(null);
  const [confirmDeleteEmail, setConfirmDeleteEmail] = useState(null);
  const [newContact, setNewContact] = useState({ name: '', title: '', phone: '', email: '', notes: '' });
  const [newEmail, setNewEmail] = useState('');

  const fetchAgency = () => {
    api.get(`/agencies/${agencyId}`).then(d => {
      setAgency(d);
      setForm({
        name_en: d.name_en || '', name_ar: d.name_ar || '', type: d.type || '',
        state: d.state || '', city: d.city || '', address: d.address || '',
        phone: d.phone || '', notes: d.notes || '', is_active: d.is_active !== false,
        default_email_account_id: d.default_email_account_id || '', reply_to: d.reply_to || '',
      });
      setLoading(false);
    }).catch(() => { setLoading(false); toast.error('تعذر تحميل بيانات الجهة'); });
  };
  useEffect(() => { fetchAgency(); }, [agencyId]);

  const saveInfo = async () => {
    setSaving(true);
    try {
      await api.put(`/agencies/${agencyId}`, {
        name_en: form.name_en, name_ar: form.name_ar, type: form.type,
        state: form.state, city: form.city, address: form.address,
        phone: form.phone, notes: form.notes, is_active: form.is_active,
      });
      toast.success('تم حفظ بيانات الجهة');
      onChanged?.();
      fetchAgency();
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };

  const saveSending = async () => {
    setSaving(true);
    try {
      await api.put(`/agencies/${agencyId}`, {
        default_email_account_id: form.default_email_account_id || null,
        reply_to: form.reply_to || null,
      });
      toast.success('تم حفظ إعدادات الإرسال');
      fetchAgency();
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };

  const addContact = async () => {
    if (!newContact.name.trim()) return;
    try {
      await api.post(`/agencies/${agencyId}/contacts`, newContact);
      setNewContact({ name: '', title: '', phone: '', email: '', notes: '' });
      toast.success('تمت إضافة جهة الاتصال');
      fetchAgency();
    } catch (e) { toast.error(e.message); }
  };
  const updateContact = async (id, patch) => {
    try { await api.put(`/agencies/${agencyId}/contacts/${id}`, patch); fetchAgency(); }
    catch (e) { toast.error(e.message); }
  };
  const deleteContact = async () => {
    if (!confirmDeleteContact) return;
    try {
      await api.delete(`/agencies/${agencyId}/contacts/${confirmDeleteContact}`);
      toast.success('تم حذف جهة الاتصال');
      setConfirmDeleteContact(null);
      fetchAgency();
    } catch (e) { toast.error(e.message); }
  };

  const addEmail = async () => {
    if (!newEmail.trim()) return;
    try {
      await api.post(`/agencies/${agencyId}/emails`, { email: newEmail, is_primary: (agency.emails || []).length === 0 });
      setNewEmail('');
      toast.success('تمت إضافة البريد الإلكتروني');
      fetchAgency();
    } catch (e) { toast.error(e.message); }
  };
  const setPrimaryEmail = async (id) => {
    try { await api.put(`/agencies/${agencyId}/emails/${id}`, { is_primary: true }); fetchAgency(); }
    catch (e) { toast.error(e.message); }
  };
  const deleteEmail = async () => {
    if (!confirmDeleteEmail) return;
    try {
      await api.delete(`/agencies/${agencyId}/emails/${confirmDeleteEmail}`);
      toast.success('تم حذف البريد الإلكتروني');
      setConfirmDeleteEmail(null);
      fetchAgency();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fadeIn" style={{ background: 'var(--bg-overlay)' }} onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[88vh] rounded-2xl border flex flex-col animate-scaleIn"
        style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between p-5 pb-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{loading ? 'جارٍ التحميل...' : agency?.name_en}</h3>
            {!loading && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{[agency?.city, agency?.state].filter(Boolean).join(', ')}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
        </div>

        {loading ? <div className="p-10"><Spinner full /></div> : (
          <>
            <div className="px-5 pt-4 shrink-0">
              <Tabs tabs={TABS} active={tab} onChange={setTab} />
            </div>

            <div className="p-5 overflow-y-auto flex-1">
              {tab === 'info' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="الاسم بالإنجليزية" value={form.name_en} onChange={e => setForm({ ...form, name_en: e.target.value })} />
                    <Input label="الاسم بالعربية" value={form.name_ar} onChange={e => setForm({ ...form, name_ar: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Select label="النوع / التصنيف" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                      <option value="">اختر النوع</option>
                      {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Select>
                    <Input label="الهاتف" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="الولاية" value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} />
                    <Input label="المدينة" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
                  </div>
                  <Input label="العنوان" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>ملاحظات</label>
                    <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3}
                      className="w-full px-3.5 py-2.5 rounded-xl border resize-none text-sm outline-none" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }} />
                  </div>
                  <Row>
                    <div className="flex-1">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>حالة الجهة</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>الجهات المعطّلة لا تظهر عند إنشاء قضية جديدة</p>
                    </div>
                    <button onClick={() => setForm({ ...form, is_active: !form.is_active })}
                      className="relative w-11 h-6 rounded-full transition-colors shrink-0"
                      style={{ background: form.is_active ? 'var(--success)' : 'var(--bg-elevated)' }}>
                      <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: form.is_active ? 'translateX(-1.5rem)' : 'translateX(-0.125rem)', right: 0 }} />
                    </button>
                  </Row>
                  <Button icon={Save} loading={saving} className="w-full" onClick={saveInfo}>حفظ التغييرات</Button>
                </div>
              )}

              {tab === 'contacts' && (
                <div className="space-y-3">
                  {(agency.contacts || []).length === 0 ? (
                    <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>لا توجد جهات اتصال بعد</p>
                  ) : (agency.contacts || []).map(c => (
                    <Row key={c.id}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}><User className="w-4 h-4" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{c.name} {c.title && <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>· {c.title}</span>}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</p>
                      </div>
                      <button onClick={() => setConfirmDeleteContact(c.id)} className="p-1.5 rounded-lg shrink-0" style={{ color: 'var(--danger)' }}><Trash2 className="w-3.5 h-3.5" /></button>
                    </Row>
                  ))}
                  <div className="p-3 rounded-xl space-y-2" style={{ background: 'var(--bg-tertiary)', border: '1px dashed var(--border-strong)' }}>
                    <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>إضافة جهة اتصال جديدة</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={newContact.name} onChange={e => setNewContact({ ...newContact, name: e.target.value })} placeholder="الاسم *" />
                      <Input value={newContact.title} onChange={e => setNewContact({ ...newContact, title: e.target.value })} placeholder="المسمى الوظيفي" />
                      <Input value={newContact.phone} onChange={e => setNewContact({ ...newContact, phone: e.target.value })} placeholder="الهاتف" />
                      <Input value={newContact.email} onChange={e => setNewContact({ ...newContact, email: e.target.value })} placeholder="البريد الإلكتروني" />
                    </div>
                    <Button size="sm" icon={Plus} onClick={addContact}>إضافة</Button>
                  </div>
                </div>
              )}

              {tab === 'emails' && (
                <div className="space-y-3">
                  {(agency.emails || []).length === 0 ? (
                    <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>لا توجد عناوين بريد إضافية بعد</p>
                  ) : (agency.emails || []).map(e => (
                    <Row key={e.id}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--info-subtle)', color: 'var(--info)' }}><Mail className="w-4 h-4" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{e.email}</p>
                      </div>
                      {e.is_primary ? <Badge variant="accent">أساسي</Badge> : (
                        <button onClick={() => setPrimaryEmail(e.id)} className="p-1.5 rounded-lg shrink-0" style={{ color: 'var(--text-muted)' }} title="تعيين كأساسي"><Star className="w-3.5 h-3.5" /></button>
                      )}
                      <button onClick={() => setConfirmDeleteEmail(e.id)} className="p-1.5 rounded-lg shrink-0" style={{ color: 'var(--danger)' }}><Trash2 className="w-3.5 h-3.5" /></button>
                    </Row>
                  ))}
                  <div className="flex gap-2">
                    <Input containerClassName="flex-1" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="بريد إلكتروني جديد" type="email" />
                    <Button icon={Plus} onClick={addEmail}>إضافة</Button>
                  </div>
                </div>
              )}

              {tab === 'sending' && (
                <div className="space-y-3">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>تحديد الحساب المستخدم تلقائيًا عند مراسلة هذه الجهة.</p>
                  <Select label="الإرسال من حساب" value={form.default_email_account_id} onChange={e => setForm({ ...form, default_email_account_id: e.target.value })}>
                    <option value="">— بدون افتراضي (اختر عند الإرسال) —</option>
                    {(agency.available_email_accounts || []).map(a => <option key={a.id} value={a.id}>{a.email} ({a.name})</option>)}
                  </Select>
                  <Input label="الرد إلى (Reply-To)" value={form.reply_to} onChange={e => setForm({ ...form, reply_to: e.target.value })} placeholder="reply@company.com" />
                  <Button icon={Save} loading={saving} className="w-full" onClick={saveSending}>حفظ إعدادات الإرسال</Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog open={!!confirmDeleteContact} onClose={() => setConfirmDeleteContact(null)} onConfirm={deleteContact}
        title="حذف جهة الاتصال" message="هل أنت متأكد من حذف جهة الاتصال هذه؟" confirmLabel="حذف" />
      <ConfirmDialog open={!!confirmDeleteEmail} onClose={() => setConfirmDeleteEmail(null)} onConfirm={deleteEmail}
        title="حذف البريد الإلكتروني" message="هل أنت متأكد من حذف عنوان البريد هذا؟" confirmLabel="حذف" />
    </div>
  );
}
