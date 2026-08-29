// FOIA OS v2 - App entry point
// Build: hotfix $RANDOM
import { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { api } from './api';
import i18n, { LANG_KEY } from './i18n';
import './styles/design-tokens.css';
import './styles/motion.css';
import Button from './components/ui/Button';
import Input from './components/ui/Input';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Dashboard from './pages/Dashboard';
import AIIntake from './pages/AIIntake';
import AIAssistantSettings from './pages/AIAssistantSettings';
import AIAssistantChat from './pages/AIAssistantChat';
import AIAssistantWidget from './components/AIAssistantWidget';
import useActivityHeartbeat from './hooks/useActivityHeartbeat';
import Cases from './pages/Cases';
import CaseDetail from './pages/CaseDetail';

import Agencies from './pages/Agencies';







import LoginPage from './pages/Login';
import ErrorBoundary from './components/ErrorBoundary';

const Settings = lazy(() => import('./pages/Settings'));
const ProductionListsAdmin = lazy(() => import('./pages/ProductionListsAdmin'));
const ThemeSettings = lazy(() => import('./pages/ThemeSettings'));
const Users = lazy(() => import('./pages/Users'));
const Teams = lazy(() => import('./pages/Teams'));
const Pipeline = lazy(() => import('./pages/Pipeline'));
const Production = lazy(() => import('./pages/Production'));
const Portals = lazy(() => import('./pages/Portals'));
const CaseGDrive = lazy(() => import('./pages/CaseGDrive'));
const MailLogs = lazy(() => import('./pages/MailLogs'));
const PhoneLogs = lazy(() => import('./pages/PhoneLogs'));
const EmailAccounts = lazy(() => import('./pages/EmailAccounts'));
const Profile = lazy(() => import('./pages/Profile'));
const ListDetail = lazy(() => import('./pages/ListDetail'));
const Inbox = lazy(() => import('./pages/Inbox'));
const MessageView = lazy(() => import('./pages/MessageView'));
const PublicUpload = lazy(() => import('./pages/PublicUpload'));
const TeamPermissions = lazy(() => import('./components/TeamPermissions'));
const Forum = lazy(() => import('./pages/Forum'));

function AppFallback() { return <div style={{padding:"20px",color:"var(--ds-text-muted)"}}>جاري التحميل...</div>; }

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('foia_theme') || 'light'; } catch { return 'light'; } });
  const [lang, setLang] = useState(() => { try { return localStorage.getItem(LANG_KEY) || 'ar'; } catch { return 'ar'; } });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const location = useLocation();
  // Mounted once for the whole authenticated session (not per-page), so
  // navigating between routes never resets the accumulated active time.
  useActivityHeartbeat(!!user);

  useEffect(() => {
    const token = localStorage.getItem('foia_token');
    if (token) {
      api.setToken(token);
      api.get('/settings').then(d => {
        const s = (d && d.data) || {};
        if (s.theme_mode) {
          setTheme(s.theme_mode);
          document.documentElement.dataset.theme = s.theme_mode;
        }
        for (const [k, v] of Object.entries(s)) {
          if (k.startsWith('theme_')) {
            const varName = '--' + k.replace('theme_', '');
            document.documentElement.style.setProperty(varName, v);
          }
        }
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('foia_token');
    if (token) {
      api.setToken(token);
      api.me().then(u => {
        if (u && u.user) setUser(u.user);
        setLoading(false);
      }).catch(() => {
        localStorage.removeItem('foia_token');
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('foia_token');
    api.setToken(null);
    setUser(null);
  };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('foia_theme', next); } catch {}
    document.documentElement.dataset.theme = next;
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleLang = () => {
    const next = lang === 'ar' ? 'en' : 'ar';
    setLang(next);
    try { localStorage.setItem(LANG_KEY, next); } catch {}
  };

  // Mirrors the theme effect above -- keeps <html> lang/dir in sync with
  // the active language, and drives every t()-migrated component via
  // i18next's own language change. index.html's static lang="ar" dir="rtl"
  // is only the pre-mount default now; this effect owns it from here on.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = i18n.dir(lang);
    i18n.changeLanguage(lang);
  }, [lang]);

  // The one genuinely public page in this app -- an external agency opening
  // a FileFetch link has no account and never will. Checked before the
  // loading/login gates below (not just before the authenticated shell, like
  // /inbox/message/:id is), since this must render with zero dependency on
  // auth state at all.
  if (window.location.pathname.startsWith('/upload/')) {
    return (
      <Suspense fallback={<AppFallback />}>
        <Routes><Route path="/upload/:token" element={<PublicUpload />} /></Routes>
      </Suspense>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center" style={{ background: 'var(--ds-bg-primary)' }}>
        <div className="w-10 h-10 rounded-full animate-spin mb-4" style={{ border: '3px solid var(--ds-accent)', borderTopColor: 'transparent' }} />
        <p className="text-sm" style={{ color: 'var(--ds-text-muted)' }}>جاري تحميل النظام...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={(u) => setUser(u)} />;
  }

  // A message opened "في تاب خارجية" (window.open, a genuine new page load
  // -- not client-side SPA navigation) is meant to sit on its own for
  // review/copying, not inside the normal sidebar/topbar shell. Checked
  // here, before the shell renders, since this path is never reached via
  // in-app <Link>/navigate -- only by opening a fresh tab at this URL.
  if (window.location.pathname.startsWith('/inbox/message/')) {
    return (
      <Suspense fallback={<AppFallback />}>
        <ErrorBoundary key={location.pathname}>
          <Routes><Route path="/inbox/message/:id" element={<MessageView />} /></Routes>
        </ErrorBoundary>
      </Suspense>
    );
  }

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg-primary)' }}>
      <Sidebar user={user} mobileOpen={mobileSidebarOpen} onCloseMobile={() => setMobileSidebarOpen(false)} />
      {/* The sidebar sits at the inline-START edge (right in RTL, left in
          LTR -- see Sidebar.jsx), so this reserves space at the SAME
          logical edge via ms- (margin-inline-start), not a physical mr-
          which only ever meant "right" regardless of direction and broke
          layout the moment English/LTR was active. */}
      <div className="flex-1 flex flex-col overflow-hidden transition-[margin] duration-200 ms-0 md:ms-[var(--sidebar-width,220px)]">
        <Topbar user={user} onLogout={handleLogout} theme={theme} toggleTheme={toggleTheme} lang={lang} toggleLang={toggleLang} onMenuClick={() => setMobileSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-3 md:p-6">
          {/* Keyed on pathname -- a class component's error state otherwise
              persists across navigation. Without this, one page throwing
              once left every OTHER page unreachable behind the same "حدث
              خطأ غير متوقع" screen until a manual hard reload, since clicking
              a different sidebar item just re-rendered <Routes> under the
              same already-tripped ErrorBoundary instance. */}
          <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<AppFallback />}><Routes>
            <Route path="/login" element={<Dashboard />} />
            <Route path="/" element={<Dashboard />} />
            <Route path="/intake" element={<AIIntake />} />
            <Route path="/ai-assistant" element={<AIAssistantSettings />} />
            <Route path="/ai-assistant/chat" element={<AIAssistantChat />} />
            <Route path="/cases" element={<Cases />} />
            <Route path="/cases/:id" element={<CaseDetail />} />
            <Route path="/pipeline" element={<Pipeline />} />
            <Route path="/production" element={<Production />} />
            <Route path="/agencies" element={<Agencies />} />
            <Route path="/portals" element={<Portals />} />
            <Route path="/email-accounts" element={<EmailAccounts />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/forum" element={<Forum />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/production-lists" element={<ProductionListsAdmin />} />
            <Route path="/theme-settings" element={<ThemeSettings />} />
            <Route path="/pipeline/lists/:id" element={<ListDetail />} />
            <Route path="/profile/:id" element={<Profile />} />
            <Route path="/profile" element={<Profile />} />
            {user.role === 'admin' && <Route path="/teams" element={<Teams />} />}
            <Route path="/gdrive" element={<CaseGDrive />} />
            <Route path="/phone-logs" element={<PhoneLogs />} />
            <Route path="/mail-logs" element={<MailLogs />} />
            <Route path="/users" element={<Users />} />
            <Route path="/permissions" element={<TeamPermissions />} />
          </Routes></Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <AIAssistantWidget />
    </div>
  );
}

export default App;
