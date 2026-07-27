export default function Input({ label, error, icon: Icon, className = '', containerClassName = '', ...rest }) {
  return (
    <div className={containerClassName}>
      {label && <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>{label}</label>}
      <div className="relative">
        {Icon && <Icon className="w-4 h-4 absolute top-1/2 -translate-y-1/2 right-3.5 pointer-events-none" style={{ color: 'var(--text-muted)' }} />}
        <input
          className={`w-full py-2.5 rounded-xl border text-sm transition-all outline-none
            ${Icon ? 'pr-10 pl-3.5' : 'px-3.5'} ${className}`}
          style={{
            background: 'var(--bg-tertiary)',
            borderColor: error ? 'var(--danger)' : 'var(--border-strong)',
            color: 'var(--text-primary)',
          }}
          {...rest}
        />
      </div>
      {error && <p className="text-xs mt-1.5" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}
