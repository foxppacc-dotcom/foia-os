export default function Tabs({ tabs, active, onChange }) {
  return (
    <div className="inline-flex gap-1 p-1 rounded-2xl overflow-x-auto max-w-full" style={{ background: 'var(--bg-tertiary)' }}>
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className="px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-200"
          style={{
            background: active === t.key ? 'var(--bg-secondary)' : 'transparent',
            color: active === t.key ? 'var(--accent)' : 'var(--text-muted)',
            boxShadow: active === t.key ? 'var(--shadow-sm)' : 'none',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
