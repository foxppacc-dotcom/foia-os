export default function PageHeader({ eyebrow, title, meta, actions }) {
  return (
    <div className="flex items-start justify-between flex-wrap gap-4">
      <div>
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--accent)' }}>{eyebrow}</p>}
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{title}</h1>
        {meta && <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{meta}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}
