export default function IconChip({ icon: Icon, color = 'var(--accent)', size = 'md' }) {
  const dims = size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-11 h-11' : 'w-8 h-8';
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : size === 'lg' ? 'w-5 h-5' : 'w-4 h-4';
  return (
    <div className={`${dims} rounded-xl flex items-center justify-center shrink-0`} style={{ background: `${color}18` }}>
      <Icon className={iconSize} style={{ color }} />
    </div>
  );
}
