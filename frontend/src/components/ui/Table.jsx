export function TableShell({ children }) {
  return (
    <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-sm)' }}>
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  );
}
export function Thead({ children }) {
  return <thead><tr style={{ background: 'var(--bg-tertiary)' }}>{children}</tr></thead>;
}
export function Th({ children, align = 'right', className = '' }) {
  return <th className={`px-4 py-3 text-${align} text-xs font-semibold uppercase tracking-wide ${className}`} style={{ color: 'var(--text-muted)' }}>{children}</th>;
}
export function Td({ children, align = 'right', className = '', onClick, style }) {
  return (
    <td onClick={onClick} className={`px-4 py-3.5 text-${align} ${className}`} style={{ color: 'var(--text-secondary)', ...style }}>
      {children}
    </td>
  );
}
export function Tr({ children, onClick, className = '' }) {
  return (
    <tr onClick={onClick} className={`transition-colors ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={{ borderTop: '1px solid var(--border)' }}
      onMouseOver={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
      onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
      {children}
    </tr>
  );
}
