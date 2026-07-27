export default function AppCard({ title, actions, children, padding='md', hover, style, className='' }) {
  const paddingMap = { sm: 'p-3', md: 'p-4', lg: 'p-5', xl: 'p-6' };
  return (
    <div className={`rounded-xl border ${hover ? 'ds-hover-lift cursor-pointer' : ''} ${className}`}
      style={{
        background: 'var(--ds-bg-secondary)', borderColor: 'var(--ds-border)',
        padding: paddingMap[padding] || paddingMap.md,
        boxShadow: 'var(--ds-shadow-sm)',
        ...style,
      }}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between mb-3">
          {title && <h3 className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>{title}</h3>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
