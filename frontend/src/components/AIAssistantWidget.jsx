import { useState, useEffect, useRef } from 'react';
import { Send, Paperclip, X, Mic, Minus, GripHorizontal } from 'lucide-react';
import FoxBotIcon from './icons/FoxBotIcon';
import { useAIChat } from '../hooks/useAIChat';
import { useActiveProviderStatus } from '../hooks/useActiveProviderStatus';
import { WIDGET_HIDDEN_KEY as HIDDEN_KEY, WIDGET_VISIBILITY_EVENT as AI_WIDGET_VISIBILITY_EVENT } from '../aiWidgetVisibility';

const POS_KEY = 'ai_widget_position';

const defaultPosition = () => ({ x: Math.max(16, window.innerWidth - 90), y: Math.max(16, window.innerHeight - 100) });

function loadPosition() {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return defaultPosition();
    const p = JSON.parse(raw);
    if (typeof p?.x === 'number' && typeof p?.y === 'number') return p;
  } catch {}
  return defaultPosition();
}

// Global, persistent across every route (mounted once in App.jsx's shell,
// a sibling of Sidebar/Topbar, never inside <Routes>) -- a bubble bought
// with a conversation still in flight when the user navigates away keeps
// the same component instance, so the reply always lands regardless of
// which page they're on by the time it arrives.
export default function AIAssistantWidget() {
  const [hidden, setHidden] = useState(() => localStorage.getItem(HIDDEN_KEY) === '1');
  const [collapsed, setCollapsed] = useState(true);
  const [position, setPosition] = useState(loadPosition);
  const [hasUnread, setHasUnread] = useState(false);
  const [listening, setListening] = useState(false);
  const listRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const dragState = useRef(null); // { startX, startY, origX, origY, moved }
  const collapsedRef = useRef(collapsed);
  useEffect(() => { collapsedRef.current = collapsed; }, [collapsed]);

  const { messages, input, setInput, file, setFile, sending, send } = useAIChat({
    // Reads a ref, not the `collapsed` state directly -- this callback is
    // captured once inside the hook's closure at whatever render created it,
    // a stale `collapsed` would wrongly skip the unread badge if the user
    // expanded the panel between sending and the reply landing.
    onReply: () => { if (collapsedRef.current) setHasUnread(true); },
  });
  const { hasActiveProvider, checkFailed: providerCheckFailed, recheck: checkActiveProvider } = useActiveProviderStatus();

  useEffect(() => {
    const onVisibility = () => setHidden(localStorage.getItem(HIDDEN_KEY) === '1');
    window.addEventListener(AI_WIDGET_VISIBILITY_EVENT, onVisibility);
    return () => window.removeEventListener(AI_WIDGET_VISIBILITY_EVENT, onVisibility);
  }, []);

  useEffect(() => { if (!collapsed) listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages, collapsed]);

  // The hook clears `file` state after sending, but the native <input
  // type="file"> element keeps its own .value -- without resetting it too,
  // re-picking the exact same file afterward fires no change event at all
  // (the browser considers the value unchanged), silently failing to attach it.
  useEffect(() => { if (!file && fileInputRef.current) fileInputRef.current.value = ''; }, [file]);

  // ---- Drag handling (bubble when collapsed, header when expanded) ----
  // pointercancel matters as much as pointerup: a touch-scroll takeover, an
  // alt-tab, or the pointer leaving the viewport mid-drag in some browsers
  // fires cancel instead of up -- without listening for it too, these two
  // window listeners never got removed and unrelated pointer movement
  // anywhere on the page kept silently repositioning the widget forever.
  const cleanupDragListeners = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  };
  const onPointerDown = (e) => {
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: position.x, origY: position.y, moved: false };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  };
  const onPointerMove = (e) => {
    const d = dragState.current;
    if (!d) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true;
    if (d.moved) setPosition({ x: Math.max(4, d.origX + dx), y: Math.max(4, d.origY + dy) });
  };
  const onPointerCancel = () => {
    cleanupDragListeners();
    dragState.current = null;
  };
  const onPointerUp = () => {
    cleanupDragListeners();
    const wasMoved = dragState.current?.moved;
    dragState.current = null;
    if (wasMoved) { localStorage.setItem(POS_KEY, JSON.stringify(position)); return; }
    // A click (no real movement) toggles the widget instead of dragging it.
    if (collapsed) { setCollapsed(false); setHasUnread(false); }
  };
  useEffect(() => { localStorage.setItem(POS_KEY, JSON.stringify(position)); }, [position]);
  // Also clean up if the component itself unmounts mid-drag (route swap
  // wouldn't do this since the widget is global, but defensive regardless).
  useEffect(() => () => cleanupDragListeners(), []);

  // ---- Voice input (Chrome/Edge only -- Web Speech API has no Firefox/Safari equivalent) ----
  const SpeechRecognitionCtor = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const toggleListening = () => {
    if (!SpeechRecognitionCtor) return;
    if (listening) { recognitionRef.current?.stop(); return; }
    const rec = new SpeechRecognitionCtor();
    rec.lang = 'ar-SA';
    rec.interimResults = false;
    rec.onresult = (e) => setInput(prev => (prev ? prev + ' ' : '') + e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };
  // Stop any in-progress recognition if the widget unmounts mid-listen --
  // otherwise the mic session (and its onresult callback, which closes over
  // this unmounted instance's setInput) keeps running invisibly.
  useEffect(() => () => recognitionRef.current?.stop(), []);

  if (hidden) return null;

  return (
    <div className="fixed z-50" style={{ left: position.x, top: position.y }}>
      {collapsed ? (
        <button onPointerDown={onPointerDown}
          className="relative w-14 h-14 rounded-full flex items-center justify-center shadow-lg cursor-grab active:cursor-grabbing"
          style={{ background: 'var(--accent)', color: 'white', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}
          title="المساعد الذكي">
          <FoxBotIcon className="w-7 h-7" />
          {hasUnread && (
            <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
              style={{ background: '#ef4444', color: 'white' }}>●</span>
          )}
        </button>
      ) : (
        <div className="w-80 rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', maxHeight: '70vh' }}>
          <div onPointerDown={onPointerDown} className="flex items-center justify-between gap-2 px-3 py-2.5 cursor-grab active:cursor-grabbing" style={{ background: 'var(--accent)', color: 'white' }}>
            <div className="flex items-center gap-2">
              <FoxBotIcon className="w-5 h-5" />
              <span className="text-sm font-semibold">المساعد الذكي</span>
            </div>
            <div className="flex items-center gap-1">
              <GripHorizontal className="w-3.5 h-3.5 opacity-60" />
              <button onClick={() => setCollapsed(true)} className="p-1 rounded hover:bg-white/10"><Minus className="w-4 h-4" /></button>
            </div>
          </div>

          {providerCheckFailed ? (
            <div className="p-4 text-xs" style={{ color: 'var(--text-muted)' }}>
              <p className="mb-2">⚠️ تعذر التحقق من حالة المساعد الذكي.</p>
              <button onClick={checkActiveProvider} className="underline" style={{ color: 'var(--accent)' }}>إعادة المحاولة</button>
            </div>
          ) : hasActiveProvider === false ? (
            <p className="text-xs p-4" style={{ color: 'var(--text-muted)' }}>
              لا يوجد مزود ذكاء اصطناعي مفعّل حاليًا. اطلب من المسؤول تفعيل واحد من صفحة "الربط الذكي".
            </p>
          ) : (
            <>
              <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-2.5" style={{ minHeight: '200px' }}>
                {messages.length === 0 ? (
                  <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>اسألني عن قضايا الاستقبال، تقارير الموظفين، الإيميلات غير المرتبطة، أو اطلب مني فتح وتصفية القضايا...</p>
                ) : messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                    <div className="max-w-[85%] px-3 py-2 rounded-lg text-xs whitespace-pre-wrap" style={{
                      background: m.role === 'user' ? 'var(--accent)' : 'var(--bg-tertiary)',
                      color: m.role === 'user' ? 'white' : 'var(--text-primary)',
                    }}>{m.content}</div>
                  </div>
                ))}
                {sending && <div className="flex justify-end"><div className="px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>...جارٍ التفكير</div></div>}
              </div>

              {file && (
                <div className="flex items-center justify-between gap-2 mx-2.5 mb-1.5 px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'var(--bg-tertiary)' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>📎 {file.name}</span>
                  <button onClick={() => setFile(null)}><X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /></button>
                </div>
              )}

              <div className="flex items-center gap-1.5 p-2.5 pt-0">
                <input ref={fileInputRef} type="file" hidden onChange={e => setFile(e.target.files?.[0] || null)} />
                <button onClick={() => fileInputRef.current?.click()} disabled={sending} className="p-2 rounded-lg shrink-0" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }} title="إرفاق ملف">
                  <Paperclip className="w-3.5 h-3.5" />
                </button>
                {SpeechRecognitionCtor && (
                  <button onClick={toggleListening} disabled={sending} className="p-2 rounded-lg shrink-0" title="إدخال صوتي"
                    style={{ background: listening ? '#ef4444' : 'var(--bg-tertiary)', color: listening ? 'white' : 'var(--text-muted)' }}>
                    <Mic className="w-3.5 h-3.5" />
                  </button>
                )}
                <input value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="اكتب سؤالك..." disabled={sending}
                  className="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-xs" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                <button onClick={send} disabled={sending || (!input.trim() && !file)} className="p-2 rounded-lg shrink-0 disabled:opacity-40" style={{ background: 'var(--accent)', color: 'white' }}>
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
