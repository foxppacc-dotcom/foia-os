import { getApiBase } from '../../api';
const API = getApiBase();
import { useState, useEffect, useMemo } from 'react';
import AppBadge from '../../components/ds/AppBadge';
import { Search, Users, AlertCircle, Clock, CheckCircle, XCircle, User, Briefcase, Calendar, Activity, Filter, RefreshCw } from 'lucide-react';

export default function WorkloadDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchWorkload = async () => {
    setLoading(true);
    try {
      const tok = localStorage.getItem('token');
      const res = await fetch(`${API}/users/workload`, { headers: { Authorization: `Bearer ${tok}` } });
      const json = await res.json();
      setData(json);
    } catch (e) { console.error('Workload fetch failed', e); }
    setLoading(false);
  };

  useEffect(() => { fetchWorkload(); }, []);

  const s = data?.summary || {};
  const users = (data?.users || []).filter(u => {
    if (search && !u.user_name?.toLowerCase().includes(search.toLowerCase()) && !u.email?.toLowerCase().includes(search.toLowerCase())) return false;
    if (roleFilter !== 'all' && u.role_label !== roleFilter) return false;
    if (statusFilter === 'overloaded' && (u.active_investigations || 0) <= 10) return false;
    if (statusFilter === 'idle' && (u.active_investigations || 0) > 0) return false;
    if (statusFilter === 'vacation' && u.vacation_status === 'active') return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold" style={{ color: 'var(--ds-text-primary)' }}>لوحة فريق العمل</h2>
        <button onClick={fetchWorkload} className="flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-muted)' }}>
          <RefreshCw className="w-3 h-3" />تحديث
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {[
          { label: 'إجمالي الفريق', value: s.total, icon: Users, color: '#3b82f6' },
          { label: 'السعة النشطة', value: s.totalCapacity, icon: Briefcase, color: '#22c55e' },
          { label: 'مثقلون', value: s.overloaded, icon: AlertCircle, color: '#ef4444' },
          { label: 'خاملون', value: s.idle, icon: Clock, color: '#eab308' },
          { label: 'متأخرون', value: s.late, icon: XCircle, color: '#ef4444' },
          { label: 'إجازة', value: s.onVacation, icon: Calendar, color: '#8b5cf6' },
        ].map(c => (
          <div key={c.label} className="rounded-lg p-2.5 text-center" style={{ background: `${c.color}10`, border: `1px solid ${c.color}30` }}>
            <c.icon className="w-4 h-4 mx-auto mb-1" style={{ color: c.color }} />
            <div className="text-lg font-bold" style={{ color: c.color }}>{c.value}</div>
            <div className="text-[9px]" style={{ color: 'var(--ds-text-muted)' }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--ds-text-muted)' }} />
          <input className="w-full rounded-lg py-2 pr-9 pl-3 text-sm" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
            placeholder="بحث عن موظف..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="text-[11px] px-2 py-2 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
          value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="all">كل الأدوار</option>
          {[...new Set(users.map(u => u.role_label).filter(Boolean))].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="text-[11px] px-2 py-2 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
          value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">الكل</option>
          <option value="overloaded">مثقل</option>
          <option value="idle">خامل</option>
          <option value="vacation">إجازة</option>
        </select>
      </div>

      {/* Overloaded alert */}
      {s.overloaded > 0 && (
        <div className="rounded-lg p-3 flex items-start gap-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#ef4444' }} />
          <div className="text-sm" style={{ color: '#ef4444' }}>
            <strong>{s.overloaded} موظفون مثقلون</strong> — لديهم أكثر من 10 تحقيقات نشطة. يُنصح بإعادة توزيع العمل.
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--ds-border)' }}>
        <table className="w-full text-right">
          <thead>
            <tr className="text-[10px] font-semibold sticky top-0" style={{ background: 'var(--ds-bg-secondary)', color: 'var(--ds-text-muted)' }}>
              <th className="p-2">الموظف</th>
              <th className="p-2">الدور</th>
              <th className="p-2">القسم</th>
              <th className="p-2">تحقيقات نشطة</th>
              <th className="p-2">معلقة</th>
              <th className="p-2">متابعة</th>
              <th className="p-2">متوقفة</th>
              <th className="p-2">الحالة</th>
              <th className="p-2">آخر نشاط</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="p-4 text-center text-sm" style={{ color: 'var(--ds-text-muted)' }}>جاري التحميل...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={9} className="p-4 text-center text-sm" style={{ color: 'var(--ds-text-muted)' }}>لا توجد نتائج</td></tr>
            ) : users.map(u => {
              const workload = u.active_investigations || 0;
              const overloaded = workload > 10;
              const idle = workload === 0 && u.vacation_status === 'active';
              const onVacation = u.vacation_status !== 'active';
              const statusColor = overloaded ? '#ef4444' : idle ? '#eab308' : onVacation ? '#8b5cf6' : '#22c55e';
              const statusLabel = overloaded ? 'مثقل' : idle ? 'خامل' : onVacation ? (u.vacation_status === 'vacation' ? 'إجازة' : u.vacation_status) : 'نشط';

              return (
                <tr key={u.user_id} className="text-[11px] border-t ds-transition-colors" style={{ borderColor: 'var(--ds-border)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--ds-bg-tertiary)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td className="p-2">
                    <div className="font-medium" style={{ color: 'var(--ds-text-primary)' }}>{u.user_name}</div>
                    <div className="text-[9px]" style={{ color: 'var(--ds-text-muted)' }}>{u.email}</div>
                  </td>
                  <td className="p-2" style={{ color: 'var(--ds-text-muted)' }}>{u.role_label || '—'}</td>
                  <td className="p-2" style={{ color: 'var(--ds-text-muted)' }}>{u.department_name || '—'}</td>
                  <td className="p-2">
                    <span className="font-semibold" style={{ color: overloaded ? '#ef4444' : 'var(--ds-text-primary)' }}>{workload}</span>
                  </td>
                  <td className="p-2" style={{ color: 'var(--ds-text-muted)' }}>{u.pending_evidence || 0}</td>
                  <td className="p-2" style={{ color: 'var(--ds-text-muted)' }}>{u.stalled_investigations || 0}</td>
                  <td className="p-2" style={{ color: 'var(--ds-text-muted)' }}>{u.total_assignments || 0}</td>
                  <td className="p-2">
                    <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: `${statusColor}20`, color: statusColor }}>{statusLabel}</span>
                  </td>
                  <td className="p-2" style={{ color: 'var(--ds-text-muted)' }}>—</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Overloaded users detail */}
      {s.overloadedUsers?.length > 0 && (
        <div className="rounded-lg p-3" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
          <div className="text-sm font-semibold mb-2" style={{ color: '#ef4444' }}>الموظفون المثقلون</div>
          {s.overloadedUsers.map(u => (
            <div key={u.id} className="flex items-center justify-between py-1 text-[11px]" style={{ color: 'var(--ds-text-primary)' }}>
              <span>{u.name}</span>
              <span style={{ color: '#ef4444' }}>{u.activeInvestigations} تحقيق نشط</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
