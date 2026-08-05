import { useState, useEffect } from 'react';
import { api, getCurrentUser } from '../api';
import { Plus, Trash2, KeyRound, Search, UserCog, ShieldCheck, Pencil, Check, X, Save, Undo2 } from 'lucide-react';
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

const ACTION_LABEL = { view: 'عرض', view_all: 'عرض كل القضايا (وليس المسندة فقط)', create: 'إنشاء', edit: 'تعديل', delete: 'حذف', move: 'نقل', export: 'تصدير', manage: 'إدارة', invite: 'دعوة' };

export default function TeamPermissions() {
  const toast = useToast();
  const me = getCurrentUser();
  const isAdmin = me?.role === 'admin';
  const [tab, setTab] = useState('members');
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(true);

  const fetchRoles = () => {
    setRolesLoading(true);
    api.get('/roles').then(d => setRoles(d.roles || [])).catch(() => {}).finally(() => setRolesLoading(false));
  };
  useEffect(() => { fetchRoles(); }, []);

  const roleLabel = (name) => roles.find(r => r.name === name)?.label || name;

  const tabs = [
    { key: 'members', label: 'الأعضاء' },
    ...(isAdmin ? [{ key: 'roles', label: 'الأدوار' }, { key: 'permissions', label: 'الصلاحيات' }] : []),
  ];

  return (
    <div className="space-y-5">
      <div className="inline-flex gap-1 p-1 rounded-2xl" style={{ background: 'var(--bg-tertiary)' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
            style={{ background: tab === t.key ? 'var(--bg-secondary)' : 'transparent', color: tab === t.key ? 'var(--accent)' : 'var(--text-muted)', boxShadow: tab === t.key ? 'var(--shadow-sm)' : 'none' }}>
            {t.label}
          </button>
        ))}
      </div>
      {rolesLoading ? <Spinner full /> : (
        tab === 'members' ? <MembersPanel toast={toast} roles={roles} roleLabel={roleLabel} isAdmin={isAdmin} /> :
        tab === 'roles' && isAdmin ? <RolesPanel toast={toast} roles={roles} onRolesChanged={fetchRoles} /> :
        tab === 'permissions' && isAdmin ? <PermissionsPanel toast={toast} roles={roles.filter(r => r.name !== 'admin')} roleLabel={roleLabel} /> :
        <MembersPanel toast={toast} roles={roles} roleLabel={roleLabel} isAdmin={isAdmin} />
      )}
    </div>
  );
}

function MembersPanel({ toast, roles, roleLabel, isAdmin }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: roles[0]?.name || '' });
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const fetchUsers = () => {
    setLoading(true);
    api.get('/users').then(d => { setUsers(d.data || []); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(() => { fetchUsers(); }, []);
  useEffect(() => { if (!form.role && roles.length) setForm(f => ({ ...f, role: roles[0].name })); }, [roles]);

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
      setForm({ name: '', email: '', password: '', role: roles[0]?.name || '' });
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
          {roles.map(r => <option key={r.name} value={r.name}>{r.label}</option>)}
        </Select>
        {isAdmin && <Button icon={Plus} onClick={() => setShowAdd(true)}>إضافة عضو</Button>}
      </div>

      {loading ? <Spinner full /> : filtered.length === 0 ? (
        <EmptyState icon={UserCog} title="لا يوجد أعضاء" />
      ) : (
        <TableShell>
          <Thead><Th>العضو</Th><Th>الدور</Th><Th>الحالة</Th>{isAdmin && <Th align="center">إجراءات</Th>}</Thead>
          <tbody>
            {filtered.map(u => (
              <Tr key={u.id}>
                <Td>
                  <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{u.name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{u.email}</p>
                </Td>
                <Td>
                  {isAdmin ? (
                    <select value={u.role} onChange={e => updateRole(u.id, e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}>
                      {!roles.find(r => r.name === u.role) && <option value={u.role}>{roleLabel(u.role)}</option>}
                      {roles.map(r => <option key={r.name} value={r.name}>{r.label}</option>)}
                    </select>
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{roleLabel(u.role)}</span>
                  )}
                </Td>
                <Td>
                  {isAdmin ? (
                    <button onClick={() => toggleActive(u)}>
                      <Badge variant={u.is_active === false ? 'neutral' : 'success'} dot>{u.is_active === false ? 'معطّل' : 'نشط'}</Badge>
                    </button>
                  ) : (
                    <Badge variant={u.is_active === false ? 'neutral' : 'success'} dot>{u.is_active === false ? 'معطّل' : 'نشط'}</Badge>
                  )}
                </Td>
                {isAdmin && (
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
                )}
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
            {roles.map(r => <option key={r.name} value={r.name}>{r.label}</option>)}
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

function RolesPanel({ toast, roles, onRolesChanged }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', label: '' });
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const createRole = async () => {
    if (!form.name.trim()) return;
    try {
      await api.post('/roles', { name: form.name.trim(), label: form.label.trim() || form.name.trim() });
      toast.success('تم إنشاء الدور');
      setForm({ name: '', label: '' });
      setShowAdd(false);
      onRolesChanged();
    } catch (e) { toast.error(e.message); }
  };

  const saveLabel = async (id) => {
    try { await api.put(`/roles/${id}`, { label: editLabel }); toast.success('تم التحديث'); setEditingId(null); onRolesChanged(); }
    catch (e) { toast.error(e.message); }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try { await api.delete(`/roles/${confirmDelete.id}`); toast.success('تم حذف الدور'); setConfirmDelete(null); onRolesChanged(); }
    catch (e) { toast.error(e.message); setConfirmDelete(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>الأدوار المتاحة لإسناد الأعضاء إليها، والتحكم في صلاحيات كل دور من تبويب "الصلاحيات".</p>
        <Button icon={Plus} onClick={() => setShowAdd(true)}>دور جديد</Button>
      </div>

      {roles.length === 0 ? <EmptyState icon={ShieldCheck} title="لا توجد أدوار" /> : (
        <TableShell>
          <Thead><Th>الاسم البرمجي</Th><Th>الاسم المعروض</Th><Th align="center">إجراءات</Th></Thead>
          <tbody>
            {roles.map(r => (
              <Tr key={r.id}>
                <Td><code className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>{r.name}</code></Td>
                <Td>
                  {editingId === r.id ? (
                    <div className="flex items-center gap-1.5">
                      <Input value={editLabel} onChange={e => setEditLabel(e.target.value)} containerClassName="flex-1" />
                      <button onClick={() => saveLabel(r.id)} style={{ color: 'var(--success)' }}><Check className="w-4 h-4" /></button>
                      <button onClick={() => setEditingId(null)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <button className="flex items-center gap-1.5" onClick={() => { setEditingId(r.id); setEditLabel(r.label); }} style={{ color: 'var(--text-primary)' }}>
                      {r.label} <Pencil className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                    </button>
                  )}
                </Td>
                <Td align="center">
                  {r.name !== 'admin' && (
                    <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}
                      onMouseOver={e => e.currentTarget.style.color = 'var(--danger)'} onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="دور جديد">
        <div className="space-y-3">
          <Input label="الاسم البرمجي (بالإنجليزية، بدون مسافات)" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="coordinator" />
          <Input label="الاسم المعروض" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="منسّق" />
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" onClick={createRole}>إنشاء</Button>
            <Button variant="secondary" className="flex-1" onClick={() => setShowAdd(false)}>إلغاء</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={doDelete}
        title="حذف الدور" confirmLabel="حذف" message={`هل أنت متأكد من حذف الدور "${confirmDelete?.label}"؟ سيفشل الحذف إذا كان هناك أعضاء مسندون لهذا الدور حاليًا.`} />
    </div>
  );
}

function PermissionsPanel({ toast, roles, roleLabel }) {
  const [schema, setSchema] = useState(null);
  const [matrix, setMatrix] = useState([]); // [{role, resource, action, allowed}] -- last saved state from server
  const [pending, setPending] = useState({}); // key `${role}|${resource}|${action}` -> {role, resource, action, allowed} -- unsaved edits
  const [activeRole, setActiveRole] = useState(roles[0]?.name || '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchAll = () => {
    setLoading(true);
    Promise.all([api.get('/permissions/schema'), api.get('/permissions')])
      .then(([s, p]) => { setSchema(s); setMatrix(p.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(() => { fetchAll(); }, []);
  useEffect(() => { if (!activeRole && roles.length) setActiveRole(roles[0].name); }, [roles]);

  // Two different fail-safe defaults exist server-side for an unconfigured
  // (no row yet) cell, and the checkbox must mirror whichever one actually
  // applies or it lies to the admin about what the role can really do:
  // - nav / production_line / cases.view_all: fail-OPEN (unconfigured =
  //   visible/unrestricted) so shipping this feature never silently hid
  //   something from an existing role that no one had configured yet.
  // - every other resource/action (requirePermission middleware): fail-
  //   CLOSED (unconfigured = denied) as the secure default for real
  //   permission gates.
  const defaultsOpen = (resource, action) => resource === 'nav' || resource === 'production_line' || (resource === 'cases' && action === 'view_all');
  const cellKey = (role, resource, action) => `${role}|${resource}|${action}`;
  const isAllowed = (role, resource, action) => {
    const key = cellKey(role, resource, action);
    if (key in pending) return pending[key].allowed;
    const row = matrix.find(m => m.role === role && m.resource === resource && m.action === action);
    if (row) return row.allowed !== false;
    return defaultsOpen(resource, action);
  };

  // Toggling only stages the change locally -- nothing hits the server until
  // "حفظ التغييرات" is clicked, so an admin can review a whole role's matrix
  // before committing it (and can discard a misclick without side effects).
  const toggle = (resource, action) => {
    const current = isAllowed(activeRole, resource, action);
    const key = cellKey(activeRole, resource, action);
    setPending(prev => ({ ...prev, [key]: { role: activeRole, resource, action, allowed: !current } }));
  };

  const pendingCount = Object.keys(pending).length;

  const discardChanges = () => setPending({});

  const saveChanges = async () => {
    const changes = Object.values(pending);
    if (!changes.length) return;
    setSaving(true);
    try {
      await Promise.all(changes.map(c => api.put('/permissions', c)));
      toast.success(`تم حفظ ${changes.length} تغيير`);
      setPending({});
      fetchAll();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner full />;
  if (!schema) return <EmptyState icon={ShieldCheck} title="تعذر تحميل نظام الصلاحيات" />;

  // Kept in sync with backend/src/routes/permissions.js RESOURCE_VIEW_NAV_KEYS —
  // any resource with a 'view' action drives its own sidebar link directly.
  const derivedNavKeys = schema.resources.filter(r => r.actions.includes('view')).map(r => r.key);

  return (
    <div className="space-y-4 pb-16">
      <div className="flex items-center gap-1 flex-wrap">
        {roles.map(r => (
          <button key={r.name} onClick={() => setActiveRole(r.name)}
            className="px-3.5 py-2 rounded-xl text-sm font-medium transition-all"
            style={{ background: activeRole === r.name ? 'var(--accent-subtle)' : 'transparent', color: activeRole === r.name ? 'var(--accent)' : 'var(--text-muted)' }}>
            {r.label}
          </button>
        ))}
      </div>

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

      {/* Navigation Visibility — which Sidebar items this role can see */}
      <Card title="رؤية القائمة الجانبية">
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          حدد عناصر القائمة الجانبية الظاهرة لهذا الدور — العنصر المخفي لا يظهر إطلاقًا (لا يشغل مساحة، لا يُعطَّل).
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          {(schema.navItems || []).map(item => {
            // Cases/Agencies/Pipeline/Production share their sidebar visibility
            // with that resource's own "عرض" checkbox above -- a role that can't
            // view a resource can't see its sidebar link either, and vice versa.
            // Keeping a second independent toggle for the same concept was the
            // actual bug: an admin would enable "عرض" up top and still find the
            // link hidden because this row was never separately switched on.
            const derivedFromResource = derivedNavKeys.includes(item.key);
            const checked = derivedFromResource ? isAllowed(activeRole, item.key, 'view') : isAllowed(activeRole, 'nav', item.key);
            return (
              <label key={item.key} className="flex items-center gap-2 select-none" style={{ cursor: derivedFromResource ? 'default' : 'pointer', opacity: derivedFromResource ? 0.7 : 1 }}
                title={derivedFromResource ? 'يتبع صلاحية "عرض" الخاصة بهذا المورد أعلاه' : undefined}>
                <input type="checkbox" checked={checked} disabled={derivedFromResource} onChange={() => !derivedFromResource && toggle('nav', item.key)}
                  className="w-4 h-4 rounded" style={{ accentColor: 'var(--accent)' }} />
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {item.label}{derivedFromResource && <span className="text-xs" style={{ color: 'var(--text-muted)' }}> (يتبع صلاحية العرض)</span>}
                </span>
              </label>
            );
          })}
        </div>
      </Card>

      {/* Production Line Visibility — which lists appear inside خط الإنتاج */}
      <Card title="رؤية خط الإنتاج">
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          حدد قوائم خط الإنتاج الظاهرة لهذا الدور — القائمة المخفية لا تظهر ولا يمكن التفاعل معها.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          {(schema.productionLists || []).map(list => (
            <label key={list.key} className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={isAllowed(activeRole, 'production_line', list.key)} onChange={() => toggle('production_line', list.key)}
                className="w-4 h-4 rounded" style={{ accentColor: 'var(--accent)' }} />
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{list.label}</span>
            </label>
          ))}
        </div>
      </Card>
      <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>مدير النظام (admin) لديه صلاحية كاملة على كل الموارد دائمًا — غير موجود في هذه القائمة لأنه لا يمكن تقييده.</p>

      {pendingCount > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 flex justify-center px-4 pb-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl border"
            style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-strong)', boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.15))' }}>
            <Badge variant="warning" dot>{pendingCount} تغيير غير محفوظ</Badge>
            <Button variant="secondary" icon={Undo2} onClick={discardChanges} disabled={saving}>تراجع</Button>
            <Button icon={Save} onClick={saveChanges} loading={saving}>حفظ التغييرات</Button>
          </div>
        </div>
      )}
    </div>
  );
}
