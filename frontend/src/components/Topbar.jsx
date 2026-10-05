import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sun, Moon, Bell, UserCircle, LogOut, ChevronDown, Menu, Languages, Search, FileText, Mail, Building2, Folder, MessagesSquare } from 'lucide-react';
import { api } from '../api';
import { LANG_KEY } from '../i18n';

const PAGE_META = [
  { test: p => p === '/', key: 'dashboard' },
  { test: p => p.startsWith('/intake'), key: 'intake' },
  // Checked before the plain '/ai-assistant' test below -- both start with
  // the same prefix, so the more specific chat sub-route must win first.
  { test: p => p.startsWith('/ai-tasks'), key: 'aiTasks' },
  { test: p => p.startsWith('/ai-assistant/chat'), key: 'aiAssistantChat' },
  { test: p => p.startsWith('/ai-assistant'), key: 'aiAssistant' },
  { test: p => /^\/cases\/\d+/.test(p), key: 'caseDetail' },
  { test: p => p.startsWith('/cases'), key: 'cases' },
  { test: p => p.startsWith('/pipeline'), key: 'pipeline' },
  { test: p => p.startsWith('/production-lists'), key: 'productionLists' },
  { test: p => p.startsWith('/production'), key: 'production' },
  { test: p => p.startsWith('/inbox'), key: 'inbox' },
  { test: p => p.startsWith('/forum'), key: 'forum' },
  { test: p => p.startsWith('/messages'), key: 'messages' },
  { test: p => p.startsWith('/agencies'), key: 'agencies' },
  { test: p => p.startsWith('/portals'), key: 'portals' },
  { test: p => p.startsWith('/email-accounts'), key: 'emailAccounts' },
  { test: p => p.startsWith('/teams'), key: 'teams' },
  { test: p => p.startsWith('/permissions'), key: 'permissions' },
  { test: p => p.startsWith('/gdrive'), key: 'gdrive' },
  { test: p => p.startsWith('/phone-logs'), key: 'phoneLogs' },
  { test: p => p.startsWith('/mail-logs'), key: 'mailLogs' },
  { test: p => p.startsWith('/theme-settings'), key: 'themeSettings' },
  { test: p => p.startsWith('/trash'), key: 'trash' },
  { test: p => p.startsWith('/settings'), key: 'settings' },
  { test: p => p.startsWith('/profile'), key: 'profile' },
];

function getPageMetaKey(pathname) {
  return PAGE_META.find(m => m.test(pathname))?.key || 'fallback';
}

function ResultSection({ title, children }) {
  return (
    <div className="py-1.5">
      <div className="px-3 py-1 text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>{title}</div>
      {children}
    </div>
  );
}

function ResultRow({ icon: Icon, onClick, primary, secondary, disabled }) {
  // A document with no linked case has nowhere to navigate to (documents
  // only ever open inside a case's own الملفات tab, there's no standalone
  // document page) -- clicking used to just silently do nothing, which
  // looked like a broken/dead result row. Rendering it visibly inert
  // instead makes that limitation clear rather than looking like a bug.
  if (disabled) {
    return (
      <div className="w-full flex items-center gap-2 px-3 py-1.5 text-start opacity-50 cursor-default" style={{ color: 'var(--text-primary)' }}>
        <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate">{primary}</div>
          {secondary && <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{secondary}</div>}
        </div>
      </div>
    );
  }
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2 px-3 py-1.5 text-start ds-transition-colors"
      style={{ color: 'var(--text-primary)' }}
      onMouseOver={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
      onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium truncate">{primary}</div>
        {secondary && <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{secondary}</div>}
      </div>
    </button>
  );
}

// Global header search -- one query fanned out across cases, documents,
// communications, and agencies (backend: GET /api/search), debounced so
// every keystroke doesn't fire its own request. Clicking a document/
// communication result navigates to the case it belongs to (there's no
// standalone detail page for either) -- an unlinked communication (no case
// yet) opens its own standalone message page instead.
function GlobalSearch() {
  const { t } = useTranslation('topbar');
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const debounceRef = useRef(null);
  // Guards against an earlier, slower query's response landing AFTER a
  // later, faster one and silently overwriting fresher results with stale
  // ones -- same fix already applied to the notification poller in this
  // same file (notifRequestRef).
  const searchRequestRef = useRef(0);

  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('mousedown', onClick); clearTimeout(debounceRef.current); };
  }, []);

  const onChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    clearTimeout(debounceRef.current);
    if (v.trim().length < 2) { setResults(null); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      const requestId = ++searchRequestRef.current;
      setLoading(true);
      try {
        const d = await api.get(`/search?q=${encodeURIComponent(v.trim())}`);
        if (requestId !== searchRequestRef.current) return;
        setResults(d); setOpen(true);
      } catch { if (requestId === searchRequestRef.current) setResults(null); }
      if (requestId === searchRequestRef.current) setLoading(false);
    }, 300);
  };

  const goTo = (path) => { setOpen(false); setQuery(''); setResults(null); navigate(path); };

  const totalCount = results ? (results.cases?.length || 0) + (results.documents?.length || 0) + (results.communications?.length || 0) + (results.agencies?.length || 0) : 0;

  return (
    <div className="relative hidden sm:block" ref={ref}>
      <Search className="w-4 h-4 absolute end-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
      <input value={query} onChange={onChange} onFocus={() => { if (results) setOpen(true); }}
        placeholder={t('topbar:globalSearch.placeholder')}
        className="w-40 md:w-64 ps-3 pe-9 py-2 rounded-xl text-sm ds-transition-colors"
        style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
      {open && (
        <div className="absolute top-full mt-1 end-0 w-80 max-h-96 overflow-y-auto rounded-xl shadow-lg z-30"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          {loading ? (
            <div className="p-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>{t('topbar:globalSearch.searching')}</div>
          ) : totalCount === 0 ? (
            <div className="p-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>{t('topbar:globalSearch.noResults')}</div>
          ) : (
            <>
              {results.cases?.length > 0 && (
                <ResultSection title={t('topbar:globalSearch.sections.cases')}>
                  {results.cases.map(c => (
                    <ResultRow key={`case-${c.id}`} icon={Folder} onClick={() => goTo(`/cases/${c.id}`)}
                      primary={c.title} secondary={`#${c.id}${c.client_name ? ` — ${c.client_name}` : ''}`} />
                  ))}
                </ResultSection>
              )}
              {results.documents?.length > 0 && (
                <ResultSection title={t('topbar:globalSearch.sections.documents')}>
                  {results.documents.map(d => (
                    <ResultRow key={`doc-${d.id}`} icon={FileText} disabled={!d.case_id} onClick={() => d.case_id && goTo(`/cases/${d.case_id}`)}
                      primary={d.original_name} secondary={d.case_title || t('topbar:globalSearch.unlinkedDocument')} />
                  ))}
                </ResultSection>
              )}
              {results.communications?.length > 0 && (
                <ResultSection title={t('topbar:globalSearch.sections.communications')}>
                  {results.communications.map(m => (
                    <ResultRow key={`comm-${m.id}`} icon={Mail}
                      onClick={() => goTo(m.case_id ? `/cases/${m.case_id}` : `/inbox/message/${m.id}`)}
                      primary={m.subject || t('topbar:globalSearch.noSubject')} secondary={m.case_title} />
                  ))}
                </ResultSection>
              )}
              {results.agencies?.length > 0 && (
                <ResultSection title={t('topbar:globalSearch.sections.agencies')}>
                  {results.agencies.map(a => (
                    <ResultRow key={`agency-${a.id}`} icon={Building2} onClick={() => goTo('/agencies')} primary={a.name} />
                  ))}
                </ResultSection>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Topbar({ user, onLogout, theme, toggleTheme, lang, toggleLang, onMenuClick }) {
  const { t } = useTranslation(['topbar', 'common']);
  const timeAgo = (dateStr) => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return t('topbar:timeAgo.now');
    if (mins < 60) return t('topbar:timeAgo.minutes', { count: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('topbar:timeAgo.hours', { count: hrs });
    return t('topbar:timeAgo.days', { count: Math.floor(hrs / 24) });
  };
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  // Internal messages get their OWN independent unread badge, deliberately
  // separate from the generic notifications bell above (never fanned into
  // `notifications` at all -- see routes/messages.js) so a new DM doesn't
  // get lost/merged in with every other system alert.
  const [messagesUnread, setMessagesUnread] = useState(0);
  const [roleLabel, setRoleLabel] = useState(null);
  const menuRef = useRef(null);
  const notifRef = useRef(null);
  const metaKey = getPageMetaKey(pathname);
  // defaultValue guards against exactly the bug a missing/unlisted route hit
  // before this: with i18n's returnEmptyString:false, a key that resolves to
  // nothing renders the raw key string ("pageMeta.fallback.title") right on
  // screen instead of blank -- defaultValue gives it somewhere safe to land.
  const meta = {
    eyebrow: t(`topbar:pageMeta.${metaKey}.eyebrow`, { defaultValue: 'FOIA OS' }),
    title: t(`topbar:pageMeta.${metaKey}.title`, { defaultValue: '' }),
  };

  // Guards against a slow poll's response landing AFTER a later, faster
  // poll's response -- without this, the stale one would silently overwrite
  // the fresher notification list/unread count (e.g. right after markAllRead
  // reset it locally to 0).
  const notifRequestRef = useRef(0);
  const loadNotifications = () => {
    const requestId = ++notifRequestRef.current;
    api.get('/notifications').then(d => {
      if (requestId !== notifRequestRef.current) return;
      setNotifications(d.data || []); setUnreadCount(d.unreadCount || 0);
    }).catch(() => {});
  };

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadMessagesUnread = () => api.get('/conversations/unread-count').then(d => setMessagesUnread(d.unread || 0)).catch(() => {});
    loadMessagesUnread();
    const interval = setInterval(loadMessagesUnread, 20000);
    return () => clearInterval(interval);
  }, []);

  // The role chip used to hardcode only admin/manager and fall back to the
  // generic "عضو" for everything else -- so any custom role created from
  // "فريق العمل" (e.g. "Order Management Specialist") displayed as plain
  // "Member" here, making it look like the role assignment hadn't taken.
  // Resolve the real label from /roles instead.
  useEffect(() => {
    let cancelled = false;
    api.get('/roles').then(d => {
      if (cancelled) return;
      const match = (d.roles || []).find(r => r.name === user?.role);
      setRoleLabel(match?.label || null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.role]);

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
      // Only reflect "read" locally once the server actually confirms it --
      // applying it unconditionally meant a failed request (network blip,
      // expired session) still showed the notification as read and the
      // badge decremented, silently reverting back on the next 60s poll
      // with no error ever surfaced to the user.
      try {
        await api.put(`/notifications/${n.id}/read`, {});
        setNotifications(p => p.map(x => x.id === n.id ? { ...x, is_read: true } : x));
        setUnreadCount(c => Math.max(0, c - 1));
      } catch {}
    }
    setNotifOpen(false);
    if (n.target_type === 'case' && n.target_id) navigate(`/cases/${n.target_id}`);
    else if (n.target_type === 'pipeline_list') navigate('/pipeline');
    else if (n.target_type === 'email_account') navigate('/email-accounts');
    else if (n.target_type === 'forum_topic' && n.target_id) navigate(`/forum?topic=${n.target_id}`);
    else if (n.target_type === 'ai_finding') navigate(n.target_id ? `/ai-tasks?finding=${n.target_id}` : '/ai-tasks');
    else if (n.target_type === 'settings') navigate('/gdrive');
    else if (n.target_type === 'conversation') navigate('/messages');
  };

  const markAllRead = async () => {
    try {
      await api.put('/notifications/read-all', {});
      setNotifications(p => p.map(x => ({ ...x, is_read: true })));
      setUnreadCount(0);
    } catch {}
  };

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-2 px-3 md:px-6 h-[68px] shrink-0"
      style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 min-w-0">
        <button onClick={onMenuClick} className="md:hidden p-2 rounded-xl shrink-0 transition-colors" style={{ color: 'var(--text-secondary)' }}
          onMouseOver={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
          onMouseOut={e => e.currentTarget.style.background = 'transparent'}
          title={t('topbar:menuTooltip')}>
          <Menu className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider truncate" style={{ color: 'var(--accent)' }}>{meta.eyebrow}</p>
          <h1 className="text-lg font-bold truncate" style={{ color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>{meta.title}</h1>
        </div>
      </div>

      <div className="flex items-center gap-1 md:gap-2 shrink-0">
        <GlobalSearch />

        <button onClick={toggleTheme} className="p-2.5 rounded-xl transition-colors" style={{ color: 'var(--text-secondary)' }}
          onMouseOver={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
          onMouseOut={e => e.currentTarget.style.background = 'transparent'}
          title={theme === 'dark' ? t('topbar:theme.light') : t('topbar:theme.dark')}>
          {theme === 'dark' ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
        </button>

        <button onClick={toggleLang} className="p-2.5 rounded-xl transition-colors flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}
          onMouseOver={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
          onMouseOut={e => e.currentTarget.style.background = 'transparent'}
          title={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}>
          <Languages className="w-4.5 h-4.5" />
          {/* Shows the OTHER language's own name (what you'd switch TO) --
              deliberately never run through t(), since this label IS a
              language's name for itself, not app content. */}
          <span className="text-xs font-medium hidden sm:inline">{lang === 'ar' ? 'English' : 'العربية'}</span>
        </button>

        <button onClick={() => navigate('/messages')} className="p-2.5 rounded-xl transition-colors relative" style={{ color: 'var(--text-secondary)' }}
          onMouseOver={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
          onMouseOut={e => e.currentTarget.style.background = 'transparent'}
          title="الرسائل الداخلية">
          <MessagesSquare className="w-4.5 h-4.5" />
          {messagesUnread > 0 && (
            <span className="absolute top-1 left-1 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center"
              style={{ background: 'var(--danger)', color: 'white' }}>{messagesUnread > 9 ? '9+' : messagesUnread}</span>
          )}
        </button>

        <div className="relative" ref={notifRef}>
          <button onClick={() => setNotifOpen(o => !o)} className="p-2.5 rounded-xl transition-colors relative" style={{ color: 'var(--text-secondary)' }}
            onMouseOver={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
            onMouseOut={e => e.currentTarget.style.background = 'transparent'}
            title={t('topbar:notifications.tooltip')}>
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
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('topbar:notifications.title')}</span>
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-[10px]" style={{ color: 'var(--accent)' }}>{t('topbar:notifications.markAllRead')}</button>
                )}
              </div>
              <div style={{ borderTop: '1px solid var(--border)' }} />
              {notifications.length === 0 ? (
                <div className="px-3.5 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>{t('topbar:notifications.empty')}</div>
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
                {roleLabel || (user?.role === 'admin' ? t('common:roles.admin') : user?.role === 'manager' ? t('common:roles.manager') : t('topbar:menu.member'))}
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
                <UserCircle className="w-4 h-4" /> {t('topbar:menu.profile')}
              </Link>
              <div className="my-1.5" style={{ borderTop: '1px solid var(--border)' }} />
              <button onClick={onLogout}
                className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm w-full transition-colors" style={{ color: 'var(--danger)' }}
                onMouseOver={e => e.currentTarget.style.background = 'var(--danger-subtle)'}
                onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                <LogOut className="w-4 h-4" /> {t('topbar:menu.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
