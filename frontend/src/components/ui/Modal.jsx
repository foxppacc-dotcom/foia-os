import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, children, footer, maxWidth = 'max-w-sm' }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fadeIn"
      style={{ background: 'var(--bg-overlay)' }}
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidth} rounded-2xl border animate-scaleIn`}
        style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 pb-0">
          <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h4>
          <button onClick={onClose} className="p-1 rounded-lg transition-colors hover:brightness-125" style={{ color: 'var(--text-muted)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex gap-2 p-5 pt-0">{footer}</div>}
      </div>
    </div>
  );
}
