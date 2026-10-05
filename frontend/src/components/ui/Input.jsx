import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export default function Input({ label, error, icon: Icon, className = '', containerClassName = '', ...rest }) {
  // Every password field gets the eye button that shows/hides what was typed.
  const isPassword = rest.type === 'password';
  const [show, setShow] = useState(false);
  return (
    <div className={containerClassName}>
      {label && <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>{label}</label>}
      <div className="relative">
        {Icon && <Icon className="w-4 h-4 absolute top-1/2 -translate-y-1/2 right-3.5 pointer-events-none" style={{ color: 'var(--text-muted)' }} />}
        <input
          className={`w-full py-2.5 rounded-xl border text-sm transition-all outline-none
            ${Icon ? 'pr-10' : 'pr-3.5'} ${isPassword ? 'pl-10' : 'pl-3.5'} ${className}`}
          style={{
            background: 'var(--bg-tertiary)',
            borderColor: error ? 'var(--danger)' : 'var(--border-strong)',
            color: 'var(--text-primary)',
          }}
          {...rest}
          type={isPassword && show ? 'text' : rest.type}
        />
        {isPassword && (
          <button type="button" onClick={() => setShow(s => !s)} tabIndex={-1}
            aria-label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} title={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
            className="absolute top-1/2 -translate-y-1/2 left-3 p-1 rounded" style={{ color: 'var(--text-muted)' }}>
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {error && <p className="text-xs mt-1.5" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}
