import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';

const ToastCtx = createContext();
const ICONS = { success: CheckCircle, error: AlertCircle, warning: AlertTriangle, info: Info };
const COLORS = { success: 'var(--ds-success)', error: 'var(--ds-danger)', warning: 'var(--ds-warning)', info: 'var(--ds-info)' };
const BG_COLORS = { success: 'var(--ds-success-subtle)', error: 'var(--ds-danger-subtle)', warning: 'var(--ds-warning-subtle)', info: 'var(--ds-info-subtle)' };

export function AppToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const show = useCallback((message, type='success', duration=3500) => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);
  const dismiss = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), []);
  return (
    <ToastCtx.Provider value={{ show, dismiss }}>
      {children}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2" style={{ pointerEvents: 'none' }}>
        {toasts.map(t => {
          const Icon = ICONS[t.type];
          return (
            <div key={t.id} className="flex items-center gap-2.5 px-4 py-3 rounded-xl border ds-animate-slideUp shadow-lg max-w-sm"
              style={{ background: BG_COLORS[t.type], borderColor: COLORS[t.type], pointerEvents: 'auto' }}>
              <Icon className="w-4 h-4 shrink-0" style={{ color: COLORS[t.type] }} />
              <span className="text-sm font-medium flex-1" style={{ color: 'var(--ds-text-primary)' }}>{t.message}</span>
              <button onClick={() => dismiss(t.id)} className="p-0.5 rounded opacity-60 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() { return useContext(ToastCtx); }
