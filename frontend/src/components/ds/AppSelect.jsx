export default function AppSelect({ label, error, options, className='', placeholder, style, ...props }) {
  return (
    <div className={className}>
      {label && <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ds-text-secondary)' }}>{label}</label>}
      <select className="w-full rounded-lg border ds-focus-ring ds-transition-colors cursor-pointer"
        style={{
          background: 'var(--ds-bg-secondary)', borderColor: error ? 'var(--ds-danger)' : 'var(--ds-border-strong)',
          color: 'var(--ds-text-primary)', padding: '8px 12px', fontSize: 'var(--ds-text-sm)',
          minHeight: '36px',
          ...style,
        }}
        {...props}
      >
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options?.map(o => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>
      {error && <p className="text-xs mt-1" style={{ color: 'var(--ds-danger)' }}>{error}</p>}
    </div>
  );
}
