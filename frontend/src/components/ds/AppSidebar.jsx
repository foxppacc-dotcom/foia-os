export default function AppSidebar({ items, activePath, onNavigate, user, className='' }) {
  return (
    <aside className={`fixed right-0 top-0 bottom-0 w-64 flex flex-col border-l z-40 ${className}`}
      style={{ background: 'var(--ds-bg-secondary)', borderColor: 'var(--ds-border)' }}>
      <div className="p-4 border-b" style={{ borderColor: 'var(--ds-border)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
            style={{ background: 'var(--ds-accent)', color: 'var(--ds-text-inverse)' }}>F</div>
          <span className="text-sm font-bold" style={{ color: 'var(--ds-text-primary)' }}>FOIA OS</span>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {items?.map(item => {
          const active = item.path === activePath;
          return (
            <button key={item.path} onClick={() => onNavigate?.(item.path)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium ds-transition-colors ds-focus-ring"
              style={{
                background: active ? 'var(--ds-accent-subtle)' : 'transparent',
                color: active ? 'var(--ds-accent-text)' : 'var(--ds-text-secondary)',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--ds-bg-tertiary)'; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              aria-current={active ? 'page' : undefined}>
              {item.icon && <span className="w-4 h-4 shrink-0">{item.icon}</span>}
              {item.label}
            </button>
          );
        })}
      </nav>
      {user && (
        <div className="p-3 border-t" style={{ borderColor: 'var(--ds-border)' }}>
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{ background: 'var(--ds-bg-elevated)', color: 'var(--ds-text-muted)' }}>{user.name?.[0]}</div>
            <div className="min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: 'var(--ds-text-primary)' }}>{user.name}</p>
              <p className="text-[10px] truncate" style={{ color: 'var(--ds-text-muted)' }}>{user.role}</p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
