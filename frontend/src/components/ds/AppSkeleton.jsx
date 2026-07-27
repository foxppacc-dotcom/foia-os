export default function AppSkeleton({ width='100%', height='16px', rounded='md', count=1, className='' }) {
  const r = { sm: '6px', md: '10px', lg: '14px', full: '9999px' }[rounded] || '10px';
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="ds-animate-pulse rounded-lg mb-2 last:mb-0"
          style={{ width, height, borderRadius: r, background: 'var(--ds-bg-elevated)' }} />
      ))}
    </div>
  );
}
