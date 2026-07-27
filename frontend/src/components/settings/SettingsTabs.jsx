import { useState, useEffect } from 'react';
import { Shield, Plus, Pencil, Save, X, Check, Users, Building2, Mail, Bell } from 'lucide-react';
import Button from '../../components/ui/Button';
import Tabs from '../../components/ui/Tabs';

const API = import.meta.env.VITE_API_URL || 'https://backend-six-flax-84.vercel.app/api';

const tok = () => localStorage.getItem('token');
const headers = () => ({ 'Authorization': `Bearer ${tok()}`, 'Content-Type': 'application/json' });

// ════════════════════════════════════════════
// ROLES TAB
// ════════════════════════════════════════════
export function RolesTab() {
  const [roles, setRoles] = useState([]);
  const [editing, setEditing] = useState(null);
  const [editPerms, setEditPerms] = useState({});

  useEffect(() => {
    fetch(`${API}/roles`, { headers: headers() }).then(r => r.json()).then(d => setRoles(d.roles || []));
  }, []);

  const allPermissions = ['view_investigation','edit_investigation','delete_investigation','create_requests','approve_requests','verify_evidence','close_investigation','package_investigation','manage_users','manage_roles','manage_departments','view_reports','manage_email_accounts','manage_sources','manage_teams','bulk_actions','view_workload'];

  const permLabels = {
    view_investigation: 'عرض التحقيق', edit_investigation: 'تعديل التحقيق', delete_investigation: 'حذف التحقيق',
    create_requests: 'إنشاء طلبات', approve_requests: 'اعتماد الطلبات', verify_evidence: 'توثيق الأدلة',
    close_investigation: 'إغلاق التحقيق', package_investigation: 'تجهيز الحزمة',
    manage_users: 'إدارة المستخدمين', manage_roles: 'إدارة الأدوار', manage_departments: 'إدارة الأقسام',
    view_reports: 'عرض التقارير', manage_email_accounts: 'إدارة حسابات البريد',
    manage_sources: 'إدارة المصادر', manage_teams: 'إدارة الفرق', bulk_actions: 'إجراءات جماعية',
    view_workload: 'عرض أعباء العمل',
  };

  const togglePerm = (perm) => {
    setEditPerms(p => ({ ...p, [perm]: !p[perm] }));
  };

  const savePerms = async (roleId) => {
    await fetch(`${API}/roles/${roleId}`, { method: 'PUT', headers: headers(), body: JSON.stringify({ permissions: editPerms }) });
    setEditing(null);
  };

  const startEdit = (role) => {
    setEditing(role.id);
    setEditPerms(role.permissions || {});
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-bold" style={{ color: 'var(--ds-text-primary)' }}>الأدوار والصلاحيات</h3>
      </div>
      <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--ds-border)' }}>
        <table className="w-full text-right text-[11px]">
          <thead>
            <tr style={{ background: 'var(--ds-bg-secondary)', color: 'var(--ds-text-muted)' }}>
              <th className="p-2 sticky right-0" style={{ background: 'var(--ds-bg-secondary)' }}>الدور</th>
              {allPermissions.map(p => <th key={p} className="p-2 whitespace-nowrap">{permLabels[p]}</th>)}
              <th className="p-2">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {roles.map(r => {
              const perms = editing === r.id ? editPerms : (r.permissions || {});
              return (
                <tr key={r.id} className="border-t" style={{ borderColor: 'var(--ds-border)' }}>
                  <td className="p-2 font-medium sticky right-0" style={{ background: 'var(--ds-bg-primary)', color: 'var(--ds-text-primary)' }}>{r.label}</td>
                  {allPermissions.map(p => (
                    <td key={p} className="p-2 text-center">
                      {editing === r.id ? (
                        <button onClick={() => togglePerm(p)} className="w-5 h-5 rounded flex items-center justify-center mx-auto" style={{ background: perms[p] ? 'rgba(34,197,94,0.2)' : 'var(--ds-bg-tertiary)' }}>
                          {perms[p] ? <Check className="w-3 h-3" style={{ color: '#22c55e' }} /> : <X className="w-3 h-3" style={{ color: 'var(--ds-text-muted)' }} />}
                        </button>
                      ) : (
                        <span className={`w-5 h-5 rounded flex items-center justify-center mx-auto ${perms[p] ? 'bg-green-100' : 'bg-gray-100'}`}>
                          {perms[p] ? '✅' : '❌'}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="p-2">
                    {editing === r.id ? (
                      <div className="flex gap-1">
                        <button onClick={() => savePerms(r.id)} className="text-[10px] px-2 py-1 rounded" style={{ background: 'rgba(34,197,94,0.2)', color: '#22c55e' }}>حفظ</button>
                        <button onClick={() => setEditing(null)} className="text-[10px] px-2 py-1 rounded" style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>إلغاء</button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(r)} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-muted)' }}>
                        <Pencil className="w-3 h-3" />تعديل
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// DEPARTMENTS TAB
// ════════════════════════════════════════════
export function DepartmentsTab() {
  const [depts, setDepts] = useState([]);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => {
    fetch(`${API}/departments`, { headers: headers() }).then(r => r.json()).then(d => setDepts(d.departments || []));
  }, []);

  const add = async () => {
    if (!newName.trim()) return;
    const r = await fetch(`${API}/departments`, { method: 'POST', headers: headers(), body: JSON.stringify({ name: newName, description: newDesc }) });
    const d = await r.json();
    if (d.success) { setDepts(prev => [...prev, d.department]); setNewName(''); setNewDesc(''); }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-[15px] font-bold" style={{ color: 'var(--ds-text-primary)' }}>الأقسام</h3>
      <div className="flex items-center gap-2">
        <input className="flex-1 px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
          placeholder="اسم القسم..." value={newName} onChange={e => setNewName(e.target.value)} />
        <input className="flex-[2] px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
          placeholder="وصف..." value={newDesc} onChange={e => setNewDesc(e.target.value)} />
        <Button variant="primary" size="sm" onClick={add}><Plus className="w-4 h-4" />إضافة</Button>
      </div>
      <div className="space-y-1">
        {depts.map(d => (
          <div key={d.id} className="flex items-center justify-between p-2 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
            <div>
              <span className="font-medium text-sm" style={{ color: 'var(--ds-text-primary)' }}>{d.name}</span>
              {d.description && <span className="mr-3 text-xs" style={{ color: 'var(--ds-text-muted)' }}>{d.description}</span>}
            </div>
          </div>
        ))}
        {depts.length === 0 && <div className="text-sm text-center py-4" style={{ color: 'var(--ds-text-muted)' }}>لا توجد أقسام بعد</div>}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// EMAIL ACCOUNTS TAB
// ════════════════════════════════════════════
export function EmailAccountsTab() {
  const [accounts, setAccounts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ display_name: '', email: '', signature: '', smtp_host: '', imap_host: '' });

  useEffect(() => {
    fetch(`${API}/email-accounts`, { headers: headers() }).then(r => r.json()).then(d => setAccounts(d.accounts || []));
  }, []);

  const create = async () => {
    const r = await fetch(`${API}/email-accounts`, { method: 'POST', headers: headers(), body: JSON.stringify(form) });
    const d = await r.json();
    if (d.success) { setAccounts(prev => [...prev, d.account]); setShowForm(false); setForm({ display_name: '', email: '', signature: '', smtp_host: '', imap_host: '' }); }
  };

  const deleteAccount = async (id) => {
    await fetch(`${API}/email-accounts/${id}`, { method: 'DELETE', headers: headers() });
    setAccounts(prev => prev.filter(a => a.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-bold" style={{ color: 'var(--ds-text-primary)' }}>حسابات البريد الإلكتروني</h3>
        <Button variant="primary" size="sm" onClick={() => setShowForm(!showForm)}><Mail className="w-4 h-4" />إضافة حساب</Button>
      </div>
      {showForm && (
        <div className="rounded-lg p-3 grid grid-cols-2 gap-2" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
          <input className="px-2 py-1.5 rounded text-xs" placeholder="الاسم" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
            value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
          <input className="px-2 py-1.5 rounded text-xs" placeholder="البريد الإلكتروني" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
            value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          <input className="px-2 py-1.5 rounded text-xs" placeholder={إمضاء} style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
            value={form.signature} onChange={e => setForm(f => ({ ...f, signature: e.target.value }))} />
          <div className="flex items-center gap-1">
            <input className="flex-1 px-2 py-1.5 rounded text-xs" placeholder="SMTP Host" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
              value={form.smtp_host} onChange={e => setForm(f => ({ ...f, smtp_host: e.target.value }))} />
            <input className="flex-1 px-2 py-1.5 rounded text-xs" placeholder="IMAP Host" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
              value={form.imap_host} onChange={e => setForm(f => ({ ...f, imap_host: e.target.value }))} />
          </div>
          <div className="col-span-2 flex justify-end gap-2">
            <Button variant="primary" size="sm" onClick={create}><Save className="w-3 h-3" />حفظ</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>إلغاء</Button>
          </div>
        </div>
      )}
      {accounts.map(a => (
        <div key={a.id} className="flex items-center justify-between p-2.5 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--ds-text-primary)' }}>{a.display_name || a.email}</div>
            <div className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>{a.email} · {a.status}</div>
          </div>
          <button onClick={() => deleteAccount(a.id)} className="p-1 rounded" style={{ color: '#ef4444' }}><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
    </div>
  );
}
