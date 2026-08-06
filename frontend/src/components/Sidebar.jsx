import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { FileText, ChevronRight, ChevronLeft, Settings as SettingsIcon } from 'lucide-react';
import { api } from '../api';
import { NAV_CATALOG } from '../navCatalog';

const EXPANDED_WIDTH = 220;
const COLLAPSED_WIDTH = 60;
const STORAGE_KEY = 'foia_sidebar_collapsed';

export default function Sidebar({ user, mobileOpen, onCloseMobile }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true'; }
    catch { return false; }
  });
  // Role-based nav visibility from /permissions/mine (admin = everything).
  // null = still loading → render everything (no flicker); {} = no rows yet
  // → default open, so a brand-new role never loses its sidebar.
  const [navVisibility, setNavVisibility] = useState(null);
  // Global order + sidebar/settings placement from /nav-layout (same for
  // every user, configured in الإعدادات → ترتيب القائمة الجانبية). null =
  // still loading → fall back to catalog order, all in the sidebar.
  const [navLayout, setNavLayout] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/permissions/mine')
      .then(d => { if (!cancelled) setNavVisibility(d.navVisibility || {}); })
      .catch(() => { if (!cancelled) setNavVisibility({}); });
    return () => { cancelled = true; };
  }, [user?.role]);

  useEffect(() => {
    let cancelled = false;
    api.get('/nav-layout')
      .then(d => { if (!cancelled) setNavLayout(d.data || []); })
      .catch(() => { if (!cancelled) setNavLayout([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? 'true' : 'false'); }
    catch {}
  }, [collapsed]);

  // Published as a CSS variable so the page shell (App.jsx) can reserve
  // exactly this much space -- previously hardcoded to 256px regardless of
  // collapsed state, leaving a visible gap (or overlap) next to the sidebar
  // whichever state it was actually in.
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH}px`);
  }, [collapsed]);

  const width = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;
  const canAccess = (item) => !item.roles || item.roles.includes(user?.role);
  const isNavVisible = (item) => {
    if (navVisibility === null) return true;      // still loading — show everything
    if (Object.keys(navVisibility).length === 0) return true; // unconfigured — default open
    return navVisibility[item.key] !== false;  // hidden only when explicitly false
  };

  // Merge the static catalog (path/label/icon/roles) with the fetched
  // global layout (order + sidebar/settings placement). Falls back to
  // catalog order, everything in the sidebar, while /nav-layout is loading
  // or unreachable -- never blocks navigation on that request.
  const layoutByKey = Object.fromEntries((navLayout || []).map(l => [l.nav_key, l]));
  const items = NAV_CATALOG
    .filter(item => canAccess(item) && isNavVisible(item))
    .filter(item => (layoutByKey[item.key]?.location || 'sidebar') === 'sidebar')
    .sort((a, b) => (layoutByKey[a.key]?.sort_order ?? 999) - (layoutByKey[b.key]?.sort_order ?? 999));

  return (
    <>
      {/* Backdrop — mobile only, closes the sidebar on tap-outside */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 md:hidden" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onCloseMobile} />
      )}

      <aside
        className={`fixed right-0 top-0 h-full flex flex-col z-40 transition-transform duration-200
          ${mobileOpen ? 'translate-x-0' : 'translate-x-full'} md:translate-x-0`}
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
          {/* Collapse button — desktop only; mobile closes via the backdrop or a nav tap */}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="hidden md:block p-1 rounded-md shrink-0 ds-transition-colors"
            style={{ color: 'var(--text-muted)' }}
            title={collapsed ? 'توسيع الشريط الجانبي' : 'طي الشريط الجانبي'}>
            {collapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation — flat, order driven entirely by /nav-layout */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-3">
          <div className="space-y-0.5">
            {items.map(item => (
              <NavItemLink key={item.key} item={item} collapsed={collapsed} onNavigate={onCloseMobile} />
            ))}
          </div>
        </nav>

        {/* Pinned footer — الإعدادات lives here (below the sortable nav
            list, not as a topbar dropdown item, not itself reorderable),
            but its visibility is still controlled from الصلاحيات like any
            other item: derived from the settings resource's "عرض"
            permission (see RESOURCE_VIEW_NAV_KEYS on the backend). */}
        {isNavVisible({ key: 'settings' }) && (
          <div className="shrink-0 px-2.5 py-3" style={{ borderTop: '1px solid var(--border)' }}>
            <NavItemLink item={{ path: '/settings', label: 'الإعدادات', icon: SettingsIcon }} collapsed={collapsed} onNavigate={onCloseMobile} />
          </div>
        )}
      </aside>
    </>
  );
}

function NavItemLink({ item, collapsed, onNavigate }) {
  return (
    <NavLink
      to={item.path}
      end={item.end}
      onClick={onNavigate}
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
  );
}
