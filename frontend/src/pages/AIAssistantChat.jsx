import { useState, useEffect, useRef } from 'react';
import { Send, Paperclip, X, Mic, MessageSquarePlus } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import FoxBotIcon from '../components/icons/FoxBotIcon';
import { useAIChat } from '../hooks/useAIChat';
import { useActiveProviderStatus } from '../hooks/useActiveProviderStatus';

// The dedicated, full-page place to talk to the assistant -- separate from
// "الربط الذكي" (provider keys, capability toggles, knowledge center) and
// from the small floating widget (AIAssistantWidget.jsx), which shares this
// same useAIChat() hook so both surfaces stay behaviorally identical, just
// with a roomier layout here.
export default function AIAssistantChat() {
  const [listening, setListening] = useState(false);
  const listRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);

  const { messages, input, setInput, file, setFile, sending, send, newConversation } = useAIChat();
  const { hasActiveProvider, checkFailed, recheck } = useActiveProviderStatus();

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages]);
  useEffect(() => { if (!file && fileInputRef.current) fileInputRef.current.value = ''; }, [file]);
  useEffect(() => () => recognitionRef.current?.stop(), []);

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

  return (
    <div className="space-y-4 animate-fadeIn h-full flex flex-col">
      <PageHeader eyebrow="ذكاء اصطناعي" title="المساعد الذكي" meta="اسأل، اطلب تقارير، أو اطلب فتح وتصفية أقسام النظام مباشرة"
        actions={<button onClick={newConversation} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
          <MessageSquarePlus className="w-3.5 h-3.5" />محادثة جديدة
        </button>} />

      {checkFailed ? (
        <div className="text-sm p-4 rounded-2xl" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
          <p className="mb-2">⚠️ تعذر التحقق من حالة المساعد الذكي.</p>
          <button onClick={recheck} className="underline" style={{ color: 'var(--accent)' }}>إعادة المحاولة</button>
        </div>
      ) : hasActiveProvider === false ? (
        <p className="text-sm p-4 rounded-2xl" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
          لا يوجد مزود ذكاء اصطناعي مفعّل حاليًا. فعّل واحدًا من صفحة "الربط الذكي".
        </p>
      ) : (
        <div className="flex-1 flex flex-col rounded-2xl border overflow-hidden" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', minHeight: '60vh' }}>
          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 py-16">
                <FoxBotIcon className="w-12 h-12" style={{ color: 'var(--accent)' }} />
                <p className="text-sm text-center max-w-md" style={{ color: 'var(--text-muted)' }}>
                  اسألني عن قضايا الاستقبال الذكي، تقارير أداء الموظفين، القضايا ذات الردود غير المُطّلع عليها، الإيميلات غير المرتبطة، أو اطلب مني فتح وتصفية القضايا مباشرة.
                </p>
              </div>
            ) : messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                <div className="max-w-[70%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap" style={{
                  background: m.role === 'user' ? 'var(--accent)' : 'var(--bg-tertiary)',
                  color: m.role === 'user' ? 'white' : 'var(--text-primary)',
                }}>{m.content}</div>
              </div>
            ))}
            {sending && <div className="flex justify-end"><div className="px-4 py-2.5 rounded-2xl text-sm" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>...جارٍ التفكير</div></div>}
          </div>

          {file && (
            <div className="flex items-center justify-between gap-2 mx-4 mb-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--bg-tertiary)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>📎 {file.name}</span>
              <button onClick={() => setFile(null)}><X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /></button>
            </div>
          )}

          <div className="flex items-center gap-2 p-3 pt-0">
            <input ref={fileInputRef} type="file" hidden onChange={e => setFile(e.target.files?.[0] || null)} />
            <button onClick={() => fileInputRef.current?.click()} disabled={sending} className="p-2.5 rounded-xl shrink-0" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }} title="إرفاق ملف">
              <Paperclip className="w-4 h-4" />
            </button>
            {SpeechRecognitionCtor && (
              <button onClick={toggleListening} disabled={sending} className="p-2.5 rounded-xl shrink-0" title="إدخال صوتي"
                style={{ background: listening ? '#ef4444' : 'var(--bg-tertiary)', color: listening ? 'white' : 'var(--text-muted)' }}>
                <Mic className="w-4 h-4" />
              </button>
            )}
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="اكتب سؤالك..." disabled={sending}
              className="flex-1 min-w-0 px-4 py-2.5 rounded-xl text-sm" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            <button onClick={send} disabled={sending || (!input.trim() && !file)} className="p-2.5 rounded-xl shrink-0 disabled:opacity-40" style={{ background: 'var(--accent)', color: 'white' }}>
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
