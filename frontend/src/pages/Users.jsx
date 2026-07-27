import { useState, useEffect } from 'react';
import { api } from '../api';
import { Plus, Trash2, Shield } from 'lucide-react';

const roleColors = { admin: '#EF4444', manager: '#F59E0B', member: '#3B82F6' };
const roleNames = { admin: 'مدير النظام', manager: 'مدير', member: 'عضو' };

export default function Users() {
  const [users, setUsers] = useState([]);
  const [specialties, setSpecialties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'member', selectedSpecialties: [] });

  const fetchUsers = () => api.getUsers().then(d => { setUsers(d.data || []); setLoading(false); }).catch(() => setLoading(false));
  const fetchSpecialties = () => api.getSpecialties().then(d => setSpecialties(d.data || [])).catch(() => {});
  
  useEffect(() => { fetchUsers(); fetchSpecialties(); }, []);

  const toggleSpecialty = (id) => {
    setForm(prev => ({
      ...prev,
      selectedSpecialties: prev.selectedSpecialties.includes(id)
        ? prev.selectedSpecialties.filter(x => x !== id)
        : [...prev.selectedSpecialties, id]
    }));
  };

  const createUser = async () => {
    if (!form.name || !form.email || !form.password) return;
    await api.createUser({ 
      ...form, 
      specialties: form.selectedSpecialties,
      selectedSpecialties: undefined
    });
    setShowForm(false); 
    setForm({ name: '', email: '', password: '', role: 'member', selectedSpecialties: [] });
    fetchUsers();
  };

  const deleteUser = async (id) => {
    if (confirm('متأكد من حذف هذا المستخدم؟')) { await api.deleteUser(id); fetchUsers(); }
  };

  const getSpecialtyNameById = (id) => {
    const s = specialties.find(sp => sp.id === id);
    return s ? `${s.icon || '📋'} ${s.name_ar}` : '';
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#D4A843] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>إدارة المستخدمين</h1>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm" style={{ background: 'var(--accent)', color: '#1A1A2E' }}>
          <Plus className="w-4 h-4" /> مستخدم جديد
        </button>
      </div>

      {showForm && (
        <div className="p-5 rounded-xl border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
          <h3 className="font-semibold mb-3" style={{ color: 'var(--accent)' }}>مستخدم جديد</h3>
          <div className="grid grid-cols-2 gap-3">
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="الاسم"
              className="px-4 py-2.5 rounded-xl border" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
            <input value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="البريد الإلكتروني"
              className="px-4 py-2.5 rounded-xl border" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
            <input value={form.password} onChange={e => setForm({...form, password: e.target.value})} placeholder="كلمة المرور" type="password"
              className="px-4 py-2.5 rounded-xl border" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
            <select value={form.role} onChange={e => setForm({...form, role: e.target.value})}
              className="px-4 py-2.5 rounded-xl border" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <option value="member">عضو</option>
              <option value="manager">مدير</option>
              <option value="admin">مدير النظام</option>
              <option value="viewer">مشاهد</option>
            </select>
          </div>
          
          {/* Specialties selector */}
          {specialties.length > 0 && (
            <div className="mt-3">
              <label className="text-sm font-medium mb-2 block" style={{ color: 'var(--text-muted)' }}>التخصصات</label>
              <div className="flex flex-wrap gap-2">
                {specialties.map(sp => (
                  <button key={sp.id} onClick={() => toggleSpecialty(sp.id)}
                    className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all border ${form.selectedSpecialties.includes(sp.id) ? 'border-[#D4A843]' : ''}`}
                    style={{ 
                      background: form.selectedSpecialties.includes(sp.id) ? 'var(--accent)20' : 'var(--bg-tertiary)',
                      borderColor: form.selectedSpecialties.includes(sp.id) ? 'var(--accent)' : 'var(--border)',
                      color: form.selectedSpecialties.includes(sp.id) ? 'var(--accent)' : 'var(--text-secondary)'
                    }}>
                    {sp.icon} {sp.name_ar}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end mt-3">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl text-sm" style={{ color: 'var(--text-muted)' }}>إلغاء</button>
            <button onClick={createUser} className="px-5 py-2 rounded-xl text-sm font-semibold" style={{ background: 'var(--accent)', color: '#1A1A2E' }}>إضافة</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border)' }}>
              <th className="px-4 py-3 text-right text-xs font-medium" style={{ color: 'var(--text-muted)' }}>الاسم</th>
              <th className="px-4 py-3 text-right text-xs font-medium" style={{ color: 'var(--text-muted)' }}>البريد</th>
              <th className="px-4 py-3 text-right text-xs font-medium" style={{ color: 'var(--text-muted)' }}>الدور</th>
              <th className="px-4 py-3 text-right text-xs font-medium" style={{ color: 'var(--text-muted)' }}>التخصصات</th>
              <th className="px-4 py-3 text-right text-xs font-medium" style={{ color: 'var(--text-muted)' }}>الفريق</th>
              <th className="px-4 py-3 text-right text-xs font-medium" style={{ color: 'var(--text-muted)' }}>الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {users.map(u => (
              <tr key={u.id} className="hover:bg-[var(--bg-tertiary)] transition-colors">
                <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{u.name}</td>
                <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{u.email}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
                    style={{ backgroundColor: `${roleColors[u.role]}15`, color: roleColors[u.role], border: `1px solid ${roleColors[u.role]}30` }}>
                    <Shield className="w-3 h-3" /> {roleNames[u.role] || u.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(u.specialties || []).length > 0 ? (
                      (u.specialties || []).map(spId => (
                        <span key={spId} className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--accent)15', color: 'var(--accent)' }}>
                          {getSpecialtyNameById(spId) || `#${spId}`}
                        </span>
                      ))
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>{u.team_name || '—'}</td>
                <td className="px-4 py-3">
                  <button onClick={() => deleteUser(u.id)} className="p-1.5 rounded-lg hover:bg-[#EF4444]/10" style={{ color: 'var(--text-muted)' }}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
