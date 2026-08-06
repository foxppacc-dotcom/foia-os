import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Sun, Moon, Bell, UserCircle, LogOut, ChevronDown, Menu } from 'lucide-react';
import { api } from '../api';

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} د`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} س`;
  return `منذ ${Math.floor(hrs / 24)} يوم`;
}

const PAGE_META = [
  { test: p => p === '/', eyebrow: 'نظرة عامة', title: 'لوحة التحكم' },
  { test: p => p.startsWith('/intake'), eyebrow: 'أدوات ذكية', title: 'استقبال ذكي' },
  { test: p => /^\/cases\/\d+/.test(p), eyebrow: 'القضايا', title: 'تفاصيل القضية' },
  { test: p => p.startsWith('/cases'), eyebrow: 'إدارة', title: 'القضايا' },
  { test: p => p.startsWith('/pipeline'), eyebrow: 'سير العمل', title: 'خط الإنتاج' },
  { test: p => p.startsWith('/production-lists'), eyebrow: 'النظام', title: 'إدارة قوائم الإنتاج' },
  { test: p => p.startsWith('/production'), eyebrow: 'سير العمل', title: 'مونتاج' },
  { test: p => p.startsWith('/agencies'), eyebrow: 'إدارة', title: 'الجهات' },
  { test: p => p.startsWith('/portals'), eyebrow: 'إدارة', title: 'البوابات الإلكترونية' },
  { test: p => p.startsWith('/email-accounts'), eyebrow: 'إدارة', title: 'حسابات البريد' },
  { test: p => p.startsWith('/teams'), eyebrow: 'إدارة', title: 'الفرق' },
  { test: p => p.startsWith('/theme-settings'), eyebrow: 'النظام', title: 'الألوان والثيم' },
  { test: p => p.startsWith('/settings'), eyebrow: 'النظام', title: 'ترتيب القائمة الجانبية' },
  { test: p => p.startsWith('/profile'), eyebrow: 'حسابي', title: 'الملف الشخصي' },
];

function getPageMeta(pathname) {
  return PAGE_META.find(m => m.test(pathname)) || { eyebrow: 'FOIA OS', title: '' };
}

export default function Topbar({ user, onLogout, theme, toggleTheme, onMenuClick }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const menuRef = useRef(null);
  const notifRef = useRef(null);
  const meta = getPageMeta(pathname);

  const loadNotifications = () => {
    api.get('/notifications').then(d => { setNotifications(d.data || []); setUnreadCount(d.unreadCount || 0); }).catch(() => {});
  };

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const openNotification = async (n) => {
    if (!n.is_read) {
      try { await api.put(`/notifications/${n.id}/read`, {}); } catch {}
      setNotifications(p => p.map(x => x.id === n.id ? { ...x, is_read: true } : x));
      setUnreadCount(c => Math.max(0, c - 1));
    }
    setNotifOpen(false);
    if (n.target_type === 'case' && n.target_id) navigate(`/cases/${n.target_id}`);
  };

  const markAllRead = async () => {
    try { await api.put('/notifications/read-all', {}); } catch {}
    setNotifications(p => p.map(x => ({ ...x, is_read: true })));
    setUnreadCount(0);
  };

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-2 px-3 md:px-6 h-[68px] shrink-0"
      style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 min-w-0">
        <button onClick={onMenuClick} className="md:hidden p-2 rounded-xl shrink-0 transition-colors" style={{ color: 'var(--text-secondary)' }}
          onMouseOver={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
          onMouseOut={e => e.currentTarget.style.background = 'transparent'}
          title="القائمة">
          <Menu className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider truncate" style={{ color: 'var(--accent)' }}>{meta.eyebrow}</p>
          <h1 className="text-lg font-bold truncate" style={{ color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>{meta.title}</h1>
        </div>
      </div>

      <div className="flex items-center gap-1 md:gap-2 shrink-0">
        <button onClick={toggleTheme} className="p-2.5 rounded-xl transition-colors" style={{ color: 'var(--text-secondary)' }}
          onMouseOver={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
          onMouseOut={e => e.currentTarget.style.background = 'transparent'}
          title={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}>
          {theme === 'dark' ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
        </button>

        <div className="relative" ref={notifRef}>
          <button onClick={() => setNotifOpen(o => !o)} className="p-2.5 rounded-xl transition-colors relative" style={{ color: 'var(--text-secondary)' }}
            onMouseOver={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
            onMouseOut={e => e.currentTarget.style.background = 'transparent'}
            title="الإشعارات">
            <Bell className="w-4.5 h-4.5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 left-1 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center"
                style={{ background: 'var(--danger)', color: 'white' }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute left-0 top-full mt-2 w-80 rounded-2xl border py-1.5 animate-scaleIn z-30 max-h-[420px] overflow-y-auto"
              style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}>
              <div className="flex items-center justify-between px-3.5 py-2">
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>الإشعارات</span>
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-[10px]" style={{ color: 'var(--accent)' }}>تعليم الكل كمقروء</button>
                )}
              </div>
              <div style={{ borderTop: '1px solid var(--border)' }} />
              {notifications.length === 0 ? (
                <div className="px-3.5 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>لا توجد إشعارات</div>
              ) : notifications.map(n => (
                <button key={n.id} onClick={() => openNotification(n)}
                  className="w-full text-right px-3.5 py-2.5 transition-colors block"
                  style={{ background: n.is_read ? 'transparent' : 'var(--accent-subtle)' }}
                  onMouseOver={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                  onMouseOut={e => e.currentTarget.style.background = n.is_read ? 'transparent' : 'var(--accent-subtle)'}>
                  <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{n.title}</p>
                  {n.body && <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{n.body}</p>}
                  <p className="text-[9px] mt-1" style={{ color: 'var(--text-muted)' }}>{timeAgo(n.created_at)}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="w-px h-6 mx-1" style={{ background: 'var(--border)' }} />

        <div className="relative" ref={menuRef}>
          <button onClick={() => setMenuOpen(o => !o)} className="flex items-center gap-2.5 pl-2 pr-1 py-1.5 rounded-xl transition-colors"
            onMouseOver={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
            onMouseOut={e => e.currentTarget.style.background = menuOpen ? 'var(--bg-tertiary)' : 'transparent'}
            style={{ background: menuOpen ? 'var(--bg-tertiary)' : 'transparent' }}>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`} style={{ color: 'var(--text-muted)' }} />
            <div className="text-right hidden sm:block">
              <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{user?.name}</p>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {user?.role === 'admin' ? 'مدير النظام' : user?.role === 'manager' ? 'مدير' : 'عضو'}
              </p>
            </div>
            <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
              {user?.name?.charAt(0) || 'U'}
            </div>
          </button>

          {menuOpen && (
            <div className="absolute left-0 top-full mt-2 w-48 rounded-2xl border py-1.5 animate-scaleIn z-30"
              style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}>
              <Link to={`/profile/${user?.id || 1}`} onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition-colors" style={{ color: 'var(--text-secondary)' }}
                onMouseOver={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                <UserCircle className="w-4 h-4" /> ملفي الشخصي
              </Link>
              <div className="my-1.5" style={{ borderTop: '1px solid var(--border)' }} />
              <button onClick={onLogout}
                className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm w-full transition-colors" style={{ color: 'var(--danger)' }}
                onMouseOver={e => e.currentTarget.style.background = 'var(--danger-subtle)'}
                onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                <LogOut className="w-4 h-4" /> تسجيل خروج
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
