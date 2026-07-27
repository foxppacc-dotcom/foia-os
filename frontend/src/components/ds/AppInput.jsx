export default function AppInput({ label, error, icon, suffix, className='', style, ...props }) {
  return (
    <div className={className}>
      {label && <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ds-text-secondary)' }}>{label}</label>}
      <div className="relative">
        {icon && <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none" style={{ color: 'var(--ds-text-muted)' }}>{icon}</div>}
        <input className="w-full rounded-lg border ds-focus-ring ds-transition-colors"
          style={{
            background: 'var(--ds-bg-secondary)', borderColor: error ? 'var(--ds-danger)' : 'var(--ds-border-strong)',
            color: 'var(--ds-text-primary)', padding: icon && suffix ? '8px 36px 8px 36px' : icon ? '8px 36px 8px 12px' : suffix ? '8px 12px 8px 36px' : '8px 12px',
            fontSize: 'var(--ds-text-sm)', minHeight: '36px',
            ...style,
          }}
          {...props}
        />
        {suffix && <div className="absolute inset-y-0 left-2 flex items-center">{suffix}</div>}
      </div>
      {error && <p className="text-xs mt-1" style={{ color: 'var(--ds-danger)' }}>{error}</p>}
    </div>
  );
}
