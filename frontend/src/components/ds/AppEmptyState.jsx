export default function AppEmptyState({ icon: Icon, title, description, action, compact }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8' : 'py-16'}`}
      style={{ color: 'var(--ds-text-muted)' }}>
      {Icon && <Icon className={`${compact ? 'w-8 h-8' : 'w-12 h-12'} mb-3 opacity-40`} />}
      <h3 className={`${compact ? 'text-sm' : 'text-base'} font-semibold mb-1`} style={{ color: 'var(--ds-text-secondary)' }}>{title}</h3>
      {description && <p className={`${compact ? 'text-xs' : 'text-sm'} max-w-xs`}>{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
