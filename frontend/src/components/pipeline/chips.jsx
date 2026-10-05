// Small presentational chips shared by the list page and the overview board.

export function LabelChip({ label, size = 'md', active = false, onClick, count }) {
  const small = size === 'sm';
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full font-semibold border transition-all ${small ? 'px-1.5 py-0 text-[10px]' : 'px-2.5 py-1 text-xs'} ${onClick ? 'cursor-pointer hover:brightness-110' : ''}`}
      style={{
        background: active ? label.color : label.color + '22',
        color: active ? '#fff' : label.color,
        borderColor: label.color + (active ? 'ff' : '55'),
      }}
      title={label.name}
    >
      {!small && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: active ? '#fff' : label.color }} />}
      <span className={small ? 'max-w-[80px] truncate' : ''}>{label.name}</span>
      {count !== undefined && <span className="opacity-70 font-bold">{count}</span>}
    </Tag>
  );
}

export function MilestonePill({ milestone, size = 'md', active = false, onClick, count }) {
  const small = size === 'sm';
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md font-semibold border transition-all ${small ? 'px-1.5 py-0 text-[10px]' : 'px-2.5 py-1 text-xs'} ${onClick ? 'cursor-pointer hover:brightness-110' : ''}`}
      style={{
        background: active ? milestone.color : milestone.color + '18',
        color: active ? '#fff' : milestone.color,
        borderColor: milestone.color + (active ? 'ff' : '55'),
      }}
      title={`Milestone: ${milestone.name}`}
    >
      <span aria-hidden>🚩</span>
      <span className={small ? 'max-w-[90px] truncate' : ''}>{milestone.name}</span>
      {count !== undefined && <span className="opacity-70 font-bold">{count}</span>}
    </Tag>
  );
}
