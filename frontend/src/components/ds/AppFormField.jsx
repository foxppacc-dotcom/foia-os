export default function AppFormField({ label, required, error, helper, children, className='' }) {
  return (
    <div className={className}>
      {label && (
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ds-text-secondary)' }}>
          {label}
          {required && <span style={{ color: 'var(--ds-danger)' }}> *</span>}
        </label>
      )}
      {children}
      {error && <p className="text-xs mt-1" style={{ color: 'var(--ds-danger)' }}>{error}</p>}
      {helper && !error && <p className="text-xs mt-1" style={{ color: 'var(--ds-text-muted)' }}>{helper}</p>}
    </div>
  );
}
