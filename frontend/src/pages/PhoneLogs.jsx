import { useState, useEffect } from 'react';
import { api } from '../api';
import { Plus, Search, Phone, Trash2, PhoneIncoming, PhoneOutgoing } from 'lucide-react';

export default function PhoneLogs() {
  const [cases, setCases] = useState([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    case_id: '', direction: 'inbound', caller_name: '', caller_number: '',
    duration_seconds: '', summary: '', notes: ''
  });

  useEffect(() => {
    api.getCases().then(d => {
      setCases(Array.isArray(d) ? d : d.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const fetchLogs = (caseId) => {
    if (!caseId) { setLogs([]); return; }
    api.get(`/api/cases/${caseId}/phone-logs`)
      .then(d => setLogs(Array.isArray(d) ? d : d.data || []))
      .catch(() => setLogs([]));
  };

  useEffect(() => {
    if (selectedCaseId) fetchLogs(selectedCaseId);
    else setLogs([]);
  }, [selectedCaseId]);

  const createLog = async () => {
    if (!form.caller_name.trim() || !form.caller_number.trim()) return;
    const payload = {
      case_id: parseInt(selectedCaseId),
      direction: form.direction,
      caller_name: form.caller_name,
      caller_number: form.caller_number,
      duration_seconds: form.duration_seconds ? parseInt(form.duration_seconds) : null,
      summary: form.summary || null,
      notes: form.notes || null,
    };
    await api.post('/api/cases/' + selectedCaseId + '/phone-logs', payload);
    setShowForm(false);
    setForm({ case_id: '', direction: 'inbound', caller_name: '', caller_number: '', duration_seconds: '', summary: '', notes: '' });
    fetchLogs(selectedCaseId);
  };

  const deleteLog = async (id) => {
    if (!confirm('هل أنت متأكد من حذف هذه المكالمة؟')) return;
    await api.delete(`/api/cases/${selectedCaseId}/phone-logs/${id}`);
    fetchLogs(selectedCaseId);
  };

  const formatDuration = (secs) => {
    if (!secs && secs !== 0) return '—';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-[#D4A843] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">سجل المكالمات الهاتفية</h1>
      </div>

      {/* Case Selector */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <select
          value={selectedCaseId}
          onChange={e => setSelectedCaseId(e.target.value)}
          className="w-full pr-10 pl-4 py-3 select-base appearance-none"
        >
          <option value="">اختر قضية...</option>
          {cases.map(c => (
            <option key={c.id} value={c.id}>{c.title} {c.client_name ? `- ${c.client_name}` : ''}</option>
          ))}
        </select>
      </div>

      {!selectedCaseId ? (
        <div className="flex flex-col items-center justify-center py-16 text-center card-container rounded-2xl">
          <Phone className="w-12 h-12 text-gray-600 mb-3" />
          <h3 className="text-base font-medium text-gray-400 mb-1">اختر قضية</h3>
          <p className="text-sm text-gray-600">يرجى اختيار قضية لعرض سجل مكالماتها</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">{logs.length} مكالمة</p>
            <button onClick={() => setShowForm(true)} className="flex items-center gap-2 btn-accent px-4 py-2 text-sm">
              <Plus className="w-4 h-4" />
              إضافة مكالمة
            </button>
          </div>

          {/* Add Form */}
          {showForm && (
            <div className="card-container rounded-2xl p-5 animate-slideUp">
              <h2 className="text-sm font-semibold var(--accent) mb-4">إضافة مكالمة جديدة</h2>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <select value={form.direction} onChange={e => setForm({...form, direction: e.target.value})} className="px-4 py-3 input-base">
                    <option value="inbound">📥 وارد</option>
                    <option value="outbound">📤 صادر</option>
                  </select>
                  <input value={form.caller_name} onChange={e => setForm({...form, caller_name: e.target.value})} placeholder="اسم المتصل" className="flex-1 px-4 py-3 input-base" />
                </div>
                <div className="flex gap-3">
                  <input value={form.caller_number} onChange={e => setForm({...form, caller_number: e.target.value})} placeholder="رقم الهاتف" className="flex-1 px-4 py-3 input-base" />
                  <input value={form.duration_seconds} onChange={e => setForm({...form, duration_seconds: e.target.value})} placeholder="المدة (ثواني)" type="number" className="w-40 px-4 py-3 input-base" />
                </div>
                <textarea value={form.summary} onChange={e => setForm({...form, summary: e.target.value})} placeholder="ملخص المكالمة" rows={2} className="w-full px-4 py-3 input-base" />
                <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="ملاحظات" rows={2} className="w-full px-4 py-3 input-base" />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowForm(false)} className="btn-secondary px-4 py-2 text-sm">إلغاء</button>
                  <button onClick={createLog} className="btn-accent px-5 py-2 text-sm">إضافة</button>
                </div>
              </div>
            </div>
          )}

          {/* Logs List */}
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center card-container rounded-2xl">
              <Phone className="w-12 h-12 text-gray-600 mb-3" />
              <h3 className="text-base font-medium text-gray-400 mb-1">لا توجد مكالمات</h3>
              <p className="text-sm text-gray-600 mb-4">لم يتم تسجيل أي مكالمات لهذه القضية</p>
              <button onClick={() => setShowForm(true)} className="btn-accent px-5 py-2.5 text-sm">إضافة مكالمة</button>
            </div>
          ) : (
            <div className="space-y-3">
              {logs.map(log => (
                <div key={log.id} className="card-container rounded-2xl p-4 hover:border-[#D4A84330] transition-all duration-300">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        log.direction === 'inbound'
                          ? 'bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20'
                          : 'bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20'
                      }`}>
                        {log.direction === 'inbound' ? <PhoneIncoming className="w-4 h-4" /> : <PhoneOutgoing className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-semibold text-white">{log.caller_name}</h3>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            log.direction === 'inbound'
                              ? 'bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20'
                              : 'bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20'
                          }`}>
                            📥 {log.direction === 'inbound' ? 'وارد' : '📤 صادر'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5 font-mono">{log.caller_number}</p>
                        {log.summary && <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{log.summary}</p>}
                        <div className="flex items-center gap-3 mt-2">
                          {log.duration_seconds != null && (
                            <span className="text-[11px] text-gray-500 flex items-center gap-1">
                              ⏱ {formatDuration(log.duration_seconds)}
                            </span>
                          )}
                          {log.recording_path && (
                            <span className="text-[11px] var(--accent) flex items-center gap-1">🔊 تسجيل</span>
                          )}
                          {log.created_at && (
                            <span className="text-[11px] text-gray-600">{new Date(log.created_at).toLocaleDateString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button onClick={() => deleteLog(log.id)} className="p-2 rounded-lg text-gray-600 hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-all shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
