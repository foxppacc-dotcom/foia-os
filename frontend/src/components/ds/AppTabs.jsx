export default function AppTabs({ tabs, active, onChange, className='' }) {
  return (
    <div className={`flex gap-1 p-1 rounded-xl ${className}`} style={{ background: 'var(--ds-bg-tertiary)' }}>
      {tabs.map(t => {
        const isActive = t.id === active;
        return (
          <button key={t.id} onClick={() => onChange?.(t.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ds-transition-colors ds-focus-ring"
            style={{
              background: isActive ? 'var(--ds-bg-secondary)' : 'transparent',
              color: isActive ? 'var(--ds-text-primary)' : 'var(--ds-text-muted)',
              boxShadow: isActive ? 'var(--ds-shadow-sm)' : 'none',
            }}>
            {t.icon && <span className="w-3.5 h-3.5">{t.icon}</span>}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
