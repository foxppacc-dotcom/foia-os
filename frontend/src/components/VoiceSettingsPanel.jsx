import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Settings2 } from 'lucide-react';

// Small popover for the two personal (per-browser, localStorage-backed --
// see useAIChat.js's own comment) voice-reply settings: playback speed and
// volume. Shared between the floating widget and the full-page chat instead
// of duplicating the same two sliders in both places.
//
// Rendered via a PORTAL straight into document.body, positioned from the
// trigger button's own screen coordinates -- the floating widget's outer
// panel has `overflow-hidden` (for its rounded corners), which was silently
// clipping/squeezing this popover when it was a plain absolutely-positioned
// child of that panel (confirmed live via a screenshot: labels came out cut
// off mid-word). A portal escapes that ancestor entirely, so it always
// renders in full regardless of where the trigger sits.
export default function VoiceSettingsPanel({ voiceRate, setVoiceRate, voiceVolume, setVoiceVolume }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.top, left: r.left });
    }
    setOpen(o => !o);
  };

  // Closes on scroll/resize instead of tracking the button's position live --
  // this is a short-lived popover for two sliders, not worth a continuous
  // reposition loop.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [open]);

  const PANEL_WIDTH = 220;

  return (
    <div className="relative">
      <button ref={btnRef} onClick={toggle} className="p-2 rounded-lg shrink-0" title="إعدادات الصوت"
        style={{ background: open ? 'var(--accent)' : 'var(--bg-tertiary)', color: open ? 'white' : 'var(--text-muted)' }}>
        <Settings2 className="w-3.5 h-3.5" />
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setOpen(false)} />
          <div dir="rtl" className="fixed p-3 rounded-xl shadow-lg space-y-3" style={{
            zIndex: 9999, background: 'var(--bg-secondary)', border: '1px solid var(--border)', width: `${PANEL_WIDTH}px`,
            top: Math.max(8, pos.top - 8), left: Math.min(window.innerWidth - PANEL_WIDTH - 8, Math.max(8, pos.left)),
            transform: 'translateY(-100%)',
          }}>
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                <span>سرعة الصوت</span><span style={{ color: 'var(--text-muted)' }}>{voiceRate.toFixed(1)}×</span>
              </div>
              <input type="range" min="0.5" max="2" step="0.1" value={voiceRate}
                onChange={e => setVoiceRate(parseFloat(e.target.value))} className="w-full" />
            </div>
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                <span>مستوى الصوت</span><span style={{ color: 'var(--text-muted)' }}>{Math.round(voiceVolume * 100)}%</span>
              </div>
              <input type="range" min="0" max="1" step="0.05" value={voiceVolume}
                onChange={e => setVoiceVolume(parseFloat(e.target.value))} className="w-full" />
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
