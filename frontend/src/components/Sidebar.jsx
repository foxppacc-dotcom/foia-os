import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { FolderOpen, LayoutDashboard, GitBranch, Building2, Sparkles, Users, Mail, Timer, Key, FileText, ChevronRight, ChevronLeft, Cloud, UserCog, Phone, MailPlus, AtSign } from 'lucide-react';
import { api } from '../api';

const navGroups = [
  {
    label: 'الرئيسية',
    items: [
      { path: '/', label: 'لوحة التحكم', icon: LayoutDashboard, roles: ['admin', 'manager', 'member', 'viewer'], end: true, navKey: 'dashboard' },
      { path: '/intake', label: 'استقبال ذكي', icon: Sparkles, roles: ['admin', 'manager', 'member'], navKey: 'intake' },
    ],
  },
  {
    label: 'سير العمل',
    items: [
      { path: '/cases', label: 'القضايا', icon: FolderOpen, roles: ['admin', 'manager', 'member'], navKey: 'cases' },
      { path: '/pipeline', label: 'خط الإنتاج', icon: GitBranch, roles: ['admin', 'manager', 'member'], navKey: 'pipeline' },
      { path: '/production', label: 'مونتاج', icon: Timer, roles: ['admin', 'manager', 'member'], navKey: 'production' },
    ],
  },
  {
    label: 'الإدارة',
    items: [
      { path: '/agencies', label: 'الجهات', icon: Building2, roles: ['admin', 'manager', 'member'], navKey: 'agencies' },
      { path: '/portals', label: 'بوابات', icon: Key, roles: ['admin', 'manager'], navKey: 'portals' },
      { path: '/inbox', label: 'صندوق الوارد', icon: Mail, roles: ['admin', 'manager', 'member'], navKey: 'inbox' },
      { path: '/email-accounts', label: 'إيميلات', icon: AtSign, roles: ['admin', 'manager', 'member'], navKey: 'email_accounts' },
      { path: '/teams', label: 'الفرق', icon: Users, roles: ['admin'], navKey: 'teams' },
      { path: '/permissions', label: 'فريق العمل', icon: UserCog, roles: ['admin', 'manager'], navKey: 'permissions' },
      { path: '/gdrive', label: 'Google Drive', icon: Cloud, roles: ['admin', 'manager', 'member'], navKey: 'gdrive' },
      { path: '/phone-logs', label: 'سجل المكالمات', icon: Phone, roles: ['admin', 'manager', 'member'], navKey: 'phone_logs' },
      { path: '/mail-logs', label: 'البريد الفعلي', icon: MailPlus, roles: ['admin', 'manager', 'member'], navKey: 'mail_logs' },
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
  // Role-based nav visibility from /permissions/mine (admin = everything).
  // null = still loading → render everything (no flicker); {} = no rows yet
  // → default open, so a brand-new role never loses its sidebar.
  const [navVisibility, setNavVisibility] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/permissions/mine')
      .then(d => { if (!cancelled) setNavVisibility(d.navVisibility || {}); })
      .catch(() => { if (!cancelled) setNavVisibility({}); });
    return () => { cancelled = true; };
  }, [user?.role]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? 'true' : 'false'); }
    catch {}
  }, [collapsed]);

  const width = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;
  const canAccess = (item) => !item.roles || item.roles.includes(user?.role);
  const isNavVisible = (item) => {
    if (navVisibility === null) return true;      // still loading — show everything
    if (Object.keys(navVisibility).length === 0) return true; // unconfigured — default open
    return navVisibility[item.navKey] !== false;  // hidden only when explicitly false
  };

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
              {group.items.filter(item => canAccess(item) && isNavVisible(item)).map(item => (
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
                  onMouseEnter={e => {
                    const active = e.currentTarget.getAttribute('aria-current');
                    if (!active || active === 'false') {
                      e.currentTarget.style.background = 'var(--bg-tertiary)';
                      e.currentTarget.style.color = 'var(--text-primary)';
                    }
                  }}
                  onMouseLeave={e => {
                    const active = e.currentTarget.getAttribute('aria-current');
                    if (!active || active === 'false') {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = 'var(--text-secondary)';
                    }
                  }}
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
