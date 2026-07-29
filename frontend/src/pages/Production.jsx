import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Plus, Trash2, User, RefreshCw, FolderOpen, Calendar, ChevronDown, AlertTriangle } from 'lucide-react';

const statusConfig = {
  pending:      { label: 'معلق',       emoji: '🟡', color: 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/20' },
  in_progress:  { label: 'قيد التنفيذ', emoji: '🔵', color: 'bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/20' },
  completed:    { label: 'مكتمل',       emoji: '🟢', color: 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20' },
  cancelled:    { label: 'ملغي',       emoji: '🔴', color: 'bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/20' },
};

const priorityConfig = {
  high:   { label: 'عاجل',   color: 'text-[#EF4444] bg-[#EF4444]/10 border-[#EF4444]/20' },
  medium: { label: 'متوسط',  color: 'text-[#F59E0B] bg-[#F59E0B]/10 border-[#F59E0B]/20' },
  low:    { label: 'منخفض',  color: 'text-[#3B82F6] bg-[#3B82F6]/10 border-[#3B82F6]/20' },
};

export default function Production() {
  const [searchParams, setSearchParams] = useSearchParams();
  const prefilledCaseId = searchParams.get('case_id') || '';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showForm, setShowForm] = useState(!!prefilledCaseId);
  const [form, setForm] = useState({ case_id: prefilledCaseId, assigned_to: '', priority: 'medium', notes: '' });
  const [autoChecking, setAutoChecking] = useState(false);

  useEffect(() => {
    if (prefilledCaseId) {
      setShowForm(true);
      setForm(f => ({ ...f, case_id: prefilledCaseId }));
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchProduction = () => {
    api.get('/api/production').then(d => {
      setItems(Array.isArray(d) ? d : d.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  const fetchUsers = () => {
    api.get('/api/users').then(d => {
      setUsers(Array.isArray(d) ? d : d.data || []);
    }).catch(() => {});
  };

  useEffect(() => {
    fetchProduction();
    fetchUsers();
  }, []);

  const createItem = async () => {
    if (!form.case_id) return;
    try {
      await api.post('/api/production', form);
      setShowForm(false);
      setForm({ case_id: '', assigned_to: '', priority: 'medium', notes: '' });
      fetchProduction();
    } catch {}
  };

  const updateStatus = async (id, status) => {
    try {
      await api.put(`/api/production/${id}`, { status });
      fetchProduction();
    } catch {}
  };

  const assignUser = async (id, assigned_to) => {
    try {
      await api.put(`/api/production/${id}`, { assigned_to });
      fetchProduction();
    } catch {}
  };

  const deleteItem = async (id) => {
    try {
      await api.delete(`/api/production/${id}`);
      fetchProduction();
    } catch {}
  };

  const autoCheck = async () => {
    setAutoChecking(true);
    try {
      await api.post('/api/production/auto-check');
      fetchProduction();
    } catch {}
    setAutoChecking(false);
  };

  const filteredItems = statusFilter === 'all'
    ? items
    : items.filter(i => i.status === statusFilter);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-[#D4A843] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const statusTabs = [
    { key: 'all',        label: 'الكل' },
    { key: 'pending',    label: '🟡 معلق' },
    { key: 'in_progress', label: '🔵 قيد التنفيذ' },
    { key: 'completed',  label: '🟢 مكتمل' },
    { key: 'cancelled',  label: '🔴 ملغي' },
  ];

  return (
    <div className="space-y-6 animate-fadeIn" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">مونتاج — Production Pipeline</h1>
          <p className="text-xs text-gray-600 mt-0.5">{items.length} قضية</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={autoCheck}
            disabled={autoChecking}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] text-gray-300 hover:text-white hover:border-[#D4A843]/40 transition-all active:scale-[0.97] disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${autoChecking ? 'animate-spin' : ''}`} />
            فحص تلقائي
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm bg-gradient-to-r from-[#D4A843] to-[#e4b84a] text-[#0A0A0F] hover:shadow-lg hover:shadow-[#D4A843]/30 transition-all active:scale-[0.97]"
          >
            <Plus className="w-4 h-4" />
            إضافة قضية
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl p-5 animate-slideUp">
          <h2 className="text-sm font-semibold text-[#D4A843] mb-4">إضافة قضية إلى مونتاج</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={form.case_id}
              onChange={e => setForm({...form, case_id: e.target.value})}
              placeholder="رقم القضية *"
              className="w-full px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white placeholder-gray-500 focus:outline-none focus:border-[#D4A843] transition-all"
            />
            <select
              value={form.assigned_to}
              onChange={e => setForm({...form, assigned_to: e.target.value})}
              className="w-full px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white focus:outline-none focus:border-[#D4A843]"
            >
              <option value="">اختر مستخدم...</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <select
              value={form.priority}
              onChange={e => setForm({...form, priority: e.target.value})}
              className="w-full px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white focus:outline-none focus:border-[#D4A843]"
            >
              <option value="low">أولوية: منخفض</option>
              <option value="medium">أولوية: متوسط</option>
              <option value="high">أولوية: عاجل</option>
            </select>
            <input
              value={form.notes}
              onChange={e => setForm({...form, notes: e.target.value})}
              placeholder="ملاحظات"
              className="w-full px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white placeholder-gray-500 focus:outline-none focus:border-[#D4A843] transition-all"
            />
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-xl font-medium text-sm bg-transparent border border-[#1F1F2A] text-gray-300 hover:text-white hover:bg-[#1a1a2e] transition-all"
            >
              إلغاء
            </button>
            <button
              onClick={createItem}
              className="px-5 py-2 rounded-xl font-semibold text-sm bg-gradient-to-r from-[#D4A843] to-[#e4b84a] text-[#0A0A0F] hover:shadow-lg transition-all"
            >
              إضافة
            </button>
          </div>
        </div>
      )}

      {/* Status Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {statusTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              statusFilter === tab.key
                ? 'bg-[#D4A843]/10 text-[#D4A843] border border-[#D4A843]/20'
                : 'bg-[rgba(17,17,34,0.4)] text-gray-400 border border-transparent hover:text-white hover:bg-[#1a1a2e]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Cards Grid */}
      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-[#1a1a2e] flex items-center justify-center mb-4">
            <FolderOpen className="w-8 h-8 text-gray-600" />
          </div>
          <h3 className="text-base font-medium text-gray-400 mb-1">
            {statusFilter === 'all' ? 'لا توجد قضايا في المونتاج' : 'لا توجد قضايا بهذه الحالة'}
          </h3>
          <p className="text-sm text-gray-600 mb-4">أضف قضية لبدء الإنتاج</p>
          <button
            onClick={() => setShowForm(true)}
            className="px-5 py-2.5 rounded-xl font-semibold text-sm bg-gradient-to-r from-[#D4A843] to-[#e4b84a] text-[#0A0A0F] transition-all"
          >
            إضافة قضية
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredItems.map(item => {
            const st = statusConfig[item.status] || statusConfig.pending;
            const pr = priorityConfig[item.priority] || priorityConfig.medium;
            return (
              <div
                key={item.id}
                className="bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl p-5 hover:border-[#D4A843]/30 transition-all group"
              >
                {/* Header: Title + Delete */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono text-gray-600 shrink-0">
                        {item.case_uuid ? `#${item.case_uuid.slice(0, 8)}` : `#${item.id}`}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border ${st.color}`}>
                        {st.emoji} {st.label}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-white leading-snug line-clamp-2">
                      {item.case_title || 'بدون عنوان'}
                    </h3>
                  </div>
                  <button
                    onClick={() => deleteItem(item.id)}
                    className="p-1.5 rounded-lg text-gray-600 hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-all opacity-0 group-hover:opacity-100 shrink-0"
                    title="إزالة"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Details */}
                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <User className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{item.assigned_user_name || 'غير معين'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span className={`px-1.5 py-0.5 rounded text-[10px] border ${pr.color}`}>{pr.label}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                    <span>{item.drive_file_count ?? 0} ملف</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Calendar className="w-3.5 h-3.5 shrink-0" />
                    <span>{item.created_at ? new Date(item.created_at).toLocaleDateString('ar-EG') : '—'}</span>
                  </div>
                </div>

                {/* Drive link */}
                {item.drive_folder_link && (
                  <a
                    href={item.drive_folder_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-[#D4A843] hover:text-[#e4b84a] mb-4 transition-colors"
                  >
                    <FolderOpen className="w-3 h-3" />
                    فتح مجلد Drive
                  </a>
                )}

                {/* Actions row */}
                <div className="flex items-center gap-2 pt-3 border-t border-[rgba(255,255,255,0.06)]">
                  {/* Status dropdown */}
                  <div className="relative flex-1">
                    <select
                      value={item.status}
                      onChange={e => updateStatus(item.id, e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-xs bg-[#13131A] border border-[#1F1F2A] text-white focus:outline-none focus:border-[#D4A843] appearance-none cursor-pointer"
                    >
                      <option value="pending">🟡 معلق</option>
                      <option value="in_progress">🔵 قيد التنفيذ</option>
                      <option value="completed">🟢 مكتمل</option>
                      <option value="cancelled">🔴 ملغي</option>
                    </select>
                    <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                  </div>

                  {/* Assign user dropdown */}
                  <div className="relative flex-1">
                    <select
                      value={item.assigned_to || ''}
                      onChange={e => assignUser(item.id, e.target.value || null)}
                      className="w-full px-3 py-2 rounded-xl text-xs bg-[#13131A] border border-[#1F1F2A] text-white focus:outline-none focus:border-[#D4A843] appearance-none cursor-pointer"
                    >
                      <option value="">تعيين...</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
