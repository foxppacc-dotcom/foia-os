export default function AppSectionHeader({ title, subtitle, actions, className='' }) {
  return (
    <div className={`flex items-center justify-between mb-3 ${className}`}>
      <div>
        <h4 className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>{title}</h4>
        {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--ds-text-muted)' }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
