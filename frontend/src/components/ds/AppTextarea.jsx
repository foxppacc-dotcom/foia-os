import { useRef, useCallback } from 'react';

export default function AppTextarea({ label, error, rows=3, className='', style, ...props }) {
  const ref = useRef(null);
  const autoGrow = useCallback(() => {
    const el = ref.current;
    if (el) { el.style.height = 'auto'; el.style.height = Math.max(el.scrollHeight, 40) + 'px'; }
  }, []);
  return (
    <div className={className}>
      {label && <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ds-text-secondary)' }}>{label}</label>}
      <textarea ref={ref} rows={rows}
        className="w-full rounded-lg border ds-focus-ring ds-transition-colors resize-none overflow-hidden"
        style={{
          background: 'var(--ds-bg-secondary)', borderColor: error ? 'var(--ds-danger)' : 'var(--ds-border-strong)',
          color: 'var(--ds-text-primary)', padding: '10px 12px', fontSize: 'var(--ds-text-sm)',
          lineHeight: '1.6', minHeight: '40px',
          ...style,
        }}
        onInput={autoGrow}
        {...props}
      />
      {error && <p className="text-xs mt-1" style={{ color: 'var(--ds-danger)' }}>{error}</p>}
    </div>
  );
}
