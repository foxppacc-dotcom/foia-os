import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Plus, Search, Upload } from 'lucide-react';

const STATUS_STYLES = {
  open: { bg: '#3B82F6', label: '🟦 مفتوحة' },
  in_progress: { bg: '#F59E0B', label: '🟡 قيد التنفيذ' },
  in_production: { bg: '#8B5CF6', label: '🎬 في الإنتاج' },
  closed: { bg: '#10B981', label: '🟢 مغلقة' },
};

export default function Cases() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [agencies, setAgencies] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [form, setForm] = useState({
    title: '', description: '', priority: 'medium', client_name: '',
    selectedAgencies: []
  });
  const navigate = useNavigate();

  const fetchCases = () => {
    api.getCases().then(d => {
      setCases(Array.isArray(d) ? d : d.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  const fetchAgencies = () => {
    api.get('/agencies?limit=500').then(d => {
      setAgencies(d?.data || []);
    }).catch(() => {});
  };

  useEffect(() => { fetchCases(); }, []);

  const toggleAgency = (agencyId) => {
    setForm(prev => {
      const exists = prev.selectedAgencies.find(a => a === agencyId);
      return {
        ...prev,
        selectedAgencies: exists
          ? prev.selectedAgencies.filter(a => a !== agencyId)
          : [...prev.selectedAgencies, agencyId]
      };
    });
  };

  const createCase = async () => {
    if (!form.title.trim()) return;
    try {
      const res = await api.post('/cases', {
        title: form.title,
        description: form.description,
        priority: form.priority,
        client_name: form.client_name,
        agencies: form.selectedAgencies.map(id => ({ agency_id: id }))
      });
      // Auto-classify to pipeline list 1 after creation
      const newId = res.id;
      if (newId && form.selectedAgencies.length > 0) {
        const reqs = await api.get(`/cases/${newId}`);
        for (const r of reqs.requests || []) {
          await api.put(`/requests/${r.id}/classification`, { classification_id: 1 });
        }
      }
      setShowForm(false);
      setForm({ title: '', description: '', priority: 'medium', client_name: '', selectedAgencies: [] });
      fetchCases();
    } catch (e) {
      alert('❌ فشل إنشاء القضية: ' + e.message);
    }
  };

  const handleDelete = async (caseId) => {
    if (!confirm('🗑️ هل أنت متأكد من حذف القضية #' + caseId + '؟')) return;
    try {
      await api.delete(`/cases/${caseId}`);
      fetchCases();
    } catch (e) {
      alert('❌ فشل الحذف: ' + e.message);
    }
  };

  const handleCasesUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/cases/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('foia_token') },
        body: formData
      });
      const data = await res.json();
      alert(data.message || `✅ تم استيراد ${data.imported} قضية`);
      fetchCases();
    } catch (err) {
      alert('❌ فشل الرفع: ' + err.message);
    }
    e.target.value = '';
  };

  const filteredCases = cases.filter(c =>
    !searchTerm ||
    c.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.client_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    String(c.id).includes(searchTerm)
  );

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-10 h-10 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
    </div>
  );

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>🗂️ القضايا</h1>
          <p style={{ color: 'var(--text-muted)' }}>{cases.length} قضية</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Upload Excel */}
          <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium cursor-pointer transition-all border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            <Upload className="w-4 h-4" />
            رفع Excel
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleCasesUpload} className="hidden" />
          </label>
          <button onClick={() => { setShowForm(true); fetchAgencies(); }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold transition-all"
            style={{ background: 'var(--accent)', color: '#1A1A2E' }}>
            <Plus className="w-4 h-4" />
            قضية جديدة
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-muted)' }} />
        <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
          placeholder="🔍 ابحث برقم القضية أو العنوان..."
          className="w-full px-12 py-3 rounded-xl border focus:outline-none"
          style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="p-6 rounded-xl border animate-slideUp"
          style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
          <h2 className="font-semibold mb-4" style={{ color: 'var(--accent)' }}>📝 قضية جديدة</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="space-y-3">
              <input value={form.title} onChange={e => setForm({...form, title: e.target.value})}
                placeholder="عنوان القضية *"
                className="w-full px-4 py-3 rounded-xl border focus:outline-none"
                style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
              <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})}
                placeholder="وصف القضية" rows={3}
                className="w-full px-4 py-3 rounded-xl border resize-none focus:outline-none"
                style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
              <div className="flex gap-3">
                <input value={form.client_name} onChange={e => setForm({...form, client_name: e.target.value})}
                  placeholder="اسم العميل"
                  className="flex-1 px-4 py-3 rounded-xl border focus:outline-none"
                  style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                <select value={form.priority} onChange={e => setForm({...form, priority: e.target.value})}
                  className="px-4 py-3 rounded-xl border"
                  style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                  <option value="low">🟢 منخفض</option>
                  <option value="medium">🟡 متوسط</option>
                  <option value="high">🔴 عاجل</option>
                </select>
              </div>
            </div>
            {/* Agencies Selection */}
            <div>
              <p className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                اختر الجهات المستهدفه ({form.selectedAgencies.length})
              </p>
              <div className="rounded-xl border max-h-60 overflow-y-auto"
                style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)' }}>
                {agencies.length === 0 ? (
                  <div className="p-4 text-center">
                    <p style={{ color: 'var(--text-muted)' }}>لا توجد جهات بعد</p>
                    <button onClick={() => navigate('/agencies')}
                      style={{ color: 'var(--accent)' }}>
                      اذهب لصفحة الجهات ←
                    </button>
                  </div>
                ) : agencies.map(a => (
                  <label key={a.id}
                    className="flex items-center gap-3 px-3 py-3 border-b cursor-pointer transition-all"
                    style={{ borderColor: 'var(--border)' }}
                    onMouseOver={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                    <input type="checkbox" checked={form.selectedAgencies.includes(a.id)}
                      onChange={() => toggleAgency(a.id)}
                      className="w-5 h-5 rounded accent-[#D4A843]" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {a.name_ar || a.name_en}
                      </p>
                      {a.state && <p style={{ color: 'var(--text-muted)' }}>{a.state}</p>}
                    </div>
                    {form.selectedAgencies.includes(a.id) && (
                      <span className="px-2 py-1 rounded" style={{ background: 'var(--accent)20', color: 'var(--accent)' }}>
                        ✅ مختار
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)}
              className="px-4 py-2.5 rounded-xl font-medium border"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              إلغاء
            </button>
            <button onClick={createCase}
              className="px-5 py-2.5 rounded-xl font-semibold"
              style={{ background: 'var(--accent)', color: '#1A1A2E' }}>
              ✨ إنشاء القضية
            </button>
          </div>
        </div>
      )}

      {/* Cases Table */}
      {filteredCases.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-lg" style={{ color: 'var(--text-secondary)' }}>📂 لا توجد قضايا</p>
          <p className="mt-2" style={{ color: 'var(--text-muted)' }}>أضف قضية جديدة أو ارفع ملف Excel</p>
          <div className="flex gap-3 mt-4">
            <button onClick={() => { setShowForm(true); fetchAgencies(); }}
              className="px-5 py-3 rounded-xl font-semibold"
              style={{ background: 'var(--accent)', color: '#1A1A2E' }}>
              ➕ إضافة قضية
            </button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full">
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)' }}>
                <th className="px-4 py-3 text-right font-medium" style={{ color: 'var(--text-muted)' }}>#</th>
                <th className="px-4 py-3 text-right font-medium" style={{ color: 'var(--text-muted)' }}>📌 العنوان</th>
                <th className="px-4 py-3 text-right font-medium" style={{ color: 'var(--text-muted)' }}>🏛️ الجهات</th>
                <th className="px-4 py-3 text-right font-medium" style={{ color: 'var(--text-muted)' }}>📊 الحالة</th>
                <th className="px-4 py-3 text-right font-medium" style={{ color: 'var(--text-muted)' }}>⭐ الأولوية</th>
                <th className="px-4 py-3 text-right font-medium" style={{ color: 'var(--text-muted)' }}>📅 التاريخ</th>
                <th className="px-4 py-3 text-center font-medium" style={{ color: 'var(--text-muted)' }}>⚙️</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {filteredCases.map(c => {
                const st = STATUS_STYLES[c.status] || { bg: '#6B7280', label: c.status };
                return (
                  <tr key={c.id}
                    className="cursor-pointer transition-all"
                    style={{ borderColor: 'var(--border)' }}
                    onMouseOver={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                    
                    <td className="px-4 py-3 font-mono font-bold" style={{ color: 'var(--accent)' }}>#{c.id}</td>
                    
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}
                      onClick={() => navigate(`/cases/${c.id}`)}>
                      {c.title}
                    </td>
                    
                    <td className="px-4 py-3" onClick={() => navigate(`/cases/${c.id}`)}>
                      <span className="px-2.5 py-1 rounded font-medium" style={{ background: st.bg + '15', color: st.bg }}>
                        {c.request_count || 0} جهة
                      </span>
                    </td>
                    
                    <td className="px-4 py-3" onClick={() => navigate(`/cases/${c.id}`)}>
                      <span className="px-2.5 py-1 rounded" style={{ background: st.bg + '15', color: st.bg }}>
                        {st.label}
                      </span>
                    </td>

                    <td className="px-4 py-3" onClick={() => navigate(`/cases/${c.id}`)}>
                      <span className={`px-2.5 py-1 rounded-md font-mono font-medium ${
                        c.priority === 'high' ? 'text-[#EF4444] bg-[#EF4444]/10' :
                        c.priority === 'medium' ? 'text-[#F59E0B] bg-[#F59E0B]/10' : 'text-[#3B82F6] bg-[#3B82F6]/10'
                      }`}>
                        {c.priority === 'high' ? '🔴 عاجل' : c.priority === 'medium' ? '🟡 متوسط' : '🟢 منخفض'}
                      </span>
                    </td>
                    
                    <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}
                      onClick={() => navigate(`/cases/${c.id}`)}>
                      {c.created_at ? new Date(c.created_at).toLocaleDateString('ar-EG') : '—'}
                    </td>
                    
                    <td className="px-4 py-3 text-center">
                      <button onClick={e => { e.stopPropagation(); handleDelete(c.id); }}
                        className="px-3 py-1.5 rounded font-medium transition-all"
                        style={{ background: '#EF444415', color: '#EF4444' }}>
                        🗑️ حذف
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
