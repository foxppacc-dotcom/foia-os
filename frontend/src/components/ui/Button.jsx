import { Loader2 } from 'lucide-react';

const variants = {
  primary:   { background: 'var(--accent)', color: 'var(--text-inverse)' },
  secondary: { background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' },
  ghost:     { background: 'transparent', color: 'var(--text-secondary)' },
  danger:    { background: 'var(--danger-subtle)', color: 'var(--danger)' },
};

const sizes = {
  sm: 'px-3 py-1.5 text-xs gap-1.5 rounded-lg',
  md: 'px-4 py-2.5 text-sm gap-2 rounded-xl',
  lg: 'px-5 py-3 text-sm gap-2 rounded-xl',
};

export default function Button({
  variant = 'primary', size = 'md', icon: Icon, loading = false,
  disabled, className = '', children, ...rest
}) {
  const style = variants[variant] || variants.primary;
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-semibold transition-all duration-150
        active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
        hover:brightness-110 ${sizes[size]} ${className}`}
      style={style}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : Icon ? <Icon className="w-4 h-4" /> : null}
      {children}
    </button>
  );
}
