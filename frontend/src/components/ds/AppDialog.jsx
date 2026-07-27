import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function AppDialog({ open, onClose, title, children, width='480px' }) {
  const overlayRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', animation: 'ds-fadeIn 150ms ease-out' }}
      onClick={e => { if (e.target === overlayRef.current) onClose?.(); }}
    >
      <div className="rounded-xl border ds-animate-scaleIn" style={{ background: 'var(--ds-bg-secondary)', borderColor: 'var(--ds-border)', width, maxWidth: '100%', maxHeight: '85vh', overflow: 'auto' }}>
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--ds-border)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>{title}</h2>
          <button onClick={onClose} className="p-1 rounded-lg ds-transition-colors ds-focus-ring" style={{ color: 'var(--ds-text-muted)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--ds-text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--ds-text-muted)'}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
