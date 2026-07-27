const VARIANTS = {
  accent: { bg: 'var(--ds-accent-subtle)', color: 'var(--ds-accent-text)' },
  success: { bg: 'var(--ds-success-subtle)', color: 'var(--ds-success-text)' },
  warning: { bg: 'var(--ds-warning-subtle)', color: 'var(--ds-warning-text)' },
  danger: { bg: 'var(--ds-danger-subtle)', color: 'var(--ds-danger-text)' },
  info: { bg: 'var(--ds-info-subtle)', color: 'var(--ds-info-text)' },
  neutral: { bg: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-secondary)' },
};

export default function AppBadge({ variant='neutral', children, className='', style }) {
  const v = VARIANTS[variant] || VARIANTS.neutral;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${className}`}
      style={{ background: v.bg, color: v.color, ...style }}>
      {children}
    </span>
  );
}
