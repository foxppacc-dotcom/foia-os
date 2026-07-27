import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function AppPageHeader({ title, subtitle, backTo, actions, className='' }) {
  const nav = useNavigate();
  return (
    <div className={`flex items-center justify-between mb-6 ds-animate-fadeIn ${className}`}
      style={{ animationDuration: '200ms' }}>
      <div className="flex items-center gap-3">
        {backTo && (
          <button onClick={() => nav(backTo)}
            className="w-8 h-8 rounded-lg flex items-center justify-center ds-transition-colors ds-focus-ring"
            style={{ color: 'var(--ds-text-muted)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--ds-bg-tertiary)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            aria-label="رجوع">
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--ds-text-primary)', letterSpacing: '-0.02em' }}>{title}</h1>
          {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--ds-text-muted)' }}>{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
