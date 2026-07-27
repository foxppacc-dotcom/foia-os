import { useState, useEffect } from 'react';
import { Users, Shield, Building2, Mail, BarChart3, Settings, Search, RefreshCw, Plus, Pencil, Trash2, Check, X, User, Briefcase, AlertCircle, Clock } from 'lucide-react';
import Button from '../../components/ui/Button';

const API = import.meta.env.VITE_API_URL || 'https://backend-six-flax-84.vercel.app/api';
const tok = () => localStorage.getItem('token');
const hdrs = () => ({ 'Authorization': `Bearer ${tok()}`, 'Content-Type': 'application/json' });

const TABS = [
  { key: 'overview', label: 'نظرة عامة', icon: BarChart3 },
  { key: 'members', label: 'أعضاء الفريق', icon: Users },
  { key: 'roles', label: 'الصلاحيات', icon: Shield },
  { key: 'departments', label: 'الأقسام', icon: Building2 },
  { key: 'email', label: 'حسابات البريد', icon: Mail },
  { key: 'workload', label: 'أعباء العمل', icon: Briefcase },
  { key: 'settings', label: 'إعدادات المؤسسة', icon: Settings },
];

export default function OrganizationHub() {
  const [tab, setTab] = useState('overview');
  const [workload, setWorkload] = useState(null);
  const [roles, setRoles] = useState([]);
  const [depts, setDepts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [org, setOrg] = useState({});

  useEffect(() => {
    fetch(`${API}/users/workload`, { headers: hdrs() }).then(r => r.json()).then(d => setWorkload(d));
    fetch(`${API}/roles`, { headers: hdrs() }).then(r => r.json()).then(d => setRoles(d.roles || []));
    fetch(`${API}/departments`, { headers: hdrs() }).then(r => r.json()).then(d => setDepts(d.departments || []));
    fetch(`${API}/email-accounts`, { headers: hdrs() }).then(r => r.json()).then(d => setAccounts(d.accounts || []));
    fetch(`${API}/organization`, { headers: hdrs() }).then(r => r.json()).then(d => setOrg(d.organization || {}));
  }, []);

  const s = workload?.summary || {};

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--ds-text-primary)' }}>{org.company_name || 'FOIA OS'} — مركز المؤسسة</h1>
          <p className="text-xs" style={{ color: 'var(--ds-text-muted)' }}>{workload?.users?.length || 0} موظف · {roles.length} دور · {depts.length} قسم · {accounts.length} حساب بريد</p>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {[
          { label: 'الموظفون', value: s.total, icon: Users, color: '#3b82f6' },
          { label: 'السعة النشطة', value: s.totalCapacity, icon: Briefcase, color: '#22c55e' },
          { label: 'مثقلون', value: s.overloaded, icon: AlertCircle, color: '#ef4444' },
          { label: 'خاملون', value: s.idle, icon: Clock, color: '#eab308' },
          { label: 'متأخرون', value: s.late, icon: AlertCircle, color: '#ef4444' },
          { label: 'إجازة', value: s.onVacation, icon: Clock, color: '#8b5cf6' },
          { label: 'الأدوار', value: roles.length, icon: Shield, color: '#3b82f6' },
        ].map(c => (
          <div key={c.label} className="rounded-lg p-2.5 text-center ds-transition-colors" style={{ background: `${c.color}10`, border: `1px solid ${c.color}30` }}>
            <c.icon className="w-4 h-4 mx-auto mb-1" style={{ color: c.color }} />
            <div className="text-lg font-bold" style={{ color: c.color }}>{c.value}</div>
            <div className="text-[9px]" style={{ color: 'var(--ds-text-muted)' }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 flex-wrap border-b pb-2" style={{ borderColor: 'var(--ds-border)' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg font-medium ds-transition-colors"
            style={{ background: tab === t.key ? 'var(--ds-accent)' : 'transparent', color: tab === t.key ? 'white' : 'var(--ds-text-muted)' }}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg p-3" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
              <h3 className="font-semibold text-sm mb-2" style={{ color: 'var(--ds-text-primary)' }}>الموظفون حسب الدور</h3>
              {roles.map(r => {
                const count = workload?.users?.filter(u => u.role_label === r.label).length || 0;
                return (
                  <div key={r.id} className="flex items-center justify-between py-1 text-[11px]">
                    <span style={{ color: 'var(--ds-text-primary)' }}>{r.label}</span>
                    <span className="font-semibold" style={{ color: 'var(--ds-text-muted)' }}>{count}</span>
                  </div>
                );
              })}
            </div>
            <div className="rounded-lg p-3" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
              <h3 className="font-semibold text-sm mb-2" style={{ color: 'var(--ds-text-primary)' }}>إعدادات المؤسسة</h3>
              <div className="space-y-1.5 text-[11px]">
                <div className="flex justify-between"><span style={{ color: 'var(--ds-text-muted)' }}>المنطقة الزمنية</span><span style={{ color: 'var(--ds-text-primary)' }}>{org.timezone || 'America/New_York'}</span></div>
                <div className="flex justify-between"><span style={{ color: 'var(--ds-text-muted)' }}>اللغة</span><span style={{ color: 'var(--ds-text-primary)' }}>{org.default_language === 'ar' ? 'العربية' : 'English'}</span></div>
                <div className="flex justify-between"><span style={{ color: 'var(--ds-text-muted)' }}>أيام العمل</span><span style={{ color: 'var(--ds-text-primary)' }}>{(org.working_days || []).length || 5} أيام</span></div>
              </div>
            </div>
          </div>
          {s.overloaded > 0 && (
            <div className="rounded-lg p-3 flex items-start gap-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#ef4444' }} />
              <div>
                <div className="text-sm font-semibold" style={{ color: '#ef4444' }}>{s.overloaded} موظفون مثقلون</div>
                <div className="text-[11px]" style={{ color: 'var(--ds-text-muted)' }}>لديهم أكثر من 10 تحقيقات نشطة. يُنصح بإعادة توزيع العمل.</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── MEMBERS ── */}
      {tab === 'members' && (
        <div className="space-y-2">
          {workload?.users?.map(u => (
            <div key={u.user_id} className="flex items-center gap-3 p-2.5 rounded-lg ds-transition-colors cursor-pointer" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--ds-bg-tertiary)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--ds-bg-secondary)'}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0" style={{ background: 'var(--ds-accent)', color: 'white' }}>{u.user_name?.[0] || '?'}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium" style={{ color: 'var(--ds-text-primary)' }}>{u.user_name}</div>
                <div className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>{u.role_label || '—'} · {u.department_name || '—'} · {u.email}</div>
              </div>
              <div className="flex items-center gap-3 text-[10px]">
                <span style={{ color: 'var(--ds-text-muted)' }}>تحقيقات: <strong style={{ color: (u.active_investigations || 0) > 10 ? '#ef4444' : 'var(--ds-text-primary)' }}>{u.active_investigations || 0}</strong></span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] ${u.vacation_status !== 'active' ? 'bg-purple-100 text-purple-600' : (u.active_investigations || 0) > 10 ? 'bg-red-100 text-red-600' : (u.active_investigations || 0) === 0 ? 'bg-yellow-100 text-yellow-600' : 'bg-green-100 text-green-600'}`}>
                  {u.vacation_status !== 'active' ? 'إجازة' : (u.active_investigations || 0) > 10 ? 'مثقل' : (u.active_investigations || 0) === 0 ? 'خامل' : 'نشط'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── WORKLOAD ── */}
      {tab === 'workload' && (
        <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--ds-border)' }}>
          <table className="w-full text-right text-[11px]">
            <thead>
              <tr style={{ background: 'var(--ds-bg-secondary)', color: 'var(--ds-text-muted)' }}>
                <th className="p-2">الموظف</th>
                <th className="p-2">تحقيقات نشطة</th>
                <th className="p-2">معلقة</th>
                <th className="p-2">متوقفة</th>
                <th className="p-2">إجمالي المهام</th>
                <th className="p-2">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {workload?.users?.map(u => (
                <tr key={u.user_id} className="border-t" style={{ borderColor: 'var(--ds-border)' }}>
                  <td className="p-2 font-medium" style={{ color: 'var(--ds-text-primary)' }}>{u.user_name}</td>
                  <td className="p-2" style={{ color: (u.active_investigations || 0) > 10 ? '#ef4444' : 'var(--ds-text-primary)' }}>{u.active_investigations || 0}</td>
                  <td className="p-2" style={{ color: 'var(--ds-text-muted)' }}>{u.pending_evidence || 0}</td>
                  <td className="p-2" style={{ color: 'var(--ds-text-muted)' }}>{u.stalled_investigations || 0}</td>
                  <td className="p-2" style={{ color: 'var(--ds-text-muted)' }}>{u.total_assignments || 0}</td>
                  <td className="p-2">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${u.vacation_status !== 'active' ? 'bg-purple-100 text-purple-600' : (u.active_investigations || 0) > 10 ? 'bg-red-100 text-red-600' : (u.active_investigations || 0) === 0 ? 'bg-yellow-100 text-yellow-600' : 'bg-green-100 text-green-600'}`}>
                      {u.vacation_status !== 'active' ? 'إجازة' : (u.active_investigations || 0) > 10 ? 'مثقل' : (u.active_investigations || 0) === 0 ? 'خامل' : 'نشط'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── ROLES (inline) ── */}
      {tab === 'roles' && (
        <div className="space-y-2">
          {roles.map(r => (
            <div key={r.id} className="rounded-lg p-3" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm" style={{ color: 'var(--ds-text-primary)' }}>{r.label}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-muted)' }}>{Object.values(r.permissions || {}).filter(Boolean).length}/18 صلاحية</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(r.permissions || {}).slice(0, 8).map(([k, v]) => (
                  <span key={k} className={`text-[9px] px-1.5 py-0.5 rounded ${v ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>{v ? '✅' : '❌'} {k.replace(/_/g, ' ')}</span>
                ))}
                {Object.keys(r.permissions || {}).length > 8 && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-muted)' }}>+{Object.keys(r.permissions).length - 8}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── DEPARTMENTS ── */}
      {tab === 'departments' && (
        <div className="space-y-2">
          {depts.map(d => (
            <div key={d.id} className="flex items-center justify-between p-2.5 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
              <div>
                <span className="text-sm font-medium" style={{ color: 'var(--ds-text-primary)' }}>{d.name}</span>
                {d.description && <span className="mr-2 text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>{d.description}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── EMAIL ── */}
      {tab === 'email' && (
        <div className="space-y-2">
          {accounts.map(a => (
            <div key={a.id} className="flex items-center justify-between p-2.5 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
              <div>
                <span className="text-sm font-medium" style={{ color: 'var(--ds-text-primary)' }}>{a.display_name || a.email}</span>
                <span className="mr-2 text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>{a.email}</span>
              </div>
              <span className={`text-[9px] px-1.5 py-0.5 rounded ${a.status === 'active' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>{a.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── SETTINGS ── */}
      {tab === 'settings' && (
        <div className="rounded-lg p-4" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
          <h3 className="font-semibold text-sm mb-3" style={{ color: 'var(--ds-text-primary)' }}>إعدادات المؤسسة</h3>
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div><span style={{ color: 'var(--ds-text-muted)' }}>اسم الشركة</span><div className="font-medium" style={{ color: 'var(--ds-text-primary)' }}>{org.company_name || '—'}</div></div>
            <div><span style={{ color: 'var(--ds-text-muted)' }}>المنطقة الزمنية</span><div className="font-medium" style={{ color: 'var(--ds-text-primary)' }}>{org.timezone || 'America/New_York'}</div></div>
            <div><span style={{ color: 'var(--ds-text-muted)' }}>اللغة</span><div className="font-medium" style={{ color: 'var(--ds-text-primary)' }}>{org.default_language === 'ar' ? 'العربية' : 'English'}</div></div>
            <div><span style={{ color: 'var(--ds-text-muted)' }}'>ساعات العمل</span><div className="font-medium" style={{ color: 'var(--ds-text-primary)' }}>{org.business_hours?.start || '09:00'} - {org.business_hours?.end || '17:00'}</div></div>
          </div>
        </div>
      )}
    </div>
  );
}
