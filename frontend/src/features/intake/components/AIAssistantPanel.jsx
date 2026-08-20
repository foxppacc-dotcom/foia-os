import { useState, useEffect, useRef } from 'react';
import { api, getApiBase } from '../../../api';
import { Bot, Send, Paperclip, X } from 'lucide-react';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';

const tok = () => localStorage.getItem('foia_token');

// Pure chat -- provider connection and the assistant's own capability
// toggles live in their own dedicated "الربط الذكي" sidebar page
// (pages/AIAssistantSettings.jsx), not here. This panel is only ever the
// conversation itself, embedded inside الاستقبال الذكي where it's actually
// used day to day.
export default function AIAssistantPanel() {
  const [hasActiveProvider, setHasActiveProvider] = useState(null); // null = unknown yet
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    // Chat itself reports "no active provider" on first send if none is
    // configured -- this is just an early, friendlier heads-up so the box
    // doesn't sit there looking usable when it can't actually respond yet.
    api.get('/ai/providers').then(d => setHasActiveProvider((d.data || []).some(p => p.is_active))).catch(() => setHasActiveProvider(true));
  }, []);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages]);

  const send = async () => {
    if ((!input.trim() && !file) || sending) return;
    const userMsg = input.trim() || `📎 ${file?.name}`;
    setMessages(m => [...m, { role: 'user', content: userMsg }]);
    const fd = new FormData();
    fd.append('message', input.trim() || 'حلّل هذا الملف المرفق.');
    if (conversationId) fd.append('conversation_id', conversationId);
    if (file) fd.append('file', file);
    setInput(''); setFile(null); setSending(true);
    try {
      const res = await fetch(`${getApiBase()}/ai/chat`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok() }, body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'فشل الطلب');
      setConversationId(d.conversation_id);
      setMessages(m => [...m, { role: 'assistant', content: d.answer }]);
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${e.message}` }]);
    }
    setSending(false);
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <Bot className="w-5 h-5" style={{ color: 'var(--accent)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>الحديث مع المساعد الذكي</span>
      </div>

      {hasActiveProvider === false ? (
        <p className="text-xs p-3 rounded-lg" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
          لا يوجد مزود ذكاء اصطناعي مفعّل حاليًا. اطلب من المسؤول تفعيل واحد من صفحة "الربط الذكي".
        </p>
      ) : (
        <>
          <div ref={listRef} className="space-y-2 overflow-y-auto p-2 rounded-lg" style={{ maxHeight: '340px', background: 'var(--bg-secondary)' }}>
            {messages.length === 0 ? (
              <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>اسأل المساعد الذكي عن قضايا الاستقبال، تقارير الموظفين، أو الإيميلات غير المرتبطة... وتقدر ترفعله ملف ليحلله.</p>
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
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'var(--bg-secondary)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>📎 {file.name}</span>
              <button onClick={() => setFile(null)}><X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /></button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" hidden onChange={e => setFile(e.target.files?.[0] || null)} />
            <button onClick={() => fileInputRef.current?.click()} disabled={sending} className="p-2 rounded-lg shrink-0" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }} title="إرفاق ملف">
              <Paperclip className="w-4 h-4" />
            </button>
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="اكتب سؤالك..." disabled={sending}
              className="flex-1 px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            <Button size="sm" icon={Send} disabled={sending || (!input.trim() && !file)} onClick={send}>إرسال</Button>
          </div>
        </>
      )}
    </Card>
  );
}
