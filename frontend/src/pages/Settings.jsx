import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Save, ArrowUpDown, ExternalLink } from 'lucide-react';
import { NAV_CATALOG } from '../navCatalog';

export default function Settings() {
  const [navLayout, setNavLayout] = useState([]);
  const [layoutLoading, setLayoutLoading] = useState(true);
  const [savingLayout, setSavingLayout] = useState(false);

  useEffect(() => {
    setLayoutLoading(true);
    api.get('/nav-layout').then(d => setNavLayout(d.data || [])).catch(() => {}).finally(() => setLayoutLoading(false));
  }, []);

  // ===== SIDEBAR LAYOUT (global order + sidebar/settings placement) =====

  const layoutLabel = (navKey) => NAV_CATALOG.find(n => n.key === navKey)?.label || navKey;

  const moveLayoutItem = (index, dir) => {
    setNavLayout(prev => {
      const next = [...prev];
      const swapWith = index + dir;
      if (swapWith < 0 || swapWith >= next.length) return prev;
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return next.map((item, i) => ({ ...item, sort_order: i + 1 }));
    });
  };

  const toggleLayoutLocation = (navKey) => {
    setNavLayout(prev => prev.map(item => item.nav_key === navKey
      ? { ...item, location: item.location === 'settings' ? 'sidebar' : 'settings' }
      : item));
  };

  const saveNavLayout = async () => {
    setSavingLayout(true);
    try {
      await api.put('/nav-layout', { items: navLayout.map(({ nav_key, location, sort_order }) => ({ nav_key, location, sort_order })) });
    } catch (e) { alert('❌ ' + e.message); }
    setSavingLayout(false);
  };

  const hiddenItems = navLayout.filter(i => i.location === 'settings');

  return (
    <div className="space-y-6 animate-fadeIn max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>🧭 ترتيب القائمة الجانبية</h1>
        <button onClick={saveNavLayout} disabled={savingLayout || layoutLoading}
          className="flex items-center gap-2 px-5 py-2 rounded-xl font-semibold"
          style={{ background: 'var(--accent)', color: '#1A1A2E' }}>
          <Save className="w-4 h-4" />
          {savingLayout ? 'جاري...' : 'حفظ الترتيب'}
        </button>
      </div>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        رتّب عناصر القائمة الجانبية بالأسهم، وحدد لكل عنصر إن كان يظهر في القائمة الجانبية أو يبقى داخل الإعدادات فقط (يظهر وقتها كرابط سريع بجانب هذه القائمة). هذا الترتيب عام لكل المستخدمين — لا علاقة له بمن يملك صلاحية رؤية كل عنصر (يُضبط من تبويب "الصلاحيات").
      </p>

      {layoutLoading ? (
        <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-5 items-start">
          {/* Reorder list */}
          <div className="space-y-2">
            {navLayout.map((item, index) => (
              <div key={item.nav_key} className="flex items-center gap-3 p-3 rounded-xl border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => moveLayoutItem(index, -1)} disabled={index === 0}
                    className="p-0.5 hover:opacity-70 disabled:opacity-20" style={{ color: 'var(--text-muted)' }}>▲</button>
                  <button onClick={() => moveLayoutItem(index, 1)} disabled={index === navLayout.length - 1}
                    className="p-0.5 hover:opacity-70 disabled:opacity-20" style={{ color: 'var(--text-muted)' }}>▼</button>
                </div>
                <ArrowUpDown className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                <span className="flex-1 font-medium" style={{ color: 'var(--text-primary)' }}>{layoutLabel(item.nav_key)}</span>
                <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
                  <button onClick={() => item.location !== 'sidebar' && toggleLayoutLocation(item.nav_key)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{ background: item.location === 'sidebar' ? 'var(--accent)' : 'transparent', color: item.location === 'sidebar' ? '#1A1A2E' : 'var(--text-muted)' }}>
                    القائمة الجانبية
                  </button>
                  <button onClick={() => item.location !== 'settings' && toggleLayoutLocation(item.nav_key)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{ background: item.location === 'settings' ? 'var(--accent)' : 'transparent', color: item.location === 'settings' ? '#1A1A2E' : 'var(--text-muted)' }}>
                    الإعدادات فقط
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Quick links — pinned beside the reorder list, for items set to
              "الإعدادات فقط" so they stay reachable once removed from the sidebar. */}
          <div className="backdrop-blur-xl border rounded-2xl p-5 lg:sticky lg:top-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
            <h2 className="font-semibold mb-3" style={{ color: 'var(--accent)' }}>روابط سريعة</h2>
            {hiddenItems.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>لا توجد عناصر مخفية من القائمة الجانبية حاليًا.</p>
            ) : (
              <div className="space-y-2">
                {hiddenItems.map(i => {
                  const catalog = NAV_CATALOG.find(n => n.key === i.nav_key);
                  if (!catalog) return null;
                  return (
                    <Link key={i.nav_key} to={catalog.path}
                      className="flex items-center gap-2 p-3 rounded-xl transition-colors" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                      onMouseOver={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                      onMouseOut={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}>
                      <catalog.icon className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
                      <span className="text-sm flex-1">{catalog.label}</span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
