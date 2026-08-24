import { useEffect, useRef, useState } from 'react';
import { Apple, Smartphone, Monitor, Download, X } from 'lucide-react';
import AppDialog from './ds/AppDialog';
import { getDeferredInstallPrompt, clearDeferredInstallPrompt, onInstallPromptChange, isStandalone } from '../lib/pwaInstall';

// iOS Safari has no beforeinstallprompt (Apple never implemented it) --
// "Add to Home Screen" there is only ever a manual, user-driven action via
// the Share sheet, so this platform always shows instructions rather than
// attempting a native prompt.
const STEPS = {
  iphone: {
    title: 'تحميل التطبيق على iPhone',
    lines: [
      'افتح الرابط في متصفح Safari (وليس أي متصفح آخر)',
      'اضغط على زر المشاركة (المربع مع السهم لأعلى) في شريط الأدوات',
      'مرر لأسفل واختر "إضافة إلى الشاشة الرئيسية" (Add to Home Screen)',
      'اضغط "إضافة" — هيظهر أيقونة التطبيق على شاشتك الرئيسية',
    ],
  },
  android: {
    title: 'تحميل التطبيق على Android',
    lines: [
      'اضغط على زر القائمة (⋮) أعلى يمين المتصفح',
      'اختر "تثبيت التطبيق" أو "إضافة إلى الشاشة الرئيسية"',
      'اضغط "تثبيت" — هيظهر أيقونة التطبيق على شاشتك الرئيسية',
    ],
  },
  computer: {
    title: 'تحميل التطبيق على الكمبيوتر',
    lines: [
      'من متصفح Chrome أو Edge، اضغط على أيقونة التثبيت ⤓ في شريط العنوان',
      'أو من قائمة المتصفح (⋮) اختر "تثبيت FOIA OS"',
      'اضغط "تثبيت" — هيفتح التطبيق في نافذة مستقلة وتقدر تثبته في قائمة ابدأ أو الـ Dock',
    ],
  },
};

function PlatformRow({ icon: Icon, label, onClick }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm ds-transition-colors"
      style={{ color: 'var(--ds-text-primary)' }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--ds-bg-tertiary)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <Icon className="w-4 h-4 shrink-0" style={{ color: 'var(--ds-accent)' }} />
      {label}
    </button>
  );
}

// Sits inline in the Forum page's header (stacked above the "موضوع جديد"
// button, per how this was asked for) -- NOT fixed/floating, so it scrolls
// away with the header exactly like every other header action, instead of
// staying pinned over the page content.
export default function InstallAppButton() {
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState(null);
  const [, forceTick] = useState(0);
  const ref = useRef(null);

  useEffect(() => onInstallPromptChange(() => forceTick(x => x + 1)), []);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  if (isStandalone()) return null; // already running as an installed app -- nothing to offer

  const tryNativeInstall = async (platform) => {
    const prompt = getDeferredInstallPrompt();
    if (!prompt) { setInstructions(platform); setOpen(false); return; }
    setOpen(false);
    try {
      prompt.prompt();
      await prompt.userChoice;
    } catch {
      setInstructions(platform);
    } finally {
      // Spent either way (accepted or dismissed) -- a second click must not
      // re-attempt .prompt() on this same dead event.
      clearDeferredInstallPrompt();
    }
  };

  const pick = (platform) => {
    if (platform === 'iphone') { setInstructions('iphone'); setOpen(false); return; }
    tryNativeInstall(platform);
  };

  return (
    <>
      <div ref={ref} className="relative">
        {open && (
          <div className="absolute top-full mt-2 left-0 z-20 rounded-xl border shadow-lg p-1.5 ds-animate-scaleIn"
            style={{ background: 'var(--ds-bg-secondary)', borderColor: 'var(--ds-border)', width: 220 }}>
            <p className="px-2.5 py-1.5 text-[11px] font-semibold" style={{ color: 'var(--ds-text-muted)' }}>تحميل التطبيق على...</p>
            <PlatformRow icon={Apple} label="iPhone" onClick={() => pick('iphone')} />
            <PlatformRow icon={Smartphone} label="Android" onClick={() => pick('android')} />
            <PlatformRow icon={Monitor} label="كمبيوتر" onClick={() => pick('computer')} />
          </div>
        )}
        <button onClick={() => setOpen(o => !o)}
          className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg"
          style={{ background: 'var(--ds-accent)', color: 'white', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}
          title="تحميل التطبيق">
          {open ? <X className="w-5 h-5" /> : <Download className="w-5 h-5" />}
        </button>
      </div>

      <AppDialog open={!!instructions} onClose={() => setInstructions(null)} title={instructions ? STEPS[instructions].title : ''} width="380px">
        {instructions && (
          <ol className="space-y-2.5 text-sm" style={{ color: 'var(--ds-text-secondary)' }}>
            {STEPS[instructions].lines.map((line, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold"
                  style={{ background: 'var(--ds-accent)', color: 'white' }}>{i + 1}</span>
                {line}
              </li>
            ))}
          </ol>
        )}
      </AppDialog>
    </>
  );
}
