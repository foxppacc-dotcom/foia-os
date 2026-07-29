import { useState, useEffect } from 'react';
import { api } from '../api';
import { Plus, Search, Globe, Trash2, Eye, EyeOff, KeyRound } from 'lucide-react';

export default function Portals() {
  const [portals, setPortals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    portal_name: '', portal_url: '', username: '', registered_email: '', password: '', agency: ''
  });
  const [passwordModal, setPasswordModal] = useState(null); // { id, password, portal_name }
  const [search, setSearch] = useState('');

  const fetchPortals = () => {
    api.get('/api/portals')
      .then(d => setPortals(Array.isArray(d) ? d : d.data || []))
      .catch(e => console.error('[Portals] fetch failed:', e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchPortals(); }, []);

  const createPortal = async () => {
    if (!form.portal_name.trim() || !form.portal_url.trim()) return;
    const payload = {
      portal_name: form.portal_name,
      portal_url: form.portal_url,
      username: form.username || null,
      registered_email: form.registered_email || null,
      password: form.password || null,
      agency: form.agency || null,
    };
    await api.post('/api/portals', payload);
    setShowForm(false);
    setForm({ portal_name: '', portal_url: '', username: '', registered_email: '', password: '', agency: '' });
    fetchPortals();
  };

  const deletePortal = async (id) => {
    if (!confirm('هل أنت متأكد من حذف هذه البوابة؟')) return;
    await api.delete(`/api/portals/${id}`);
    fetchPortals();
  };

  const decryptPassword = async (id, portalName) => {
    try {
      const res = await api.post(`/api/portals/${id}/decrypt`);
      setPasswordModal({ id, password: res.password || res.data?.password || '—', portal_name: portalName });
    } catch (err) {
      alert('فشل فك تشفير كلمة المرور: ' + err.message);
    }
  };

  const filtered = portals.filter(p =>
    !search ||
    p.portal_name?.toLowerCase().includes(search.toLowerCase()) ||
    p.portal_url?.toLowerCase().includes(search.toLowerCase()) ||
    p.username?.toLowerCase().includes(search.toLowerCase()) ||
    p.agency?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-[#D4A843] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">إدارة البوابات الإلكترونية</h1>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 btn-accent px-4 py-2 text-sm">
          <Plus className="w-4 h-4" />
          إضافة بوابة
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث عن بوابة..." className="w-full pr-10 pl-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white placeholder-gray-500 focus:outline-none focus:border-[#D4A843] transition-all" />
      </div>

      {/* Add Form */}
      {showForm && (
        <div className="card-container rounded-2xl p-5 animate-slideUp">
          <h2 className="text-sm font-semibold var(--accent) mb-4">إضافة بوابة جديدة</h2>
          <div className="space-y-3">
            <div className="flex gap-3">
              <input value={form.portal_name} onChange={e => setForm({...form, portal_name: e.target.value})} placeholder="اسم البوابة" className="flex-1 px-4 py-3 input-base" />
              <input value={form.portal_url} onChange={e => setForm({...form, portal_url: e.target.value})} placeholder="رابط البوابة" className="flex-1 px-4 py-3 input-base" />
            </div>
            <div className="flex gap-3">
              <input value={form.username} onChange={e => setForm({...form, username: e.target.value})} placeholder="اسم المستخدم" className="flex-1 px-4 py-3 input-base" />
              <input value={form.registered_email} onChange={e => setForm({...form, registered_email: e.target.value})} placeholder="البريد الإلكتروني المسجل" className="flex-1 px-4 py-3 input-base" />
            </div>
            <div className="flex gap-3">
              <input value={form.password} onChange={e => setForm({...form, password: e.target.value})} placeholder="كلمة المرور (مشفر)" type="password" className="flex-1 px-4 py-3 input-base" />
              <input value={form.agency} onChange={e => setForm({...form, agency: e.target.value})} placeholder="الجهة" className="flex-1 px-4 py-3 input-base" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowForm(false)} className="btn-secondary px-4 py-2 text-sm">إلغاء</button>
              <button onClick={createPortal} className="btn-accent px-5 py-2 text-sm">إضافة</button>
            </div>
          </div>
        </div>
      )}

      {/* Portals List */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center card-container rounded-2xl">
          <Globe className="w-12 h-12 text-gray-600 mb-3" />
          <h3 className="text-base font-medium text-gray-400 mb-1">لا توجد بوابات</h3>
          <p className="text-sm text-gray-600 mb-4">لم يتم إضافة أي بوابات إلكترونية بعد</p>
          <button onClick={() => setShowForm(true)} className="btn-accent px-5 py-2.5 text-sm">إضافة بوابة</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(p => (
            <div key={p.id} className="card-container rounded-2xl p-5 hover:border-[#D4A84330] transition-all duration-300">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    p.is_active
                      ? 'bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20'
                      : 'bg-gray-700/20 text-gray-500 border border-gray-700/30'
                  }`}>
                    <Globe className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate">{p.portal_name}</h3>
                    <a href={p.portal_url} target="_blank" rel="noopener noreferrer" className="text-[11px] var(--accent) hover:underline truncate block">
                      {p.portal_url}
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => decryptPassword(p.id, p.portal_name)} className="p-2 rounded-lg text-gray-500 hover:var(--accent) hover:bg-[#D4A843]/10 transition-all" title="كشف الباسوورد">
                    <KeyRound className="w-4 h-4" />
                  </button>
                  <button onClick={() => deletePortal(p.id)} className="p-2 rounded-lg text-gray-600 hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-all">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    p.is_active
                      ? 'bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20'
                      : 'bg-gray-700/20 text-gray-500 border border-gray-700/30'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${p.is_active ? 'bg-[#10B981]' : 'bg-gray-500'}`} />
                    {p.is_active ? 'نشط' : 'غير نشط'}
                  </span>
                  {p.last_used && (
                    <span className="text-[10px] text-gray-600">آخر استخدام: {new Date(p.last_used).toLocaleDateString('ar-EG')}</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {p.username && (
                    <p className="text-[11px] text-gray-400">
                      <span className="text-gray-600">👤 اسم المستخدم: </span>{p.username}
                    </p>
                  )}
                  {p.registered_email && (
                    <p className="text-[11px] text-gray-400">
                      <span className="text-gray-600">📧 البريد: </span>{p.registered_email}
                    </p>
                  )}
                  {p.agency && (
                    <p className="text-[11px] text-gray-400">
                      <span className="text-gray-600">🏛️ الجهة: </span>{p.agency}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Password Reveal Modal */}
      {passwordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setPasswordModal(null)}>
          <div className="bg-[#111122] border border-[#1F1F2A] rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl animate-slideUp" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#D4A843]/10 border border-[#D4A843]/20 flex items-center justify-center">
                <KeyRound className="w-5 h-5 var(--accent)" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">كلمة المرور</h3>
                <p className="text-[11px] text-gray-500">{passwordModal.portal_name}</p>
              </div>
            </div>
            <div className="bg-[#0A0A0F] rounded-xl p-4 border border-[#1F1F2A] mb-4">
              <p className="text-lg font-mono var(--accent) text-center tracking-wider break-all" dir="ltr">
                {passwordModal.password}
              </p>
            </div>
            <div className="flex justify-center">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(passwordModal.password);
                  alert('تم نسخ كلمة المرور');
                }}
                className="px-4 py-2 rounded-xl font-medium text-sm bg-[#1F1F2A] text-gray-300 hover:text-white hover:bg-[#2a2a3a] transition-all"
              >
                نسخ كلمة المرور
              </button>
              <button onClick={() => setPasswordModal(null)} className="btn-secondary px-4 py-2 text-sm mr-2">
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
