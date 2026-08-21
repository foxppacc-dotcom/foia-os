// Small custom mascot icon for the AI assistant widget -- a modern
// robot-fox face (no stock lucide icon fits). The ears/head/antenna use
// `currentColor` (inherits whatever color the parent button sets, same as
// any lucide icon) -- but the visor and eyes are FIXED colors (not
// currentColor), always a light plate with dark eye-dots, regardless of
// context. That's deliberate: when currentColor is itself white (e.g. the
// floating bubble's white-on-accent icon), eyes drawn in currentColor would
// vanish against the light visor -- fixed colors guarantee the "face" always
// reads clearly no matter what color surrounds the icon.
export default function FoxBotIcon({ className = 'w-5 h-5', style }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Ears -- pointed fox silhouette with a lighter inner-ear notch */}
      <path d="M6 4L11.5 13.5H4.5L6 4Z" fill="currentColor" />
      <path d="M26 4L20.5 13.5H27.5L26 4Z" fill="currentColor" />
      <path d="M6.6 8L9.3 12.7H5.7L6.6 8Z" fill="currentColor" fillOpacity="0.35" />
      <path d="M25.4 8L22.7 12.7H26.3L25.4 8Z" fill="currentColor" fillOpacity="0.35" />

      {/* Head -- rounded-square robot plate */}
      <rect x="4" y="10" width="24" height="18" rx="7" fill="currentColor" />

      {/* Visor / face plate -- fixed light tone, never currentColor */}
      <rect x="7.5" y="14.5" width="17" height="11.5" rx="4.5" fill="#F4F4F5" />

      {/* Robot eyes -- fixed dark tone, always contrasts with the visor above */}
      <rect x="10.4" y="18" width="3.6" height="3.6" rx="1" fill="#27272A" />
      <rect x="18" y="18" width="3.6" height="3.6" rx="1" fill="#27272A" />

      {/* Fox muzzle -- small tapered mark inside the visor, same fixed dark tone */}
      <path d="M14 22.8C14 22.8 14.7 24.2 16 24.2C17.3 24.2 18 22.8 18 22.8"
        stroke="#27272A" strokeWidth="1.3" strokeLinecap="round" />

      {/* Small antenna -- reads as robot */}
      <line x1="16" y1="10" x2="16" y2="6.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="16" cy="6" r="1.4" fill="currentColor" />
    </svg>
  );
}
