import { ChevronDown } from 'lucide-react';

export default function Select({ label, className = '', containerClassName = '', children, ...rest }) {
  return (
    <div className={containerClassName}>
      {label && <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>{label}</label>}
      <div className="relative">
        <select
          className={`w-full py-2.5 pr-3.5 pl-9 rounded-xl border text-sm appearance-none transition-all outline-none cursor-pointer ${className}`}
          style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown className="w-3.5 h-3.5 absolute top-1/2 -translate-y-1/2 left-3 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
      </div>
    </div>
  );
}
