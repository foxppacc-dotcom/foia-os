import { useState, useEffect, useRef } from 'react';
import { Send, Paperclip, X, Mic, Minus, GripHorizontal, MessageSquarePlus, Volume2, VolumeX, Square } from 'lucide-react';
import FoxBotIcon from './icons/FoxBotIcon';
import VoiceSettingsPanel from './VoiceSettingsPanel';
import { useAIChat } from '../hooks/useAIChat';
import { useActiveProviderStatus } from '../hooks/useActiveProviderStatus';
import { WIDGET_HIDDEN_KEY as HIDDEN_KEY, WIDGET_VISIBILITY_EVENT as AI_WIDGET_VISIBILITY_EVENT } from '../aiWidgetVisibility';
import { isSameDay, dayDividerLabel, formatArabicTime, formatArabicDateTime } from '../utils/formatDate';

const POS_KEY = 'ai_widget_position';

const defaultPosition = () => ({ x: Math.max(16, window.innerWidth - 90), y: Math.max(16, window.innerHeight - 100) });

// The bubble is draggable to anywhere on screen (position persisted in
// POS_KEY) -- the panel used to always open growing right+down from the
// bubble's own top-left corner, which is exactly backwards when the bubble
// sits near the right or bottom edge (its usual default spot): the panel
// would render partly or fully off-screen. This picks, from the bubble's
// CURRENT position, whichever side actually has room, so "opens toward
// empty space" holds no matter where the bubble has been dragged.
const BUBBLE_SIZE = 56; // w-14/h-14
const PANEL_WIDTH = 320; // w-80
const PANEL_MAX_HEIGHT_RATIO = 0.7; // matches the panel's own maxHeight: 70vh
const EDGE_MARGIN = 12;

function computePanelLayout(pos) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const spaceRight = vw - (pos.x + BUBBLE_SIZE);
  const spaceLeft = pos.x;
  const horizontal = spaceRight >= PANEL_WIDTH || spaceRight >= spaceLeft ? 'right' : 'left';

  const desiredHeight = vh * PANEL_MAX_HEIGHT_RATIO;
  const spaceBelow = vh - (pos.y + BUBBLE_SIZE);
  const spaceAbove = pos.y;
  const vertical = spaceBelow >= desiredHeight || spaceBelow >= spaceAbove ? 'down' : 'up';

  const width = Math.min(PANEL_WIDTH, vw - EDGE_MARGIN * 2);
  const maxHeightSpace = (vertical === 'down' ? spaceBelow : spaceAbove) - EDGE_MARGIN;
  // A floor keeps the panel usable on a very short viewport where neither
  // side has much room, but it must never be raised past what the FULL
  // viewport can hold -- otherwise the floor itself would push the panel
  // off-screen instead of just looking a little cramped.
  const maxHeight = Math.min(Math.max(140, Math.min(desiredHeight, maxHeightSpace)), vh - EDGE_MARGIN * 2);

  return { horizontal, vertical, width, maxHeight };
}

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
  const [layout, setLayout] = useState(() => computePanelLayout(loadPosition()));
  const [hasUnread, setHasUnread] = useState(false);
  const listRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragState = useRef(null); // { startX, startY, origX, origY, moved }
  const collapsedRef = useRef(collapsed);
  useEffect(() => { collapsedRef.current = collapsed; }, [collapsed]);

  const {
    messages, input, setInput, file, setFile, sending, send, stopGenerating, newConversation, resolveDraft,
    voiceMode, toggleVoiceMode, listening, toggleListening, canListen,
    voiceRate, setVoiceRate, voiceVolume, setVoiceVolume,
  } = useAIChat({
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
    if (wasMoved) { try { localStorage.setItem(POS_KEY, JSON.stringify(position)); } catch {} return; }
    // A click (no real movement) toggles the widget instead of dragging it.
    if (collapsed) { setCollapsed(false); setHasUnread(false); }
  };
  // Recomputes on every position change while expanded -- not just the
  // moment it opens. The panel's own header IS the drag handle when
  // expanded (onPointerDown below), so dragging an already-open panel
  // keeps calling setPosition just like dragging the collapsed bubble does;
  // without reacting to that too, the panel would keep anchoring against
  // wherever it happened to be when it was first opened, running off-screen
  // if the user then drags it toward the opposite edge. Also covers a
  // window resize (rotating a tablet, resizing a desktop window) via the
  // separate listener below, since viewport size isn't React state.
  useEffect(() => {
    if (collapsed) return;
    setLayout(computePanelLayout(position));
  }, [collapsed, position]);
  useEffect(() => {
    if (collapsed) return;
    const onResize = () => setLayout(computePanelLayout(position));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [collapsed, position]);
  // Global widget, mounted for the entire session -- an unguarded setItem
  // throwing here (storage disabled/private mode/quota exceeded) would
  // crash on every position change, including every pointermove tick of an
  // active drag, not just once.
  useEffect(() => { try { localStorage.setItem(POS_KEY, JSON.stringify(position)); } catch {} }, [position]);
  // Also clean up if the component itself unmounts mid-drag (route swap
  // wouldn't do this since the widget is global, but defensive regardless).
  useEffect(() => () => cleanupDragListeners(), []);

  if (hidden) return null;

  return (
    <div className="fixed z-50" style={{ left: position.x, top: position.y, width: BUBBLE_SIZE, height: BUBBLE_SIZE }}>
      {collapsed ? (
        <button onPointerDown={onPointerDown}
          className="relative w-14 h-14 rounded-full flex items-center justify-center shadow-lg cursor-grab active:cursor-grabbing"
          // Without this, a touch-drag competes with the browser's own
          // scroll/pan gesture on the same touch -- mouse has no such
          // conflict, which is exactly why this only misbehaved on phone.
          style={{ background: 'var(--accent)', color: 'white', boxShadow: '0 4px 16px rgba(0,0,0,0.25)', touchAction: 'none' }}
          title="المساعد الذكي">
          <FoxBotIcon className="w-7 h-7" />
          {hasUnread && (
            <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
              style={{ background: '#ef4444', color: 'white' }}>●</span>
          )}
        </button>
      ) : (
        // Anchored against whichever corner of the 56x56 reference box
        // (set on the wrapper above) actually has room -- growing from the
        // bubble's top-left unconditionally is what used to push the panel
        // off-screen whenever the bubble had been dragged near an edge.
        <div className="absolute rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          width: layout.width, maxHeight: layout.maxHeight,
          [layout.horizontal === 'right' ? 'left' : 'right']: 0,
          [layout.vertical === 'down' ? 'top' : 'bottom']: 0,
        }}>
          <div onPointerDown={onPointerDown} className="flex items-center justify-between gap-2 px-3 py-2.5 cursor-grab active:cursor-grabbing" style={{ background: 'var(--accent)', color: 'white', touchAction: 'none' }}>
            <div className="flex items-center gap-2">
              <FoxBotIcon className="w-5 h-5" />
              <span className="text-sm font-semibold">المساعد الذكي</span>
            </div>
            <div className="flex items-center gap-1">
              <GripHorizontal className="w-3.5 h-3.5 opacity-60" />
              <button onClick={newConversation} title="محادثة جديدة" className="p-1 rounded hover:bg-white/10"><MessageSquarePlus className="w-4 h-4" /></button>
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
                ) : messages.map((m, i) => {
                  // A date divider whenever the day changes from the previous
                  // message (or before the very first one) -- same convention
                  // any normal chat app uses, and the same shared helper the
                  // internal team-messaging page and the full-page chat use,
                  // so "اليوم"/"أمس" mean the same thing everywhere.
                  const showDivider = m.created_at && (i === 0 || !isSameDay(messages[i - 1]?.created_at, m.created_at));
                  return (
                    <div key={i}>
                      {showDivider && (
                        <div className="flex items-center justify-center my-2">
                          <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                            {dayDividerLabel(m.created_at)}
                          </span>
                        </div>
                      )}
                      {m.role === 'draft' && m.draft.kind === 'purge' ? (
                        <div className="flex justify-end">
                          <div className="max-w-[90%] px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--bg-tertiary)', border: '1px dashed #EF4444' }}>
                            <p className="mb-1" style={{ color: '#EF4444' }}>⚠️ طلب موافقة: حذف نهائي من السلة</p>
                            <p className="mb-1" style={{ color: 'var(--text-muted)' }}>{m.draft.entity_label} #{m.draft.id}</p>
                            <p className="whitespace-pre-wrap mb-2 font-medium" style={{ color: 'var(--text-primary)' }}>{m.draft.title || '(بدون عنوان)'}</p>
                            {!m.resolved ? (
                              <div className="flex gap-1.5">
                                <button onClick={() => resolveDraft(i, 'send')} className="flex-1 py-1 rounded text-[11px] font-medium" style={{ background: '#EF4444', color: 'white' }}>حذف نهائي</button>
                                <button onClick={() => resolveDraft(i, 'cancel')} className="flex-1 py-1 rounded text-[11px]" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>إلغاء</button>
                              </div>
                            ) : (
                              <p className="text-[10px]" style={{ color: m.resolved === 'cancel' ? 'var(--text-muted)' : '#EF4444' }}>
                                {m.resolved === 'cancel' ? '❌ تم الإلغاء -- لم يُحذف شيء' : '🗑️ تم الحذف النهائي'}
                              </p>
                            )}
                          </div>
                        </div>
                      ) : m.role === 'draft' ? (
                        <div className="flex justify-end">
                          <div className="max-w-[90%] px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--bg-tertiary)', border: '1px dashed var(--accent)' }}>
                            <p className="mb-1" style={{ color: 'var(--text-muted)' }}>📝 مسودة رسالة إلى <b style={{ color: 'var(--text-primary)' }}>{m.draft.recipient_name}</b>:</p>
                            <p className="whitespace-pre-wrap mb-2" style={{ color: 'var(--text-primary)' }}>{m.draft.content}</p>
                            {m.draft.scheduled && (
                              <p className="text-[10px] mb-1.5" style={{ color: 'var(--text-muted)' }}>الوقت المقترح: {formatArabicDateTime(m.draft.send_at)}</p>
                            )}
                            {!m.resolved ? (
                              <div className="flex gap-1.5">
                                <button onClick={() => resolveDraft(i, 'send')} className="flex-1 py-1 rounded text-[11px] font-medium" style={{ background: 'var(--accent)', color: 'white' }}>إرسال الآن</button>
                                {m.draft.scheduled && (
                                  <button onClick={() => resolveDraft(i, 'schedule')} className="flex-1 py-1 rounded text-[11px] font-medium" style={{ background: 'var(--success, #22c55e)', color: 'white' }}>جدولة</button>
                                )}
                                <button onClick={() => resolveDraft(i, 'cancel')} className="flex-1 py-1 rounded text-[11px]" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>إلغاء</button>
                              </div>
                            ) : (
                              <p className="text-[10px]" style={{ color: m.resolved === 'cancel' ? 'var(--text-muted)' : 'var(--success)' }}>
                                {m.resolved === 'send' ? '✅ تم الإرسال' : m.resolved === 'schedule' ? `🕒 تم الجدولة على ${formatArabicDateTime(m.draft.send_at)}` : '❌ تم الإلغاء'}
                              </p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                          <div className="max-w-[85%] px-3 py-2 rounded-lg text-xs whitespace-pre-wrap" style={{
                            background: m.role === 'user' ? 'var(--accent)' : 'var(--bg-tertiary)',
                            color: m.role === 'user' ? 'white' : 'var(--text-primary)',
                          }}>
                            {m.content}
                            {m.created_at && <div className="text-[9px] mt-1 opacity-70">{formatArabicTime(m.created_at)}</div>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
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
                {canListen && (
                  <button onClick={toggleListening} disabled={sending} className="p-2 rounded-lg shrink-0" title="إدخال صوتي"
                    style={{ background: listening ? '#ef4444' : 'var(--bg-tertiary)', color: listening ? 'white' : 'var(--text-muted)' }}>
                    <Mic className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={toggleVoiceMode} className="p-2 rounded-lg shrink-0" title={voiceMode ? 'إيقاف رد المساعد بالصوت' : 'تفعيل رد المساعد بالصوت'}
                  style={{ background: voiceMode ? 'var(--accent)' : 'var(--bg-tertiary)', color: voiceMode ? 'white' : 'var(--text-muted)' }}>
                  {voiceMode ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                </button>
                {voiceMode && (
                  <VoiceSettingsPanel voiceRate={voiceRate} setVoiceRate={setVoiceRate} voiceVolume={voiceVolume} setVoiceVolume={setVoiceVolume} />
                )}
                <input value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="اكتب سؤالك..." disabled={sending}
                  className="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-xs" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                {sending ? (
                  <button onClick={stopGenerating} title="إيقاف" className="p-2 rounded-lg shrink-0" style={{ background: '#ef4444', color: 'white' }}>
                    <Square className="w-3.5 h-3.5" fill="currentColor" />
                  </button>
                ) : (
                  // send() takes an optional overrideText (used by voice input) --
                  // onClick={send} would pass the click event itself as that
                  // argument, so a click silently threw "event.trim is not a
                  // function" while Enter kept working (see AIAssistantChat.jsx's
                  // identical fix).
                  <button onClick={() => send()} disabled={!input.trim() && !file} className="p-2 rounded-lg shrink-0 disabled:opacity-40" style={{ background: 'var(--accent)', color: 'white' }}>
                    <Send className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
