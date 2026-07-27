export default function AppDivider({ label, className='' }) {
  if (label) {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <div className="flex-1" style={{ height: '1px', background: 'var(--ds-border)' }} />
        <span className="text-xs font-medium shrink-0" style={{ color: 'var(--ds-text-muted)' }}>{label}</span>
        <div className="flex-1" style={{ height: '1px', background: 'var(--ds-border)' }} />
      </div>
    );
  }
  return <div className={className} style={{ height: '1px', background: 'var(--ds-border)' }} />;
}
