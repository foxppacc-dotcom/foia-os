import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { FolderOpen, LayoutDashboard, GitBranch, Building2, Sparkles, Users, Mail, Timer, Key, FileText, ChevronRight, ChevronLeft, Cloud, UserCog, Network, ShieldCheck, Phone, MailPlus } from 'lucide-react';

const navGroups = [
  {
    label: 'الرئيسية',
    items: [
      { path: '/', label: 'لوحة التحكم', icon: LayoutDashboard, roles: ['admin', 'manager', 'member', 'viewer'], end: true },
      { path: '/intake', label: 'استقبال ذكي', icon: Sparkles, roles: ['admin', 'manager', 'member'] },
    ],
  },
  {
    label: 'سير العمل',
    items: [
      { path: '/cases', label: 'القضايا', icon: FolderOpen, roles: ['admin', 'manager', 'member'] },
      { path: '/pipeline', label: 'خط الإنتاج', icon: GitBranch, roles: ['admin', 'manager', 'member'] },
      { path: '/production', label: 'مونتاج', icon: Timer, roles: ['admin', 'manager', 'member'] },
    ],
  },
  {
    label: 'الإدارة',
    items: [
      { path: '/agencies', label: 'الجهات', icon: Building2, roles: ['admin', 'manager', 'member'] },
      { path: '/portals', label: 'بوابات', icon: Key, roles: ['admin', 'manager'] },
      { path: '/inbox', label: 'صندوق الوارد', icon: Mail, roles: ['admin', 'manager', 'member'] },
      { path: '/email-accounts', label: 'إيميلات', icon: Key, roles: ['admin', 'manager', 'member'] },
      { path: '/teams', label: 'الفرق', icon: Users, roles: ['admin'] },
      { path: '/users', label: 'الأعضاء', icon: UserCog, roles: ['admin', 'manager'] },
      { path: '/organization', label: 'المؤسسة', icon: Network, roles: ['admin'] },
      { path: '/permissions', label: 'الصلاحيات', icon: ShieldCheck, roles: ['admin'] },
      { path: '/gdrive', label: 'Google Drive', icon: Cloud, roles: ['admin', 'manager', 'member'] },
      { path: '/phone-logs', label: 'سجل المكالمات', icon: Phone, roles: ['admin', 'manager', 'member'] },
      { path: '/mail-logs', label: 'البريد الفعلي', icon: MailPlus, roles: ['admin', 'manager', 'member'] },
    ],
  },
];

const EXPANDED_WIDTH = 220;
const COLLAPSED_WIDTH = 60;
const STORAGE_KEY = 'foia_sidebar_collapsed';

export default function Sidebar({ user }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true'; }
    catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? 'true' : 'false'); }
    catch {}
  }, [collapsed]);

  const width = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;
  const canAccess = (item) => !item.roles || item.roles.includes(user?.role);

  return (
    <aside className="fixed right-0 top-0 h-full flex flex-col z-10"
      style={{
        width: `${width}px`,
        background: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border)',
        transition: 'width 0.2s ease',
        overflow: 'hidden',
      }}
      dir="rtl"
      onMouseEnter={collapsed ? (e) => { e.currentTarget.style.width = `${EXPANDED_WIDTH}px`; } : undefined}
      onMouseLeave={collapsed ? (e) => { e.currentTarget.style.width = `${COLLAPSED_WIDTH}px`; } : undefined}>

      {/* Logo section — compact but readable */}
      <div className="flex items-center justify-between h-[56px] shrink-0 px-3"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'var(--accent)' }}>
            <FileText className="w-4 h-4" style={{ color: 'var(--text-inverse)' }} />
          </div>
          {!collapsed && (
            <div className="whitespace-nowrap">
              <div className="text-sm font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>FOIA OS</div>
            </div>
          )}
        </div>
        {/* Collapse button — subtle, permanent */}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="p-1 rounded-md shrink-0 ds-transition-colors"
          style={{ color: 'var(--text-muted)' }}
          title={collapsed ? 'توسيع الشريط الجانبي' : 'طي الشريط الجانبي'}>
          {collapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation — professional spacing, readable text */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-3 space-y-4">
        {navGroups.map(group => (
          <div key={group.label}>
            {!collapsed && (
              <div className="text-[10px] font-semibold px-1 mb-1.5 uppercase tracking-widest"
                style={{ color: 'var(--text-muted)' }}>
                {group.label}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.filter(canAccess).map(item => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-2.5 py-2 rounded-lg ds-transition-colors ${
                      isActive ? 'font-semibold' : ''
                    }`
                  }
                  style={({ isActive }) => ({
                    background: isActive ? 'var(--accent)' : 'transparent',
                    color: isActive ? 'var(--text-inverse)' : 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                  })}
                  title={collapsed ? item.label : undefined}>
                  <item.icon className="w-[18px] h-[18px] shrink-0" />
                  {!collapsed && <span className="text-xs">{item.label}</span>}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
