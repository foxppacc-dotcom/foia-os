export default function Card({ title, icon, iconColor = 'var(--accent)', actions, padding = 'p-5', className = '', children }) {
  return (
    <div
      className={`rounded-2xl border ${padding} ${className}`}
      style={{
        background: 'var(--bg-secondary)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--shadow-sm), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between mb-4 gap-3">
          {title && (
            <div className="flex items-center gap-2.5">
              {icon && (
                <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${iconColor}18` }}>
                  {icon}
                </div>
              )}
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
            </div>
          )}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
