import { ChevronRight, ChevronLeft } from 'lucide-react';

export default function Pagination({ page, totalPages, onChange, totalItems, pageSize }) {
  if (totalPages <= 1) return null;
  const pages = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, start + 4);
  for (let p = start; p <= end; p++) pages.push(p);

  return (
    <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
      {totalItems != null && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          عرض {Math.min((page - 1) * pageSize + 1, totalItems)}–{Math.min(page * pageSize, totalItems)} من {totalItems}
        </p>
      )}
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page === 1}
          className="p-2 rounded-lg disabled:opacity-40 transition-colors" style={{ color: 'var(--text-secondary)' }}>
          <ChevronRight className="w-4 h-4" />
        </button>
        {pages.map(p => (
          <button key={p} onClick={() => onChange(p)}
            className="w-8 h-8 rounded-lg text-sm font-medium transition-colors"
            style={{ background: p === page ? 'var(--accent)' : 'transparent', color: p === page ? 'var(--text-inverse)' : 'var(--text-secondary)' }}>
            {p}
          </button>
        ))}
        <button onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page === totalPages}
          className="p-2 rounded-lg disabled:opacity-40 transition-colors" style={{ color: 'var(--text-secondary)' }}>
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
