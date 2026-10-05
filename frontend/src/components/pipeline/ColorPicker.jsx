// Color field for labels/milestones: preset swatches, native picker, hex input
// and a "generate" button that rolls a pleasant random color.

export const PRESET_COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#10B981',
  '#14B8A6', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899',
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = x => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`.toUpperCase();
}

export function randomColor() {
  return hslToHex(Math.floor(Math.random() * 360), 60 + Math.floor(Math.random() * 20), 48 + Math.floor(Math.random() * 10));
}

export default function ColorPicker({ value, onChange }) {
  const valid = HEX_RE.test(value);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESET_COLORS.map(c => (
          <button key={c} type="button" onClick={() => onChange(c)} title={c}
            className="w-5 h-5 rounded-full transition-transform hover:scale-110"
            style={{ background: c, outline: value?.toUpperCase() === c ? '2px solid var(--text-primary)' : 'none', outlineOffset: '2px' }} />
        ))}
      </div>
      <input type="color" value={valid ? value : '#6B7280'} onChange={e => onChange(e.target.value.toUpperCase())}
        className="w-7 h-7 rounded cursor-pointer border-0 p-0 bg-transparent" title="اختيار لون مخصص" />
      <input value={value} onChange={e => onChange(e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value)}
        maxLength={7} dir="ltr" spellCheck={false}
        className="w-20 px-2 py-1 rounded-lg border text-xs font-mono"
        style={{ background: 'var(--bg-tertiary)', borderColor: valid ? 'var(--border)' : '#EF4444', color: 'var(--text-primary)' }} />
      <button type="button" onClick={() => onChange(randomColor())}
        className="px-2 py-1 rounded-lg text-xs font-medium border"
        style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
        🎲 توليد لون
      </button>
    </div>
  );
}

export const isValidHex = (v) => HEX_RE.test(v);
