import { useState, useEffect } from 'react';
import { api } from '../api';
import { Plus, Search, Upload, Trash2, Edit3, Save, X } from 'lucide-react';

export default function Agencies() {
  const [agencies, setAgencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name_en: '', name_ar: '', state: '', city: '', type: '', email: '', phone: '', portal_url: '', notes: '' });

  const fetchAgencies = () => {
    api.get('/agencies?limit=1000').then(d => {
      setAgencies(d?.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { fetchAgencies(); }, []);

  const filtered = agencies.filter(a =>
    !search || a.name_ar?.includes(search) || a.name_en?.toLowerCase().includes(search.toLowerCase()) ||
    a.state?.toLowerCase().includes(search.toLowerCase()) || a.city?.toLowerCase().includes(search.toLowerCase())
  );

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/agencies/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('foia_token') },
        body: formData
      });
      const data = await res.json();
      alert(data.message || `✅ تم استيراد ${data.imported} جهة`);
      fetchAgencies();
    } catch (err) {
      alert('فشل الرفع: ' + err.message);
    }
    e.target.value = '';
  };

  const addAgency = async () => {
    if (!editForm.name_en.trim()) return;
    try {
      await api.post('/agencies', editForm);
      setEditForm({ name_en: '', name_ar: '', state: '', city: '', type: '', email: '', phone: '', portal_url: '', notes: '' });
      setShowAddForm(false);
      fetchAgencies();
    } catch (e) { alert(e.message); }
  };

  const startEdit = (a) => {
    setEditingId(a.id);
    setEditForm({ name_en: a.name_en, name_ar: a.name_ar || '', state: a.state || '', city: a.city || '', type: a.type || '', email: a.email || '', phone: a.phone || '', portal_url: a.portal_url || '', notes: a.notes || '' });
  };

  const saveEdit = async (id) => {
    try {
      await api.put(`/agencies/${id}`, editForm);
      setEditingId(null);
      fetchAgencies();
    } catch (e) { alert(e.message); }
  };

  const deleteAgency = async (id) => {
    if (!confirm('هل أنت متأكد من حذف هذه الجهة؟')) return;
    await api.delete(`/agencies/${id}`);
    fetchAgencies();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
    </div>
  );

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>جهات إنفاذ القانون</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{agencies.length} جهة</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Upload Excel */}
          <label className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            <Upload className="w-4 h-4" />
            رفع Excel
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} className="hidden" />
          </label>
          <button onClick={() => { setShowAddForm(true); setEditForm({ name_en: '', name_ar: '', state: '', city: '', type: '', email: '', phone: '', portal_url: '', notes: '' }); }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{ background: 'var(--accent)', color: '#1A1A2E' }}>
            <Plus className="w-4 h-4" />
            إضافة جهة
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="بحث باسم الجهة، الولاية، أو المدينة..."
          className="w-full px-10 py-2.5 pr-10 rounded-xl border text-sm focus:outline-none"
          style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
      </div>

      {/* Add Form */}
      {showAddForm && (
        <div className="p-5 rounded-xl border animate-slideUp" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--accent)' }}>إضافة جهة جديدة</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <input value={editForm.name_en} onChange={e => setEditForm({...editForm, name_en: e.target.value})} placeholder="English Name *" className="p-2.5 rounded-xl border text-sm" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
            <input value={editForm.name_ar} onChange={e => setEditForm({...editForm, name_ar: e.target.value})} placeholder="الاسم بالعربية" className="p-2.5 rounded-xl border text-sm" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
            <input value={editForm.state} onChange={e => setEditForm({...editForm, state: e.target.value})} placeholder="الولاية" className="p-2.5 rounded-xl border text-sm" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
            <input value={editForm.city} onChange={e => setEditForm({...editForm, city: e.target.value})} placeholder="المدينة" className="p-2.5 rounded-xl border text-sm" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
            <select value={editForm.type} onChange={e => setEditForm({...editForm, type: e.target.value})} className="p-2.5 rounded-xl border text-sm" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <option value="">اختر النوع</option>
              <option value="federal">فيدرالي</option>
              <option value="state">ولاية</option>
              <option value="municipal">بلدية</option>
              <option value="sheriff">شريف</option>
            </select>
            <input value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} placeholder="البريد الإلكتروني" className="p-2.5 rounded-xl border text-sm" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
          </div>
          <div className="flex gap-2 justify-end mt-3">
            <button onClick={() => setShowAddForm(false)} className="px-4 py-2 rounded-xl text-sm border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>إلغاء</button>
            <button onClick={addAgency} className="px-5 py-2 rounded-xl text-sm font-semibold" style={{ background: 'var(--accent)', color: '#1A1A2E' }}>إضافة</button>
          </div>
        </div>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>لا توجد جهات. ارفع ملف Excel أو أضف جهة يدوياً.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(a => (
            <div key={a.id} className="p-4 rounded-xl border transition-all"
              style={{ background: 'var(--bg-secondary)', borderColor: editingId === a.id ? 'var(--accent)' : 'var(--border)' }}>
              
              {editingId === a.id ? (
                /* Edit Mode */
                <div className="space-y-2">
                  <input value={editForm.name_en} onChange={e => setEditForm({...editForm, name_en: e.target.value})} className="w-full p-2 rounded-lg border text-xs" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                  <input value={editForm.name_ar} onChange={e => setEditForm({...editForm, name_ar: e.target.value})} className="w-full p-2 rounded-lg border text-xs" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} className="p-2 rounded-lg border text-xs" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                    <input value={editForm.phone} onChange={e => setEditForm({...editForm, phone: e.target.value})} className="p-2 rounded-lg border text-xs" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                    <input value={editForm.state} onChange={e => setEditForm({...editForm, state: e.target.value})} className="p-2 rounded-lg border text-xs" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                    <input value={editForm.city} onChange={e => setEditForm({...editForm, city: e.target.value})} className="p-2 rounded-lg border text-xs" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditingId(null)} className="p-1.5 rounded" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                    <button onClick={() => saveEdit(a.id)} className="p-1.5 rounded" style={{ color: '#10B981' }}><Save className="w-4 h-4" /></button>
                  </div>
                </div>
              ) : (
                /* View Mode */
                <>
                  <div className="flex items-start gap-3 mb-2">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-sm font-bold"
                      style={{ background: 'var(--accent)20', color: 'var(--accent)' }}>
                      {a.name_ar?.charAt(0) || '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{a.name_ar || a.name_en}</h3>
                      <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{a.name_en}</p>
                      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] mt-1"
                        style={{ background: (a.type === 'federal' ? '#3B82F6' : a.type === 'state' ? '#8B5CF6' : a.type === 'municipal' ? '#F59E0B' : '#10B981') + '15', color: a.type === 'federal' ? '#3B82F6' : a.type === 'state' ? '#8B5CF6' : a.type === 'municipal' ? '#F59E0B' : '#10B981' }}>
                        {a.type === 'federal' ? 'فيدرالي' : a.type === 'state' ? 'ولاية' : a.type === 'sheriff' ? 'شريف' : a.type === 'municipal' ? 'بلدية' : a.type || '—'}
                      </span>
                    </div>
                    {/* Action Buttons */}
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => startEdit(a)}
                        className="p-1.5 rounded-lg transition-all"
                        style={{ color: 'var(--text-muted)' }}
                        onMouseOver={e => e.currentTarget.style.color = 'var(--accent)'}
                        onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}>
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => deleteAgency(a.id)}
                        className="p-1.5 rounded-lg transition-all"
                        style={{ color: 'var(--text-muted)' }}
                        onMouseOver={e => e.currentTarget.style.color = '#EF4444'}
                        onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {(a.city || a.state) && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>📍 {[a.city, a.state].filter(Boolean).join(', ')}</p>}
                    {a.email && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>📧 {a.email}</p>}
                    {a.phone && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>📞 {a.phone}</p>}
                    {a.portal_url && <a href={a.portal_url} target="_blank" className="text-[11px] inline-block truncate max-w-full" style={{ color: 'var(--accent)' }}>🔗 {a.portal_url}</a>}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
