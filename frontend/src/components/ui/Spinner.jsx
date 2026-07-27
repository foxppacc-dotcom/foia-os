const sizes = { sm: 'w-4 h-4 border-2', md: 'w-8 h-8 border-2', lg: 'w-12 h-12 border-[3px]' };

export default function Spinner({ size = 'md', full = false, label }) {
  const el = (
    <div className="flex flex-col items-center gap-3">
      <div className={`${sizes[size]} rounded-full animate-spin`} style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
      {label && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>}
    </div>
  );
  if (!full) return el;
  return <div className="flex items-center justify-center h-64">{el}</div>;
}
