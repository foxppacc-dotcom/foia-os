import { forwardRef } from 'react';

const VARIANT_STYLES = {
  primary: { bg: 'var(--ds-accent)', color: 'var(--ds-text-inverse)', hover: 'var(--ds-accent-hover)' },
  secondary: { bg: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-primary)', hover: 'var(--ds-bg-elevated)' },
  ghost: { bg: 'transparent', color: 'var(--ds-text-secondary)', hover: 'transparent' },
  danger: { bg: 'var(--ds-danger)', color: '#fff', hover: '#DC2626' },
  success: { bg: 'var(--ds-success)', color: '#fff', hover: '#059669' },
};

const SIZE_STYLES = {
  sm: { padding: '6px 12px', fontSize: 'var(--ds-text-xs)', height: '28px' },
  md: { padding: '8px 18px', fontSize: 'var(--ds-text-sm)', height: '36px' },
  lg: { padding: '10px 24px', fontSize: 'var(--ds-text-sm)', height: '44px' },
};

const AppButton = forwardRef(({ variant='primary', size='md', icon, children, loading, fullWidth, style, ...props }, ref) => {
  const v = VARIANT_STYLES[variant] || VARIANT_STYLES.primary;
  const s = SIZE_STYLES[size] || SIZE_STYLES.md;
  return (
    <button ref={ref} disabled={loading || props.disabled}
      className="ds-transition-colors ds-focus-ring rounded-lg font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        background: v.bg, color: v.color, padding: s.padding, fontSize: s.fontSize, height: s.height,
        width: fullWidth ? '100%' : undefined,
        ...style,
      }}
      onMouseEnter={e => { if (!props.disabled && !loading) e.currentTarget.style.background = v.hover; }}
      onMouseLeave={e => { if (!props.disabled && !loading) e.currentTarget.style.background = v.bg; }}
      {...props}
    >
      {loading && <span className="ds-animate-spin w-3.5 h-3.5 border-2 border-current rounded-full border-t-transparent" />}
      {icon && <span className="w-4 h-4 flex items-center">{icon}</span>}
      {children}
    </button>
  );
});
AppButton.displayName = 'AppButton';
export default AppButton;
