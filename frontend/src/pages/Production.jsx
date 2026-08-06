import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Plus, Trash2, User, RefreshCw, FolderOpen, Calendar, ChevronDown, AlertTriangle } from 'lucide-react';

const statusConfig = {
  pending:      { label: 'معلق',       emoji: '🟡', color: 'var(--warning)' },
  in_progress:  { label: 'قيد التنفيذ', emoji: '🔵', color: '#3B82F6' },
  completed:    { label: 'مكتمل',       emoji: '🟢', color: 'var(--success)' },
  cancelled:    { label: 'ملغي',       emoji: '🔴', color: 'var(--danger)' },
};

const priorityConfig = {
  high:   { label: 'عاجل',   color: 'var(--danger)' },
  medium: { label: 'متوسط',  color: 'var(--warning)' },
  low:    { label: 'منخفض',  color: '#3B82F6' },
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
    api.get('/production').then(d => {
      setItems(Array.isArray(d) ? d : d.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  const fetchUsers = () => {
    api.get('/users').then(d => {
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
      await api.post('/production/add', form);
      setShowForm(false);
      setForm({ case_id: '', assigned_to: '', priority: 'medium', notes: '' });
      fetchProduction();
    } catch (e) { alert('❌ ' + e.message); }
  };

  const updateStatus = async (id, status) => {
    try {
      await api.put(`/production/${id}`, { status });
      fetchProduction();
    } catch (e) { alert('❌ ' + e.message); }
  };

  const assignUser = async (id, assigned_to) => {
    try {
      await api.put(`/production/${id}`, { assigned_to });
      fetchProduction();
    } catch (e) { alert('❌ ' + e.message); }
  };

  const deleteItem = async (id) => {
    try {
      await api.delete(`/production/${id}`);
      fetchProduction();
    } catch (e) { alert('❌ ' + e.message); }
  };

  const autoCheck = async () => {
    setAutoChecking(true);
    try {
      await api.post('/production/auto-check');
      fetchProduction();
    } catch (e) { alert('❌ ' + e.message); }
    setAutoChecking(false);
  };

  const filteredItems = statusFilter === 'all'
    ? items
    : items.filter(i => i.status === statusFilter);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '2px solid var(--accent)', borderTopColor: 'transparent' }} />
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
    <div className="space-y-5 animate-fadeIn" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>مونتاج — Production Pipeline</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{items.length} قضية</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={autoCheck}
            disabled={autoChecking}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm card-container transition-all active:scale-[0.97] disabled:opacity-50"
            style={{ color: 'var(--text-secondary)' }}
          >
            <RefreshCw className={`w-4 h-4 ${autoChecking ? 'animate-spin' : ''}`} />
            فحص تلقائي
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="btn-accent flex items-center gap-2 px-4 py-2 text-sm"
          >
            <Plus className="w-4 h-4" />
            إضافة قضية
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="card-container rounded-2xl p-5 animate-slideUp">
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--accent)' }}>إضافة قضية إلى مونتاج</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={form.case_id}
              onChange={e => setForm({...form, case_id: e.target.value})}
              placeholder="رقم القضية *"
              className="w-full px-4 py-3 input-base"
            />
            <select
              value={form.assigned_to}
              onChange={e => setForm({...form, assigned_to: e.target.value})}
              className="w-full px-4 py-3 input-base"
            >
              <option value="">اختر مستخدم...</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <select
              value={form.priority}
              onChange={e => setForm({...form, priority: e.target.value})}
              className="w-full px-4 py-3 input-base"
            >
              <option value="low">أولوية: منخفض</option>
              <option value="medium">أولوية: متوسط</option>
              <option value="high">أولوية: عاجل</option>
            </select>
            <input
              value={form.notes}
              onChange={e => setForm({...form, notes: e.target.value})}
              placeholder="ملاحظات"
              className="w-full px-4 py-3 input-base"
            />
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <button
              onClick={() => setShowForm(false)}
              className="btn-secondary px-4 py-2 text-sm"
            >
              إلغاء
            </button>
            <button
              onClick={createItem}
              className="btn-accent px-5 py-2 text-sm"
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
            className="px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all shrink-0"
            style={{
              background: statusFilter === tab.key ? 'var(--accent-subtle)' : 'transparent',
              color: statusFilter === tab.key ? 'var(--accent)' : 'var(--text-muted)',
              border: `1px solid ${statusFilter === tab.key ? 'var(--accent)' : 'transparent'}`,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Cards Grid */}
      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'var(--bg-tertiary)' }}>
            <FolderOpen className="w-8 h-8" style={{ color: 'var(--text-muted)' }} />
          </div>
          <h3 className="text-base font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
            {statusFilter === 'all' ? 'لا توجد قضايا في المونتاج' : 'لا توجد قضايا بهذه الحالة'}
          </h3>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>أضف قضية لبدء الإنتاج</p>
          <button
            onClick={() => setShowForm(true)}
            className="btn-accent px-5 py-2.5 text-sm"
          >
            إضافة قضية
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredItems.map(item => {
            const st = statusConfig[item.status] || statusConfig.pending;
            const pr = priorityConfig[item.priority] || priorityConfig.medium;
            return (
              <div
                key={item.id}
                className="card-container rounded-2xl p-5 transition-all group"
              >
                {/* Header: Title + Delete */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>
                        {item.case_uuid ? `#${item.case_uuid.slice(0, 8)}` : `#${item.id}`}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]"
                        style={{ background: `${st.color}1a`, color: st.color, border: `1px solid ${st.color}33` }}>
                        {st.emoji} {st.label}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold leading-snug line-clamp-2" style={{ color: 'var(--text-primary)' }}>
                      {item.case_title || 'بدون عنوان'}
                    </h3>
                  </div>
                  <button
                    onClick={() => deleteItem(item.id)}
                    className="p-1.5 rounded-lg transition-all opacity-0 group-hover:opacity-100 shrink-0"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseOver={e => e.currentTarget.style.color = 'var(--danger)'}
                    onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}
                    title="إزالة"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Details */}
                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <User className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{item.assigned_user_name || 'غير معين'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: `${pr.color}1a`, color: pr.color, border: `1px solid ${pr.color}33` }}>{pr.label}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                    <span>{item.drive_file_count ?? 0} ملف</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
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
                    className="flex items-center gap-1.5 text-xs mb-4 transition-colors"
                    style={{ color: 'var(--accent)' }}
                  >
                    <FolderOpen className="w-3 h-3" />
                    فتح مجلد Drive
                  </a>
                )}

                {/* Actions row */}
                <div className="flex items-center gap-2 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                  {/* Status dropdown */}
                  <div className="relative flex-1">
                    <select
                      value={item.status}
                      onChange={e => updateStatus(item.id, e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-xs appearance-none cursor-pointer input-base"
                    >
                      <option value="pending">🟡 معلق</option>
                      <option value="in_progress">🔵 قيد التنفيذ</option>
                      <option value="completed">🟢 مكتمل</option>
                      <option value="cancelled">🔴 ملغي</option>
                    </select>
                    <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                  </div>

                  {/* Assign user dropdown */}
                  <div className="relative flex-1">
                    <select
                      value={item.assigned_to || ''}
                      onChange={e => assignUser(item.id, e.target.value || null)}
                      className="w-full px-3 py-2 rounded-xl text-xs appearance-none cursor-pointer input-base"
                    >
                      <option value="">تعيين...</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
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
