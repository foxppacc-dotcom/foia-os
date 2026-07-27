export default function Donut({ segments, size = 140, thickness = 16, centerLabel, centerValue }) {
  const total = segments.reduce((s, x) => s + (x.value || 0), 0);
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-tertiary)" strokeWidth={thickness} />
        {total > 0 && segments.map((seg, i) => {
          const frac = (seg.value || 0) / total;
          const dash = frac * circumference;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={seg.color} strokeWidth={thickness}
              strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset} strokeLinecap="butt"
              style={{ transition: 'stroke-dasharray 0.6s ease' }} />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{centerValue}</p>
        {centerLabel && <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{centerLabel}</p>}
      </div>
    </div>
  );
}
