const variants = {
  neutral: { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', dot: 'var(--text-muted)' },
  accent:  { background: 'var(--accent-subtle)', color: 'var(--accent)', dot: 'var(--accent)' },
  success: { background: 'var(--success-subtle)', color: 'var(--success)', dot: 'var(--success)' },
  warning: { background: 'var(--warning-subtle)', color: 'var(--warning)', dot: 'var(--warning)' },
  danger:  { background: 'var(--danger-subtle)', color: 'var(--danger)', dot: 'var(--danger)' },
  info:    { background: 'var(--info-subtle)', color: 'var(--info)', dot: 'var(--info)' },
};

export default function Badge({ variant = 'neutral', dot = false, className = '', children }) {
  const v = variants[variant] || variants.neutral;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${className}`}
      style={{ background: v.background, color: v.color }}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: v.dot }} />}
      {children}
    </span>
  );
}
