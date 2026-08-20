import { useState, useEffect, useRef } from 'react';
import { api, getCurrentUser } from '../../../api';
import { Bot, Send, Settings2, Plus, Trash2, CheckCircle2, Power } from 'lucide-react';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import Modal from '../../../components/ui/Modal';
import Spinner from '../../../components/ui/Spinner';
import { useToast } from '../../../components/ui/Toast';

const PROVIDER_LABEL = { anthropic: 'Claude (Anthropic)', openai: 'ChatGPT (OpenAI)', deepseek: 'DeepSeek', gemini: 'Gemini (Google)' };

// Admin-only: add/activate/delete AI provider configs. Keys are entered here
// and encrypted server-side (services/crypto.js) -- never shown again once
// saved, same convention as email account passwords elsewhere in the app.
function ProviderSettings({ onChanged, toast }) {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ provider: 'anthropic', api_key: '', model: '' });
  const [saving, setSaving] = useState(false);

  const fetchProviders = () => {
    api.get('/ai/providers').then(d => setProviders(d.data || [])).catch(e => toast.error(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { fetchProviders(); }, []);

  const addProvider = async () => {
    if (!form.api_key.trim() || !form.model.trim()) return toast.error('المفتاح واسم النموذج مطلوبان');
    setSaving(true);
    try {
      await api.post('/ai/providers', form);
      toast.success('تم ربط المزود بنجاح');
      setForm({ provider: 'anthropic', api_key: '', model: '' });
      setShowAdd(false);
      fetchProviders(); onChanged?.();
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };

  const activate = async (id) => {
    try { await api.put(`/ai/providers/${id}/activate`, {}); fetchProviders(); onChanged?.(); }
    catch (e) { toast.error(e.message); }
  };

  const remove = async (id) => {
    if (!confirm('حذف هذا المزود؟')) return;
    try { await api.delete(`/ai/providers/${id}`); fetchProviders(); onChanged?.(); }
    catch (e) { toast.error(e.message); }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {providers.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>لا يوجد أي مزود ذكاء اصطناعي مربوط بعد.</p>
      ) : (
        <div className="space-y-2">
          {providers.map(p => (
            <div key={p.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{PROVIDER_LABEL[p.provider] || p.provider}</span>
                  {p.is_active && <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}><CheckCircle2 className="w-2.5 h-2.5" />مفعّل</span>}
                </div>
                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{p.model} · {p.daily_request_count || 0} طلب اليوم</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!p.is_active && <Button size="sm" variant="secondary" icon={Power} onClick={() => activate(p.id)}>تفعيل</Button>}
                <button onClick={() => remove(p.id)} className="p-1.5" style={{ color: '#ef4444' }}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!showAdd ? (
        <Button size="sm" variant="secondary" icon={Plus} onClick={() => setShowAdd(true)}>ربط مزود جديد</Button>
      ) : (
        <div className="p-3 rounded-lg space-y-2" style={{ background: 'var(--bg-secondary)', border: '1px dashed var(--border)' }}>
          <select value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
            className="w-full px-2.5 py-1.5 rounded text-xs" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            {Object.entries(PROVIDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder="اسم النموذج (مثال: claude-sonnet-5)"
            className="w-full px-2.5 py-1.5 rounded text-xs" dir="ltr" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
          <input value={form.api_key} onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))} placeholder="مفتاح الـ API" type="password"
            className="w-full px-2.5 py-1.5 rounded text-xs" dir="ltr" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
          <div className="flex gap-1.5 justify-end">
            <Button size="sm" variant="secondary" onClick={() => setShowAdd(false)}>إلغاء</Button>
            <Button size="sm" disabled={saving} onClick={addProvider}>{saving ? 'جارٍ الاختبار والحفظ...' : 'اختبار وحفظ'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AIAssistantPanel() {
  const toast = useToast();
  const me = getCurrentUser();
  const isAdmin = me?.role === 'admin';
  const [showSettings, setShowSettings] = useState(false);
  const [hasActiveProvider, setHasActiveProvider] = useState(null); // null = unknown yet
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  const checkProvider = () => {
    if (!isAdmin) { setHasActiveProvider(true); return; } // non-admins can't see the list; the chat call itself will report if none is active
    api.get('/ai/providers').then(d => setHasActiveProvider((d.data || []).some(p => p.is_active))).catch(() => setHasActiveProvider(false));
  };
  useEffect(() => { checkProvider(); }, []);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages]);

  const send = async () => {
    if (!input.trim() || sending) return;
    const userMsg = input.trim();
    setMessages(m => [...m, { role: 'user', content: userMsg }]);
    setInput(''); setSending(true);
    try {
      const d = await api.post('/ai/chat', { message: userMsg, conversation_id: conversationId });
      setConversationId(d.conversation_id);
      setMessages(m => [...m, { role: 'assistant', content: d.answer }]);
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${e.message}` }]);
    }
    setSending(false);
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>الربط الذكي (المساعد الذكي)</span>
        </div>
        {isAdmin && <Button size="sm" variant="secondary" icon={Settings2} onClick={() => setShowSettings(true)}>إعدادات الربط</Button>}
      </div>

      {hasActiveProvider === false ? (
        <p className="text-xs p-3 rounded-lg" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
          لا يوجد مزود ذكاء اصطناعي مفعّل حاليًا. {isAdmin ? 'اربط مزودًا من "إعدادات الربط" أعلاه.' : 'تواصل مع مسؤول النظام لتفعيل المساعد الذكي.'}
        </p>
      ) : (
        <>
          <div ref={listRef} className="space-y-2 overflow-y-auto p-2 rounded-lg" style={{ maxHeight: '340px', background: 'var(--bg-secondary)' }}>
            {messages.length === 0 ? (
              <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>اسأل المساعد الذكي عن قضايا الاستقبال، تقارير الموظفين، أو الإيميلات غير المرتبطة...</p>
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
          <div className="flex items-center gap-2">
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="اكتب سؤالك..." disabled={sending}
              className="flex-1 px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            <Button size="sm" icon={Send} disabled={sending || !input.trim()} onClick={send}>إرسال</Button>
          </div>
        </>
      )}

      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="إعدادات الربط الذكي" maxWidth="max-w-lg">
        <ProviderSettings toast={toast} onChanged={checkProvider} />
      </Modal>
    </Card>
  );
}
