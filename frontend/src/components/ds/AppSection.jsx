export default function AppSection({ title, actions, children, padding='true', className='' }) {
  return (
    <div className={`rounded-xl border ${className}`}
      style={{
        background: 'var(--ds-bg-secondary)', borderColor: 'var(--ds-border)',
        padding: padding ? '20px' : '0',
        boxShadow: 'var(--ds-shadow-sm)',
      }}>
      {(title || actions) && (
        <div className="flex items-center justify-between mb-4">
          {title && <h3 className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>{title}</h3>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
