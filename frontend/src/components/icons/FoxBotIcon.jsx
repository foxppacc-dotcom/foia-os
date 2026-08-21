// Small custom mascot icon for the AI assistant widget -- a modern
// robot-fox face (no stock lucide icon fits). Two-tone: `currentColor` for
// the body/ears (inherits whatever color the parent button sets, same as
// any lucide icon), a fixed light visor plate for the robot face so the
// eyes/muzzle read clearly at small sizes.
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

      {/* Visor / face plate */}
      <rect x="7.5" y="15" width="17" height="10" rx="4.5" fill="var(--visor-bg, white)" fillOpacity="0.94" />

      {/* Robot eyes on the visor */}
      <rect x="10.5" y="18.3" width="3.4" height="3.4" rx="1" fill="currentColor" />
      <rect x="18.1" y="18.3" width="3.4" height="3.4" rx="1" fill="currentColor" />

      {/* Fox muzzle -- small tapered snout below the visor */}
      <path d="M14 24.5C14 24.5 14.7 26 16 26C17.3 26 18 24.5 18 24.5"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />

      {/* Small antenna -- reads as robot */}
      <line x1="16" y1="10" x2="16" y2="6.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="16" cy="6" r="1.4" fill="currentColor" />
    </svg>
  );
}
