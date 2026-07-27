export default function AppTable({ columns, data, onRowClick, emptyMessage='لا توجد بيانات', className='' }) {
  if (!data || data.length === 0) {
    return <div className="py-8 text-center text-sm" style={{ color: 'var(--ds-text-muted)' }}>{emptyMessage}</div>;
  }
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--ds-border)' }}>
            {columns.map(col => (
              <th key={col.key} className="text-right px-3 py-2.5 text-xs font-semibold whitespace-nowrap"
                style={{ color: 'var(--ds-text-muted)' }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={row.id || i} onClick={() => onRowClick?.(row)}
              className="ds-transition-colors cursor-pointer"
              style={{ borderBottom: '1px solid var(--ds-border)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--ds-bg-tertiary)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              {columns.map(col => (
                <td key={col.key} className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--ds-text-primary)' }}>
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
