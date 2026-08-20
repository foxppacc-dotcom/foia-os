// Small custom mascot icon for the AI assistant widget -- a minimalist
// robot face with fox-shaped (triangular) ears, since lucide-react has no
// stock icon for this. Uses currentColor so it inherits whatever color the
// parent button sets, same as any lucide icon would.
export default function FoxBotIcon({ className = 'w-5 h-5', style }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Ears */}
      <path d="M5 3.5L8.5 9.5H4L5 3.5Z" fill="currentColor" />
      <path d="M19 3.5L15.5 9.5H20L19 3.5Z" fill="currentColor" />
      {/* Head */}
      <rect x="4" y="8.5" width="16" height="12" rx="5" fill="currentColor" />
      {/* Eyes (cut-outs) */}
      <circle cx="9" cy="14.5" r="1.6" fill="var(--eye-bg, white)" />
      <circle cx="15" cy="14.5" r="1.6" fill="var(--eye-bg, white)" />
      <circle cx="9" cy="14.5" r="0.7" fill="currentColor" />
      <circle cx="15" cy="14.5" r="0.7" fill="currentColor" />
      {/* Snout/mouth */}
      <path d="M10.5 18C10.5 18 11 19 12 19C13 19 13.5 18 13.5 18" stroke="var(--eye-bg, white)" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
