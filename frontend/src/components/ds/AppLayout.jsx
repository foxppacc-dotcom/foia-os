import { useState, useEffect } from 'react';

const STORAGE_KEY = 'foia_sidebar_collapsed';
const DENSITY_KEY = 'foia_density';
const EXPANDED_WIDTH = 220;
const COLLAPSED_WIDTH = 60;

const DENSITY_PADDING = {
  compact: { main: 'p-4', gap: 'gap-3', card: 'p-3' },
  comfortable: { main: 'p-6', gap: 'gap-5', card: 'p-5' },
};

export default function AppLayout({ sidebar, topbar, children }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true'; }
    catch { return false; }
  });
  const [density, setDensity] = useState(() => {
    try { return localStorage.getItem(DENSITY_KEY) || 'compact'; }
    catch { return 'compact'; }
  });

  useEffect(() => {
    const handler = () => {
      try {
        setCollapsed(localStorage.getItem(STORAGE_KEY) === 'true');
        setDensity(localStorage.getItem(DENSITY_KEY) || 'compact');
      } catch {}
    };
    window.addEventListener('storage', handler);
    const interval = setInterval(handler, 1000);
    return () => { window.removeEventListener('storage', handler); clearInterval(interval); };
  }, []);

  const marginRight = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;
  const padding = DENSITY_PADDING[density] || DENSITY_PADDING.compact;

  return (
    <div className="flex h-screen" style={{ background: 'var(--ds-bg-primary)' }}>
      {sidebar}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ marginRight: `${marginRight}px`, transition: 'margin-right 0.2s ease' }}>
        {topbar}
        <main className={`flex-1 overflow-y-auto ${padding.main}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
