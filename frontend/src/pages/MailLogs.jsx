import { useState, useEffect } from 'react';
import { api } from '../api';
import { Plus, Search, Mail, Trash2 } from 'lucide-react';

const mailTypeIcons = {
  letter: '✉️',
  package: '📦',
  document: '📄',
  other: '📎',
};

const mailTypeLabels = {
  letter: 'خطاب',
  package: 'طرود',
  document: 'مستند',
  other: 'آخر',
};

export default function MailLogs() {
  const [cases, setCases] = useState([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    case_id: '', direction: 'inbound', mail_type: 'letter', tracking_number: '',
    courier: '', sender_name: '', recipient_name: '', sent_date: '', received_date: '', notes: ''
  });

  useEffect(() => {
    api.getCases().then(d => {
      setCases(Array.isArray(d) ? d : d.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const fetchLogs = (caseId) => {
    if (!caseId) { setLogs([]); return; }
    api.get(`/api/cases/${caseId}/mail-logs`)
      .then(d => setLogs(Array.isArray(d) ? d : d.data || []))
      .catch(() => setLogs([]));
  };

  useEffect(() => {
    if (selectedCaseId) fetchLogs(selectedCaseId);
    else setLogs([]);
  }, [selectedCaseId]);

  const createLog = async () => {
    if (!form.sender_name.trim()) return;
    const payload = {
      case_id: parseInt(selectedCaseId),
      direction: form.direction,
      mail_type: form.mail_type,
      tracking_number: form.tracking_number || null,
      courier: form.courier || null,
      sender_name: form.sender_name,
      recipient_name: form.recipient_name || null,
      sent_date: form.sent_date || null,
      received_date: form.received_date || null,
      notes: form.notes || null,
    };
    await api.post('/api/cases/' + selectedCaseId + '/mail-logs', payload);
    setShowForm(false);
    setForm({ case_id: '', direction: 'inbound', mail_type: 'letter', tracking_number: '', courier: '', sender_name: '', recipient_name: '', sent_date: '', received_date: '', notes: '' });
    fetchLogs(selectedCaseId);
  };

  const deleteLog = async (id) => {
    if (!confirm('هل أنت متأكد من حذف هذه المراسلة؟')) return;
    await api.delete(`/api/cases/${selectedCaseId}/mail-logs/${id}`);
    fetchLogs(selectedCaseId);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-[#D4A843] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">سجل البريد الفيزيائي</h1>
      </div>

      {/* Case Selector */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <select
          value={selectedCaseId}
          onChange={e => setSelectedCaseId(e.target.value)}
          className="w-full pr-10 pl-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white focus:outline-none focus:border-[#D4A843] transition-all appearance-none cursor-pointer"
        >
          <option value="">اختر قضية...</option>
          {cases.map(c => (
            <option key={c.id} value={c.id}>{c.title} {c.client_name ? `- ${c.client_name}` : ''}</option>
          ))}
        </select>
      </div>

      {!selectedCaseId ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl">
          <Mail className="w-12 h-12 text-gray-600 mb-3" />
          <h3 className="text-base font-medium text-gray-400 mb-1">اختر قضية</h3>
          <p className="text-sm text-gray-600">يرجى اختيار قضية لعرض سجل بريدها</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">{logs.length} مراسلة</p>
            <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm bg-gradient-to-r from-[#D4A843] to-[#e4b84a] text-[#0A0A0F] hover:shadow-lg hover:shadow-[#D4A843]/30 active:scale-[0.97] transition-all">
              <Plus className="w-4 h-4" />
              إضافة مراسلة
            </button>
          </div>

          {/* Add Form */}
          {showForm && (
            <div className="bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl p-5 animate-slideUp">
              <h2 className="text-sm font-semibold text-[#D4A843] mb-4">إضافة مراسلة جديدة</h2>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <select value={form.direction} onChange={e => setForm({...form, direction: e.target.value})} className="px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white focus:outline-none focus:border-[#D4A843]">
                    <option value="inbound">📥 وارد</option>
                    <option value="outbound">📤 صادر</option>
                  </select>
                  <select value={form.mail_type} onChange={e => setForm({...form, mail_type: e.target.value})} className="px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white focus:outline-none focus:border-[#D4A843]">
                    {Object.entries(mailTypeIcons).map(([key, icon]) => (
                      <option key={key} value={key}>{icon} {mailTypeLabels[key]}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-3">
                  <input value={form.sender_name} onChange={e => setForm({...form, sender_name: e.target.value})} placeholder="اسم المرسل" className="flex-1 px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white placeholder-gray-500 focus:outline-none focus:border-[#D4A843] transition-all" />
                  <input value={form.recipient_name} onChange={e => setForm({...form, recipient_name: e.target.value})} placeholder="اسم المستلم" className="flex-1 px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white placeholder-gray-500 focus:outline-none focus:border-[#D4A843] transition-all" />
                </div>
                <div className="flex gap-3">
                  <input value={form.tracking_number} onChange={e => setForm({...form, tracking_number: e.target.value})} placeholder="رقم التتبع" className="flex-1 px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white placeholder-gray-500 focus:outline-none focus:border-[#D4A843] transition-all" />
                  <input value={form.courier} onChange={e => setForm({...form, courier: e.target.value})} placeholder="شركة الشحن" className="flex-1 px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white placeholder-gray-500 focus:outline-none focus:border-[#D4A843] transition-all" />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-[10px] text-gray-600 block mb-1">تاريخ الإرسال</label>
                    <input value={form.sent_date} onChange={e => setForm({...form, sent_date: e.target.value})} type="date" className="w-full px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white focus:outline-none focus:border-[#D4A843] transition-all" />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-gray-600 block mb-1">تاريخ الاستلام</label>
                    <input value={form.received_date} onChange={e => setForm({...form, received_date: e.target.value})} type="date" className="w-full px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white focus:outline-none focus:border-[#D4A843] transition-all" />
                  </div>
                </div>
                <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="ملاحظات" rows={2} className="w-full px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white placeholder-gray-500 focus:outline-none focus:border-[#D4A843] transition-all" />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl font-medium text-sm bg-transparent border border-[#1F1F2A] text-gray-300 hover:text-white hover:bg-[#1a1a2e] transition-all">إلغاء</button>
                  <button onClick={createLog} className="px-5 py-2 rounded-xl font-semibold text-sm bg-gradient-to-r from-[#D4A843] to-[#e4b84a] text-[#0A0A0F] hover:shadow-lg transition-all">إضافة</button>
                </div>
              </div>
            </div>
          )}

          {/* Logs List */}
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl">
              <Mail className="w-12 h-12 text-gray-600 mb-3" />
              <h3 className="text-base font-medium text-gray-400 mb-1">لا توجد مراسلات</h3>
              <p className="text-sm text-gray-600 mb-4">لم يتم تسجيل أي مراسلات لهذه القضية</p>
              <button onClick={() => setShowForm(true)} className="px-5 py-2.5 rounded-xl font-semibold text-sm bg-gradient-to-r from-[#D4A843] to-[#e4b84a] text-[#0A0A0F] transition-all">إضافة مراسلة</button>
            </div>
          ) : (
            <div className="space-y-3">
              {logs.map(log => (
                <div key={log.id} className="bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl p-4 hover:border-[#D4A84330] transition-all duration-300">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        log.direction === 'inbound'
                          ? 'bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20'
                          : 'bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20'
                      }`}>
                        <Mail className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-semibold text-white">{log.sender_name}</h3>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            log.direction === 'inbound'
                              ? 'bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20'
                              : 'bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20'
                          }`}>
                            {log.direction === 'inbound' ? '📥 وارد' : '📤 صادر'}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#1F1F2A] text-gray-400 border border-[#2a2a3a]">
                            {mailTypeIcons[log.mail_type] || '📎'} {mailTypeLabels[log.mail_type] || log.mail_type}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          {log.tracking_number && (
                            <span className="text-[11px] text-gray-500 font-mono">📮 {log.tracking_number}</span>
                          )}
                          {log.courier && (
                            <span className="text-[11px] text-gray-500">🚚 {log.courier}</span>
                          )}
                          {log.recipient_name && (
                            <span className="text-[11px] text-gray-500">👤 إلى: {log.recipient_name}</span>
                          )}
                        </div>
                        {log.notes && <p className="text-xs text-gray-500 mt-1.5 line-clamp-1">{log.notes}</p>}
                        <div className="flex items-center gap-3 mt-2">
                          {log.sent_date && (
                            <span className="text-[11px] text-gray-600">📅 إرسال: {new Date(log.sent_date).toLocaleDateString('ar-EG')}</span>
                          )}
                          {log.received_date && (
                            <span className="text-[11px] text-gray-600">📅 استلام: {new Date(log.received_date).toLocaleDateString('ar-EG')}</span>
                          )}
                          {log.scanned_path && (
                            <span className="text-[11px] text-[#D4A843] flex items-center gap-1">📄 ممسوح ضوئياً</span>
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
