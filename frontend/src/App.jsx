// FOIA OS v2 - App entry point
// Build: hotfix $RANDOM
import { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { api } from './api';
import './styles/design-tokens.css';
import './styles/motion.css';
import Button from './components/ui/Button';
import Input from './components/ui/Input';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Dashboard from './pages/Dashboard';
import AIIntake from './pages/AIIntake';
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
const TeamPermissions = lazy(() => import('./components/TeamPermissions'));

function AppFallback() { return <div style={{padding:"20px",color:"var(--ds-text-muted)"}}>جاري التحميل...</div>; }

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(localStorage.getItem('foia_theme') || 'light');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

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
    localStorage.setItem('foia_theme', next);
    document.documentElement.dataset.theme = next;
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const canAccess = (resource) => {
    const perms = {
      admin: '*',
      manager: ['cases', 'users', 'reports', 'tasks', 'agencies', 'pipeline', 'communications', 'settings'],
      agent: ['cases', 'tasks', 'communications', 'attendance', 'profile'],
      editor: ['cases', 'montage'],
      viewer: ['cases', 'pipeline', 'reports', 'profile'],
    };
    const allowed = perms[user?.role] || [];
    return allowed === '*' || allowed.includes(resource);
  };

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

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg-primary)' }}>
      <Sidebar user={user} mobileOpen={mobileSidebarOpen} onCloseMobile={() => setMobileSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden transition-[margin] duration-200 mr-0 md:mr-[var(--sidebar-width,220px)]">
        <Topbar user={user} onLogout={handleLogout} theme={theme} toggleTheme={toggleTheme} onMenuClick={() => setMobileSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-3 md:p-6">
          <ErrorBoundary>
          <Suspense fallback={<AppFallback />}><Routes>
            <Route path="/login" element={<Dashboard />} />
            <Route path="/" element={<Dashboard />} />
            {canAccess('intake') && <Route path="/intake" element={<AIIntake />} />}
            <Route path="/cases" element={<Cases />} />
            <Route path="/cases/:id" element={<CaseDetail />} />
            <Route path="/pipeline" element={<Pipeline />} />
            {canAccess('montage') && <Route path="/production" element={<Production />} />}
            {canAccess('agencies') && <Route path="/agencies" element={<Agencies />} />}
            {canAccess('portals') && <Route path="/portals" element={<Portals />} />}
            {canAccess('communications') && <Route path="/email-accounts" element={<EmailAccounts />} />}
            {canAccess('communications') && <Route path="/inbox" element={<Inbox />} />}
            {canAccess('settings') && <Route path="/settings" element={<Settings />} />}
            {canAccess('settings') && <Route path="/production-lists" element={<ProductionListsAdmin />} />}
            {canAccess('settings') && <Route path="/theme-settings" element={<ThemeSettings />} />}
            <Route path="/pipeline/lists/:id" element={<ListDetail />} />
            <Route path="/profile/:id" element={<Profile />} />
            <Route path="/profile" element={<Profile />} />
            {user.role === 'admin' && <Route path="/teams" element={<Teams />} />}
            {canAccess('communications') && <Route path="/gdrive" element={<CaseGDrive />} />}
            {canAccess('communications') && <Route path="/phone-logs" element={<PhoneLogs />} />}
            {canAccess('communications') && <Route path="/mail-logs" element={<MailLogs />} />}
            {canAccess('users') && <Route path="/users" element={<Users />} />}
            {canAccess('users') && <Route path="/permissions" element={<TeamPermissions />} />}
          </Routes></Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default App;
