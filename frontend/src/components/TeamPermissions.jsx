import { useState, useEffect } from 'react';
import { api } from '../api';
import { Plus, Trash2, KeyRound, Search, UserCog, ShieldCheck } from 'lucide-react';
import { useToast } from './ui/Toast';
import Button from './ui/Button';
import Input from './ui/Input';
import Select from './ui/Select';
import Card from './ui/Card';
import Badge from './ui/Badge';
import Modal from './ui/Modal';
import ConfirmDialog from './ui/ConfirmDialog';
import EmptyState from './ui/EmptyState';
import Spinner from './ui/Spinner';
import { TableShell, Thead, Th, Td, Tr } from './ui/Table';

const ROLE_LABEL = { admin: 'مدير النظام', manager: 'مدير', agent: 'وكيل', editor: 'محرر', viewer: 'مشاهد' };
const ROLES = ['admin', 'manager', 'agent', 'editor', 'viewer'];
const ACTION_LABEL = { view: 'عرض', create: 'إنشاء', edit: 'تعديل', delete: 'حذف', move: 'نقل', export: 'تصدير', manage: 'إدارة', invite: 'دعوة' };

export default function TeamPermissions() {
  const toast = useToast();
  const [tab, setTab] = useState('members');

  return (
    <div className="space-y-5">
      <div className="inline-flex gap-1 p-1 rounded-2xl" style={{ background: 'var(--bg-tertiary)' }}>
        {[{ key: 'members', label: 'الأعضاء' }, { key: 'permissions', label: 'الصلاحيات' }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
            style={{ background: tab === t.key ? 'var(--bg-secondary)' : 'transparent', color: tab === t.key ? 'var(--accent)' : 'var(--text-muted)', boxShadow: tab === t.key ? 'var(--shadow-sm)' : 'none' }}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'members' ? <MembersPanel toast={toast} /> : <PermissionsPanel toast={toast} />}
    </div>
  );
}

function MembersPanel({ toast }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'viewer' });
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const fetchUsers = () => {
    setLoading(true);
    api.get('/users').then(d => { setUsers(d.data || []); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(() => { fetchUsers(); }, []);

  const filtered = users.filter(u =>
    (!search || u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase())) &&
    (!roleFilter || u.role === roleFilter)
  );

  const createUser = async () => {
    if (!form.name || !form.email || !form.password) return;
    try {
      await api.post('/users', form);
      toast.success('تمت إضافة العضو');
      setShowAdd(false);
      setForm({ name: '', email: '', password: '', role: 'viewer' });
      fetchUsers();
    } catch (e) { toast.error(e.message); }
  };

  const updateRole = async (id, role) => {
    try { await api.put(`/users/${id}`, { role }); toast.success('تم تحديث الدور'); fetchUsers(); }
    catch (e) { toast.error(e.message); }
  };

  const toggleActive = async (u) => {
    try { await api.put(`/users/${u.id}`, { is_active: !u.is_active }); toast.success(u.is_active ? 'تم تعطيل العضو' : 'تم تفعيل العضو'); fetchUsers(); }
    catch (e) { toast.error(e.message); }
  };

  const doResetPassword = async () => {
    if (!resetPassword || resetPassword.length < 6) { toast.error('كلمة المرور يجب ألا تقل عن 6 أحرف'); return; }
    try {
      await api.post(`/users/${resetTarget.id}/reset-password`, { password: resetPassword });
      toast.success('تم إعادة تعيين كلمة المرور');
      setResetTarget(null);
      setResetPassword('');
    } catch (e) { toast.error(e.message); }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      await api.delete(`/users/${confirmDelete.id}`);
      toast.success('تم حذف العضو');
      setConfirmDelete(null);
      fetchUsers();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Input containerClassName="flex-1 min-w-[200px]" value={search} onChange={e => setSearch(e.target.value)} icon={Search} placeholder="بحث بالاسم أو البريد الإلكتروني..." />
        <Select containerClassName="w-40" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="">كل الأدوار</option>
          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </Select>
        <Button icon={Plus} onClick={() => setShowAdd(true)}>إضافة عضو</Button>
      </div>

      {loading ? <Spinner full /> : filtered.length === 0 ? (
        <EmptyState icon={UserCog} title="لا يوجد أعضاء" />
      ) : (
        <TableShell>
          <Thead><Th>العضو</Th><Th>الدور</Th><Th>الحالة</Th><Th align="center">إجراءات</Th></Thead>
          <tbody>
            {filtered.map(u => (
              <Tr key={u.id}>
                <Td>
                  <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{u.name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{u.email}</p>
                </Td>
                <Td>
                  <select value={u.role} onChange={e => updateRole(u.id, e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}>
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </Td>
                <Td>
                  <button onClick={() => toggleActive(u)}>
                    <Badge variant={u.is_active === false ? 'neutral' : 'success'} dot>{u.is_active === false ? 'معطّل' : 'نشط'}</Badge>
                  </button>
                </Td>
                <Td align="center">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => setResetTarget(u)} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}
                      onMouseOver={e => e.currentTarget.style.color = 'var(--accent)'} onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'} title="إعادة تعيين كلمة المرور">
                      <KeyRound className="w-4 h-4" />
                    </button>
                    <button onClick={() => setConfirmDelete(u)} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}
                      onMouseOver={e => e.currentTarget.style.color = 'var(--danger)'} onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="إضافة عضو جديد">
        <div className="space-y-3">
          <Input label="الاسم" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <Input label="البريد الإلكتروني" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <Input label="كلمة المرور" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          <Select label="الدور" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" onClick={createUser}>إضافة</Button>
            <Button variant="secondary" className="flex-1" onClick={() => setShowAdd(false)}>إلغاء</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!resetTarget} onClose={() => { setResetTarget(null); setResetPassword(''); }} title={`إعادة تعيين كلمة مرور: ${resetTarget?.name || ''}`}>
        <div className="space-y-3">
          <Input label="كلمة المرور الجديدة" type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="6 أحرف على الأقل" />
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" onClick={doResetPassword}>حفظ</Button>
            <Button variant="secondary" className="flex-1" onClick={() => { setResetTarget(null); setResetPassword(''); }}>إلغاء</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={doDelete}
        title="حذف العضو" confirmLabel="حذف" message={`هل أنت متأكد من حذف "${confirmDelete?.name}"؟ لا يمكن التراجع عن هذا الإجراء.`} />
    </div>
  );
}

function PermissionsPanel({ toast }) {
  const [schema, setSchema] = useState(null);
  const [matrix, setMatrix] = useState([]); // [{role, resource, action, allowed}]
  const [activeRole, setActiveRole] = useState('manager');
  const [loading, setLoading] = useState(true);

  const fetchAll = () => {
    setLoading(true);
    Promise.all([api.get('/permissions/schema'), api.get('/permissions')])
      .then(([s, p]) => { setSchema(s); setMatrix(p.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(() => { fetchAll(); }, []);

  const isAllowed = (role, resource, action) => {
    const row = matrix.find(m => m.role === role && m.resource === resource && m.action === action);
    return row ? row.allowed !== false : false;
  };

  const toggle = async (resource, action) => {
    const current = isAllowed(activeRole, resource, action);
    const next = !current;
    setMatrix(prev => {
      const exists = prev.find(m => m.role === activeRole && m.resource === resource && m.action === action);
      if (exists) return prev.map(m => m === exists ? { ...m, allowed: next } : m);
      return [...prev, { role: activeRole, resource, action, allowed: next }];
    });
    try {
      await api.put('/permissions', { role: activeRole, resource, action, allowed: next });
    } catch (e) {
      toast.error(e.message);
      fetchAll();
    }
  };

  if (loading) return <Spinner full />;
  if (!schema) return <EmptyState icon={ShieldCheck} title="تعذر تحميل نظام الصلاحيات" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 flex-wrap">
        {ROLES.map(r => (
          <button key={r} onClick={() => setActiveRole(r)}
            className="px-3.5 py-2 rounded-xl text-sm font-medium transition-all"
            style={{ background: activeRole === r ? 'var(--accent-subtle)' : 'transparent', color: activeRole === r ? 'var(--accent)' : 'var(--text-muted)' }}>
            {ROLE_LABEL[r]}
          </button>
        ))}
      </div>

      {activeRole === 'admin' ? (
        <Card>
          <p className="text-sm text-center py-6" style={{ color: 'var(--text-secondary)' }}>
            مدير النظام لديه صلاحية كاملة على كل الموارد دائمًا — لا يمكن تقييدها.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {schema.resources.map(res => (
            <Card key={res.key} title={res.label}>
              <div className="flex items-center gap-4 flex-wrap">
                {res.actions.map(action => (
                  <label key={action} className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={isAllowed(activeRole, res.key, action)} onChange={() => toggle(res.key, action)}
                      className="w-4 h-4 rounded" style={{ accentColor: 'var(--accent)' }} />
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{ACTION_LABEL[action] || action}</span>
                  </label>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
