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

const AGENCY_TYPE_LABELS = { federal: 'فيدرالي', state: 'ولاية', municipal: 'بلدية', sheriff: 'شريف' };

export default function Cases() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [agencies, setAgencies] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [canViewAllCases, setCanViewAllCases] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [form, setForm] = useState({
    priority: 'medium',
    defendant_name: '', source_agency_name: '', story_hook: '', article_url: '', case_summary: '',
    selectedAgencies: []
  });
  const navigate = useNavigate();

  const fetchCases = () => {
    api.getCases().then(d => {
      setCases(Array.isArray(d) ? d : d.data || []);
      setFetchError('');
      setLoading(false);
    // Previously left `cases` at [] on any failure -- rendered as "لا توجد
    // قضايا" (no cases exist), indistinguishable from a genuinely empty
    // caseload.
    }).catch(() => { setFetchError('تعذر تحميل القضايا — حاول تحديث الصفحة'); setLoading(false); });
  };

  const fetchAgencies = () => {
    api.get('/agencies?limit=500').then(d => {
      setAgencies(d?.data || []);
    }).catch(() => {});
  };

  useEffect(() => { fetchCases(); }, []);
  useEffect(() => {
    api.get('/permissions/mine').then(d => setCanViewAllCases(d.canViewAllCases !== false)).catch(() => {});
  }, []);

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
    if (!form.defendant_name.trim()) return;
    try {
      // معلومات تسجيل القضية replaced the old عنوان/وصف/عميل fields entirely --
      // اسم المتهم is now the case's effective title (everything downstream --
      // the cases list, search, mailPoller's title-matching -- reads
      // cases.title, so it still needs a meaningful value), and ملخص القضية
      // doubles as the description.
      const res = await api.post('/cases', {
        title: form.defendant_name,
        description: form.case_summary,
        priority: form.priority,
        defendant_name: form.defendant_name,
        source_agency_name: form.source_agency_name,
        story_hook: form.story_hook,
        article_url: form.article_url,
        case_summary: form.case_summary,
        agencies: form.selectedAgencies.map(id => ({ agency_id: id }))
      });
      // Auto-classify to pipeline list 1 after creation. POST /cases already
      // returns the newly-created requests (res.requests) -- re-fetching the
      // whole case here just to get the same IDs was a redundant round trip
      // through the case-detail endpoint's six-query load.
      if (form.selectedAgencies.length > 0) {
        await Promise.all((res.requests || []).map(r =>
          api.put(`/requests/${r.id}/classification`, { classification_id: 1 })
        ));
      }
      setShowForm(false);
      setForm({ priority: 'medium', defendant_name: '', source_agency_name: '', story_hook: '', article_url: '', case_summary: '', selectedAgencies: [] });
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
          <p style={{ color: 'var(--text-muted)' }}>
            {cases.length} قضية
            {!canViewAllCases && <span className="mr-2 text-xs px-2 py-0.5 rounded-lg" style={{ background: 'var(--accent-subtle, rgba(212,168,67,0.12))', color: 'var(--accent)' }}>القضايا المسندة إليك فقط</span>}
          </p>
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
        <div className="p-6 rounded-2xl border animate-slideUp"
          style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-md)' }}>
          <h2 className="font-semibold mb-4" style={{ color: 'var(--accent)' }}>📝 قضية جديدة</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
            <div className="space-y-4">
              {/* معلومات تسجيل القضية -- replaces the old عنوان/وصف/عميل fields;
                  اسم المتهم is now the case's effective title. Each field has
                  a persistent label (not just a placeholder) with its own row. */}
              <div className="flex items-center gap-3">
                <label className="w-28 shrink-0 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>اسم المتهم *</label>
                <input value={form.defendant_name} onChange={e => setForm({...form, defendant_name: e.target.value})}
                  className="flex-1 px-4 py-3 rounded-xl border focus:outline-none"
                  style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
              </div>
              <div className="flex items-center gap-3">
                <label className="w-28 shrink-0 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>اسم الوكالة</label>
                <input value={form.source_agency_name} onChange={e => setForm({...form, source_agency_name: e.target.value})}
                  className="flex-1 px-4 py-3 rounded-xl border focus:outline-none"
                  style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
              </div>
              <div className="flex items-center gap-3">
                <label className="w-28 shrink-0 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>الهوك</label>
                <input value={form.story_hook} onChange={e => setForm({...form, story_hook: e.target.value})}
                  className="flex-1 px-4 py-3 rounded-xl border focus:outline-none"
                  style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
              </div>
              <div className="flex items-center gap-3">
                <label className="w-28 shrink-0 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>رابط المقال</label>
                <input value={form.article_url} onChange={e => setForm({...form, article_url: e.target.value})}
                  className="flex-1 px-4 py-3 rounded-xl border focus:outline-none"
                  style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
              </div>
              <div className="flex items-start gap-3">
                <label className="w-28 shrink-0 text-sm font-medium pt-3" style={{ color: 'var(--text-primary)' }}>ملخص القضية</label>
                <textarea value={form.case_summary} onChange={e => setForm({...form, case_summary: e.target.value})}
                  rows={4}
                  className="flex-1 px-4 py-3 rounded-xl border resize-y focus:outline-none"
                  style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)', minHeight: '6rem' }} />
              </div>
            </div>
            {/* Agencies Selection + Priority */}
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
                    className="flex items-start gap-3 px-3 py-3 border-b cursor-pointer transition-all"
                    style={{ borderColor: 'var(--border)' }}
                    onMouseOver={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                    <input type="checkbox" checked={form.selectedAgencies.includes(a.id)}
                      onChange={() => toggleAgency(a.id)}
                      className="w-5 h-5 rounded accent-[#D4A843] mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {a.name_ar || a.name_en}
                        </p>
                        {a.type && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                            {AGENCY_TYPE_LABELS[a.type] || a.type}
                          </span>
                        )}
                      </div>
                      {a.name_ar && a.name_en && (
                        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{a.name_en}</p>
                      )}
                      <div className="flex items-center gap-x-3 gap-y-0.5 text-[11px] mt-1 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                        {(a.city || a.state) && <span>📍 {[a.city, a.state].filter(Boolean).join('، ')}</span>}
                        {a.email && <span className="truncate">✉️ {a.email}</span>}
                        {a.phone && <span>☎️ {a.phone}</span>}
                        {a.average_response_days != null && <span>⏱ متوسط الرد: {a.average_response_days} يوم</span>}
                      </div>
                    </div>
                    {form.selectedAgencies.includes(a.id) && (
                      <span className="px-2 py-1 rounded shrink-0" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
                        ✅ مختار
                      </span>
                    )}
                  </label>
                ))}
              </div>

              {/* الأهمية -- placed below الجهات per request */}
              <div className="flex items-center gap-3 mt-4">
                <label className="shrink-0 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>الأهمية</label>
                <select value={form.priority} onChange={e => setForm({...form, priority: e.target.value})}
                  className="flex-1 px-4 py-3 rounded-xl border"
                  style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                  <option value="low">🟢 منخفض</option>
                  <option value="medium">🟡 متوسط</option>
                  <option value="high">🔴 عاجل</option>
                </select>
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
      {fetchError ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-lg" style={{ color: '#ef4444' }}>⚠️ {fetchError}</p>
          <button onClick={() => { setLoading(true); fetchCases(); }} className="mt-4 px-5 py-2.5 rounded-xl font-semibold"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
            إعادة المحاولة
          </button>
        </div>
      ) : filteredCases.length === 0 ? (
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
        <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--border)', boxShadow: 'var(--shadow-sm)' }}>
          <table className="w-full">
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)' }}>
                <th className="px-4 py-3.5 text-right font-medium" style={{ color: 'var(--text-muted)' }}>#</th>
                <th className="px-4 py-3.5 text-right font-medium" style={{ color: 'var(--text-muted)' }}>📌 العنوان</th>
                <th className="px-4 py-3.5 text-right font-medium" style={{ color: 'var(--text-muted)' }}>🏛️ الجهات</th>
                <th className="px-4 py-3.5 text-right font-medium" style={{ color: 'var(--text-muted)' }}>📊 الحالة</th>
                <th className="px-4 py-3.5 text-right font-medium" style={{ color: 'var(--text-muted)' }}>⭐ الأولوية</th>
                <th className="px-4 py-3.5 text-right font-medium" style={{ color: 'var(--text-muted)' }}>📅 التاريخ</th>
                <th className="px-4 py-3.5 text-center font-medium" style={{ color: 'var(--text-muted)' }}>⚙️</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {filteredCases.map(c => {
                const st = STATUS_STYLES[c.status] || { bg: '#6B7280', label: c.status };
                return (
                  <tr key={c.id}
                    className="cursor-pointer transition-colors"
                    style={{ borderColor: 'var(--border)' }}
                    onMouseOver={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}>

                    <td className="px-4 py-3.5 font-mono font-bold" style={{ color: 'var(--accent)' }}>#{c.id}</td>

                    <td className="px-4 py-3.5 font-medium" style={{ color: 'var(--text-primary)' }}
                      onClick={() => navigate(`/cases/${c.id}`)}>
                      {c.title}
                    </td>

                    <td className="px-4 py-3.5" onClick={() => navigate(`/cases/${c.id}`)}>
                      <span className="px-2.5 py-1 rounded-lg font-medium" style={{ background: st.bg + '15', color: st.bg }}>
                        {c.request_count || 0} جهة
                      </span>
                    </td>

                    <td className="px-4 py-3.5" onClick={() => navigate(`/cases/${c.id}`)}>
                      <span className="px-2.5 py-1 rounded-lg" style={{ background: st.bg + '15', color: st.bg }}>
                        {st.label}
                      </span>
                    </td>

                    <td className="px-4 py-3.5" onClick={() => navigate(`/cases/${c.id}`)}>
                      <span className={`px-2.5 py-1 rounded-lg font-mono font-medium ${
                        c.priority === 'high' ? 'text-[#EF4444] bg-[#EF4444]/10' :
                        c.priority === 'medium' ? 'text-[#F59E0B] bg-[#F59E0B]/10' : 'text-[#3B82F6] bg-[#3B82F6]/10'
                      }`}>
                        {c.priority === 'high' ? '🔴 عاجل' : c.priority === 'medium' ? '🟡 متوسط' : '🟢 منخفض'}
                      </span>
                    </td>

                    <td className="px-4 py-3.5" style={{ color: 'var(--text-muted)' }}
                      onClick={() => navigate(`/cases/${c.id}`)}>
                      {c.created_at ? new Date(c.created_at).toLocaleDateString('ar-EG') : '—'}
                    </td>

                    <td className="px-4 py-3.5 text-center">
                      <button onClick={e => { e.stopPropagation(); handleDelete(c.id); }}
                        className="px-3 py-1.5 rounded-lg font-medium transition-colors"
                        style={{ background: '#EF444415', color: '#EF4444' }}
                        onMouseOver={e => e.currentTarget.style.background = '#EF444425'}
                        onMouseOut={e => e.currentTarget.style.background = '#EF444415'}>
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
