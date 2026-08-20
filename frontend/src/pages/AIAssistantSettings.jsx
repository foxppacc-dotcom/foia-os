import { useState, useEffect } from 'react';
import { api } from '../api';
import { Bot, Plus, Trash2, CheckCircle2, Power } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Spinner from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';

const PROVIDER_LABEL = { anthropic: 'Claude (Anthropic)', openai: 'ChatGPT (OpenAI)', deepseek: 'DeepSeek', gemini: 'Gemini (Google)' };

function ProviderSettings({ toast }) {
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
      fetchProviders();
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };

  const activate = async (id) => {
    try { await api.put(`/ai/providers/${id}/activate`, {}); fetchProviders(); }
    catch (e) { toast.error(e.message); }
  };

  const remove = async (id) => {
    if (!confirm('حذف هذا المزود؟')) return;
    try { await api.delete(`/ai/providers/${id}`); fetchProviders(); }
    catch (e) { toast.error(e.message); }
  };

  if (loading) return <Spinner />;

  return (
    <Card title="المزودون" icon={<Bot className="w-4 h-4" style={{ color: 'var(--accent)' }} />}>
      <div className="space-y-3">
        {providers.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>لا يوجد أي مزود ذكاء اصطناعي مربوط بعد.</p>
        ) : (
          <div className="space-y-2">
            {providers.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-2 p-3 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{PROVIDER_LABEL[p.provider] || p.provider}</span>
                    {p.is_active && <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}><CheckCircle2 className="w-2.5 h-2.5" />مفعّل</span>}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.model} · {p.daily_request_count || 0} طلب اليوم</div>
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
          <div className="p-3 rounded-xl space-y-2" style={{ background: 'var(--bg-secondary)', border: '1px dashed var(--border)' }}>
            <select value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
              {Object.entries(PROVIDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder="اسم النموذج (مثال: claude-sonnet-5)"
              className="w-full px-3 py-2 rounded-lg text-sm" dir="ltr" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            <input value={form.api_key} onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))} placeholder="مفتاح الـ API" type="password"
              className="w-full px-3 py-2 rounded-lg text-sm" dir="ltr" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            <div className="flex gap-1.5 justify-end">
              <Button size="sm" variant="secondary" onClick={() => setShowAdd(false)}>إلغاء</Button>
              <Button size="sm" disabled={saving} onClick={addProvider}>{saving ? 'جارٍ الاختبار والحفظ...' : 'اختبار وحفظ'}</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// The assistant's OWN global capability set -- independent of which role is
// chatting with it (that's a separate per-role gate in فريق العمل →
// الصلاحيات, resource ai_assistant's single "use_chat" action). Widen or
// narrow this based on how accurate the results turn out to be.
function CapabilityToggles({ toast }) {
  const [actions, setActions] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);

  const fetchAll = () => {
    Promise.all([api.get('/permissions/schema'), api.get('/ai/capabilities')])
      .then(([schema, caps]) => { setActions(schema.aiCapabilityActions || []); setValues(caps.data || {}); })
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { fetchAll(); }, []);

  const toggle = async (action) => {
    const next = !values[action];
    setValues(v => ({ ...v, [action]: next })); // optimistic
    try { await api.put('/ai/capabilities', { action, allowed: next }); }
    catch (e) { toast.error(e.message); setValues(v => ({ ...v, [action]: !next })); }
  };

  if (loading) return <Spinner />;

  return (
    <Card title="صلاحيات المساعد الذكي (ما يُسمح له بفعله)" icon={<CheckCircle2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />}>
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        هذه صلاحيات المساعد نفسه — مفعّلة لكل من يستطيع فتح الدردشة معه، بغض النظر عن دوره. وسّعها أو ضيّقها حسب ثقتك بدقة نتائجه.
      </p>
      <div className="space-y-2">
        {actions.map(a => (
          <label key={a.key} className="flex items-center gap-2.5 p-2.5 rounded-lg cursor-pointer select-none" style={{ background: 'var(--bg-secondary)' }}>
            <input type="checkbox" checked={!!values[a.key]} onChange={() => toggle(a.key)} className="w-4 h-4 rounded" style={{ accentColor: 'var(--accent)' }} />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{a.label}</span>
          </label>
        ))}
      </div>
    </Card>
  );
}

export default function AIAssistantSettings() {
  const toast = useToast();
  return (
    <div className="space-y-4 animate-fadeIn">
      <PageHeader eyebrow="ذكاء اصطناعي" title="الربط الذكي" meta="ربط مزودي الذكاء الاصطناعي وضبط ما يُسمح للمساعد الذكي بفعله داخل النظام" />
      <ProviderSettings toast={toast} />
      <CapabilityToggles toast={toast} />
    </div>
  );
}
