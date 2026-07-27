import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Sun, Moon, Bell, Settings as SettingsIcon, UserCircle, LogOut, ChevronDown } from 'lucide-react';

const PAGE_META = [
  { test: p => p === '/', eyebrow: 'نظرة عامة', title: 'لوحة التحكم' },
  { test: p => p.startsWith('/intake'), eyebrow: 'أدوات ذكية', title: 'استقبال ذكي' },
  { test: p => /^\/cases\/\d+/.test(p), eyebrow: 'القضايا', title: 'تفاصيل القضية' },
  { test: p => p.startsWith('/cases'), eyebrow: 'إدارة', title: 'القضايا' },
  { test: p => p.startsWith('/pipeline'), eyebrow: 'سير العمل', title: 'خط الإنتاج' },
  { test: p => p.startsWith('/production'), eyebrow: 'سير العمل', title: 'مونتاج' },
  { test: p => p.startsWith('/agencies'), eyebrow: 'إدارة', title: 'الجهات' },
  { test: p => p.startsWith('/portals'), eyebrow: 'إدارة', title: 'البوابات الإلكترونية' },
  { test: p => p.startsWith('/email-accounts'), eyebrow: 'إدارة', title: 'حسابات البريد' },
  { test: p => p.startsWith('/teams'), eyebrow: 'إدارة', title: 'الفرق' },
  { test: p => p.startsWith('/settings'), eyebrow: 'النظام', title: 'الإعدادات' },
  { test: p => p.startsWith('/profile'), eyebrow: 'حسابي', title: 'الملف الشخصي' },
];

function getPageMeta(pathname) {
  return PAGE_META.find(m => m.test(pathname)) || { eyebrow: 'FOIA OS', title: '' };
}

export default function Topbar({ user, onLogout, theme, toggleTheme }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const meta = getPageMeta(pathname);

  useEffect(() => {
    const onClick = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between px-6 h-[68px] shrink-0"
      style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)' }}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>{meta.eyebrow}</p>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>{meta.title}</h1>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={toggleTheme} className="p-2.5 rounded-xl transition-colors" style={{ color: 'var(--text-secondary)' }}
          onMouseOver={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
          onMouseOut={e => e.currentTarget.style.background = 'transparent'}
          title={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}>
          {theme === 'dark' ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
        </button>

        <button onClick={() => navigate(`/profile/${user?.id || 1}`)} className="p-2.5 rounded-xl transition-colors relative" style={{ color: 'var(--text-secondary)' }}
          onMouseOver={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
          onMouseOut={e => e.currentTarget.style.background = 'transparent'}
          title="الإشعارات">
          <Bell className="w-4.5 h-4.5" />
        </button>

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
              <Link to="/settings" onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition-colors" style={{ color: 'var(--text-secondary)' }}
                onMouseOver={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                <SettingsIcon className="w-4 h-4" /> الإعدادات
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
