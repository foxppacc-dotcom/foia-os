export default function BarList({ items, height = 'h-2.5' }) {
  const max = Math.max(1, ...items.map(i => i.value || 0));
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{item.value}</span>
          </div>
          <div className={`w-full ${height} rounded-full overflow-hidden`} style={{ background: 'var(--bg-tertiary)' }}>
            <div className={`h-full rounded-full transition-all duration-700`} style={{ width: `${(item.value / max) * 100}%`, background: item.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}
