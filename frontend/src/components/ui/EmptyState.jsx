export default function EmptyState({ icon: Icon, title, description, action, compact = false }) {
  return (
    <div className={`flex flex-col items-center text-center ${compact ? 'py-6' : 'py-12'}`}>
      {Icon && (
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-3" style={{ background: 'var(--bg-tertiary)' }}>
          <Icon className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
        </div>
      )}
      {title && <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{title}</p>}
      {description && <p className="text-xs mt-1 max-w-xs" style={{ color: 'var(--text-muted)' }}>{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
