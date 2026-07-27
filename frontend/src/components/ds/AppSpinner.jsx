export default function AppSpinner({ size='md', full, label }) {
  const s = { sm: 16, md: 24, lg: 36 }[size] || 24;
  if (full) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="ds-animate-spin rounded-full border-2 border-current border-t-transparent" style={{ width: s, height: s, color: 'var(--ds-accent)' }} />
          {label && <span className="text-sm" style={{ color: 'var(--ds-text-muted)' }}>{label}</span>}
        </div>
      </div>
    );
  }
  return <div className="ds-animate-spin rounded-full border-2 border-current border-t-transparent" style={{ width: s, height: s, color: 'var(--ds-accent)' }} />;
}
