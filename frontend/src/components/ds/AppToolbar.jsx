import { Search } from 'lucide-react';

export default function AppToolbar({ searchValue, onSearchChange, searchPlaceholder='بحث...', filters, actions, className='' }) {
  return (
    <div className={`flex items-center gap-3 flex-wrap mb-4 ${className}`}>
      {onSearchChange && (
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--ds-text-muted)' }} />
          <input value={searchValue || ''} onChange={e => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border ds-focus-ring ds-transition-colors text-sm"
            style={{
              background: 'var(--ds-bg-secondary)', borderColor: 'var(--ds-border-strong)',
              color: 'var(--ds-text-primary)', padding: '8px 36px 8px 12px', minHeight: '36px',
            }}
            aria-label={searchPlaceholder}
          />
        </div>
      )}
      {filters && <div className="flex items-center gap-2 flex-wrap">{filters}</div>}
      {actions && <div className="flex items-center gap-2 mr-auto">{actions}</div>}
    </div>
  );
}
