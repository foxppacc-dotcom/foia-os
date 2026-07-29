import { useState, useEffect } from 'react';
import { api } from '../api';
import { Plus, Search, Mail, Trash2 } from 'lucide-react';

const mailTypeIcons = {
  letter: '✉️', package: '📦', document: '📄', other: '📎',
};
const mailTypeLabels = {
  letter: 'خطاب', package: 'طرود', document: 'مستند', other: 'أخرى',
};

export default function MailLogs() {
  const [cases, setCases] = useState([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    case_id: '', direction: 'inbound', mail_type: 'letter', tracking_number: '',
    courier: '', sender_name: '', recipient_name: '', sent_date: '', received_date: '', notes: '',
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

  useEffect(() => { if (selectedCaseId) fetchLogs(selectedCaseId); else setLogs([]); }, [selectedCaseId]);

  const createLog = async () => {
    if (!form.sender_name.trim()) return;
    await api.post('/api/cases/' + selectedCaseId + '/mail-logs', {
      case_id: parseInt(selectedCaseId), ...form,
      tracking_number: form.tracking_number || null, courier: form.courier || null,
      recipient_name: form.recipient_name || null, sent_date: form.sent_date || null,
      received_date: form.received_date || null, notes: form.notes || null,
    });
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
      <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
    </div>
  );

  return (
    <div className="space-y-6 animate-fadeIn">
      <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>سجل البريد الفيزيائي</h1>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        <select value={selectedCaseId} onChange={e => setSelectedCaseId(e.target.value)}
          className="w-full pr-10 pl-4 py-3 select-base appearance-none cursor-pointer">
          <option value="">اختر قضية...</option>
          {cases.map(c => <option key={c.id} value={c.id}>{c.title} {c.client_name ? `- ${c.client_name}` : ''}</option>)}
        </select>
      </div>

      {!selectedCaseId ? (
        <div className="empty-state">
          <Mail className="w-12 h-12 mb-3" style={{ color: 'var(--text-muted)' }} />
          <h3 className="text-base font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>اختر قضية</h3>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>يرجى اختيار قضية لعرض سجل بريدها</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{logs.length} مراسلة</p>
            <button onClick={() => setShowForm(true)} className="btn-accent flex items-center gap-2 px-4 py-2 text-sm">
              <Plus className="w-4 h-4" /> إضافة مراسلة
            </button>
          </div>

          {showForm && (
            <div className="card-container p-5 animate-slideUp">
              <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--accent)' }}>إضافة مراسلة جديدة</h2>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <select value={form.direction} onChange={e => setForm({...form, direction: e.target.value})} className="flex-1 px-4 py-3 select-base">
                    <option value="inbound">📥 وارد</option><option value="outbound">📤 صادر</option>
                  </select>
                  <select value={form.mail_type} onChange={e => setForm({...form, mail_type: e.target.value})} className="flex-1 px-4 py-3 select-base">
                    {Object.entries(mailTypeIcons).map(([key, icon]) => <option key={key} value={key}>{icon} {mailTypeLabels[key]}</option>)}
                  </select>
                </div>
                <div className="flex gap-3">
                  <input value={form.sender_name} onChange={e => setForm({...form, sender_name: e.target.value})} placeholder="اسم المرسل" className="flex-1 px-4 py-3 input-base" />
                  <input value={form.recipient_name} onChange={e => setForm({...form, recipient_name: e.target.value})} placeholder="اسم المستلم" className="flex-1 px-4 py-3 input-base" />
                </div>
                <div className="flex gap-3">
                  <input value={form.tracking_number} onChange={e => setForm({...form, tracking_number: e.target.value})} placeholder="رقم التتبع" className="flex-1 px-4 py-3 input-base" />
                  <input value={form.courier} onChange={e => setForm({...form, courier: e.target.value})} placeholder="شركة الشحن" className="flex-1 px-4 py-3 input-base" />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-[10px] block mb-1" style={{ color: 'var(--text-muted)' }}>تاريخ الإرسال</label>
                    <input value={form.sent_date} onChange={e => setForm({...form, sent_date: e.target.value})} type="date" className="w-full px-4 py-3 input-base" />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] block mb-1" style={{ color: 'var(--text-muted)' }}>تاريخ الاستلام</label>
                    <input value={form.received_date} onChange={e => setForm({...form, received_date: e.target.value})} type="date" className="w-full px-4 py-3 input-base" />
                  </div>
                </div>
                <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="ملاحظات" rows={2} className="w-full px-4 py-3 input-base" />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowForm(false)} className="btn-secondary px-4 py-2 text-sm">إلغاء</button>
                  <button onClick={createLog} className="btn-accent px-5 py-2 text-sm">إضافة</button>
                </div>
              </div>
            </div>
          )}

          {logs.length === 0 ? (
            <div className="empty-state">
              <Mail className="w-12 h-12 mb-3" style={{ color: 'var(--text-muted)' }} />
              <h3 className="text-base font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>لا توجد مراسلات</h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>لم يتم تسجيل أي مراسلات لهذه القضية</p>
              <button onClick={() => setShowForm(true)} className="btn-accent px-5 py-2.5 text-sm">إضافة مراسلة</button>
            </div>
          ) : (
            <div className="space-y-3">
              {logs.map(log => (
                <div key={log.id} className="card-container p-4 ds-transition">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border`}
                        style={{
                          background: log.direction === 'inbound' ? 'rgba(59,130,246,0.1)' : 'rgba(16,185,129,0.1)',
                          color: log.direction === 'inbound' ? '#3B82F6' : '#10B981',
                          borderColor: log.direction === 'inbound' ? 'rgba(59,130,246,0.2)' : 'rgba(16,185,129,0.2)',
                        }}>
                        <Mail className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{log.sender_name}</h3>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border`}
                            style={{
                              background: log.direction === 'inbound' ? 'rgba(59,130,246,0.1)' : 'rgba(16,185,129,0.1)',
                              color: log.direction === 'inbound' ? '#3B82F6' : '#10B981',
                              borderColor: log.direction === 'inbound' ? 'rgba(59,130,246,0.2)' : 'rgba(16,185,129,0.2)',
                            }}>
                            {log.direction === 'inbound' ? '📥 وارد' : '📤 صادر'}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                            {mailTypeIcons[log.mail_type] || '📎'} {mailTypeLabels[log.mail_type] || log.mail_type}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                          {log.tracking_number && <span className="text-[11px] font-mono">📮 {log.tracking_number}</span>}
                          {log.courier && <span className="text-[11px]">🚚 {log.courier}</span>}
                          {log.recipient_name && <span className="text-[11px]">👤 إلى: {log.recipient_name}</span>}
                        </div>
                        {log.notes && <p className="text-xs mt-1.5 line-clamp-1" style={{ color: 'var(--text-muted)' }}>{log.notes}</p>}
                        <div className="flex items-center gap-3 mt-2" style={{ color: 'var(--text-muted)' }}>
                          {log.sent_date && <span className="text-[11px]">📅 إرسال: {new Date(log.sent_date).toLocaleDateString('ar-EG')}</span>}
                          {log.received_date && <span className="text-[11px]">📅 استلام: {new Date(log.received_date).toLocaleDateString('ar-EG')}</span>}
                        </div>
                      </div>
                    </div>
                    <button onClick={() => deleteLog(log.id)} className="p-2 rounded-lg ds-transition-colors shrink-0"
                      style={{ color: 'var(--text-muted)' }}>
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
