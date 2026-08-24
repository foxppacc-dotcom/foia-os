import { useState, useEffect } from 'react';
import { api } from '../api';
import { Save, RotateCcw, Palette, Eye, Check } from 'lucide-react';

const colorKeys = [
  { key: 'theme_bg_primary', label: 'الخلفية الرئيسية', desc: 'لون خلفية الصفحة' },
  { key: 'theme_bg_secondary', label: 'الخلفية الثانوية', desc: 'الكروت والبطاقات' },
  { key: 'theme_bg_tertiary', label: 'الخلفية الثالثية', desc: 'الحقول والجداول' },
  { key: 'theme_bg_elevated', label: 'العناصر البارزة', desc: 'عند تمرير الماوس' },
  { key: 'theme_border', label: 'الحدود', desc: 'حدود العناصر' },
  { key: 'theme_text_primary', label: 'النص الأساسي', desc: 'العناوين' },
  { key: 'theme_text_secondary', label: 'النص الثانوي', desc: 'المحتوى العادي' },
  { key: 'theme_text_muted', label: 'النص الخافت', desc: 'التواريخ والملاحظات' },
  { key: 'theme_accent', label: 'اللون المميز', desc: 'الأزرار والعناصر الذهبية' },
  { key: 'theme_accent_hover', label: 'اللون المميز عند التمرير', desc: 'ظل اللون الذهبي' },
  { key: 'theme_danger', label: 'أخطار', desc: 'أخطاء وتنبيهات' },
  { key: 'theme_success', label: 'نجاح', desc: 'اكتمال وموافقة' },
  { key: 'theme_warning', label: 'تحذير', desc: 'تنبيهات' },
];

export default function ThemeSettings() {
  const [settings, setSettings] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    api.get('/settings').then(d => setSettings(d.data || {})).catch(() => {});
  }, []);

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    const varName = '--' + key.replace('theme_', '');
    document.documentElement.style.setProperty(varName, value);
    if (key === 'theme_mode') {
      document.documentElement.classList.toggle('dark', value === 'dark');
    }
  };

  const saveAll = async () => {
    setSaving(true);
    const updates = {};
    for (const k of colorKeys) updates[k.key] = settings[k.key];
    updates.theme_mode = settings.theme_mode;
    try {
      await api.put('/settings', updates);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  };

  const resetDefaults = async () => {
    setResetting(true);
    try {
      await api.post('/settings/reset');
      const d = await api.get('/settings');
      setSettings(d.data || {});
      for (const [k, v] of Object.entries(d.data || {})) {
        if (k.startsWith('theme_')) updateSetting(k, v);
      }
    } catch {}
    setResetting(false);
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-4xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>🎨 الألوان والثيم</h1>
        <div className="flex items-center gap-2">
          <button onClick={resetDefaults} disabled={resetting}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            <RotateCcw className="w-4 h-4" />
            إعادة تعيين
          </button>
          <button onClick={saveAll} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl font-semibold"
            style={{ background: 'var(--accent)', color: '#1A1A2E' }}>
            {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? 'تم الحفظ' : saving ? 'جاري...' : 'حفظ'}
          </button>
        </div>
      </div>

      {/* Mode Toggle */}
      <div className="backdrop-blur-xl border rounded-2xl p-5" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <h2 className="font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--accent)' }}><Palette className="w-4 h-4" /> وضع الألوان</h2>
        <div className="flex gap-3">
          {[{mode:'light', label:'🌞 فاتح',emoji:'☀️'},{mode:'dark', label:'🌙 داكن',emoji:'🌙'}].map(m => (
            <button key={m.mode} onClick={() => updateSetting('theme_mode', m.mode)}
              className="flex-1 p-4 rounded-xl border-2 text-center transition-all"
              style={{
                borderColor: settings.theme_mode === m.mode ? 'var(--accent)' : 'var(--border)',
                background: settings.theme_mode === m.mode ? 'var(--accent)15' : 'var(--bg-tertiary)',
                color: 'var(--text-primary)'
              }}>
              <span className="text-2xl block mb-1">{m.emoji}</span>
              <span className="font-medium">{m.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Color Grid */}
      <div className="backdrop-blur-xl border rounded-2xl p-5" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <h2 className="font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--accent)' }}><Eye className="w-4 h-4" /> الألوان المخصصة</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {colorKeys.map(ck => (
            <div key={ck.key} className="p-3 rounded-xl" style={{ background: 'var(--bg-tertiary)' }}>
              <div className="flex items-center justify-between mb-2">
                <label className="font-medium" style={{ color: 'var(--text-primary)' }}>{ck.label}</label>
                <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{settings[ck.key] || ''}</span>
              </div>
              <div className="flex items-center gap-2">
                <input type="color" value={settings[ck.key] || '#000000'}
                  onChange={e => updateSetting(ck.key, e.target.value)}
                  className="w-10 h-10 rounded-lg border-0 cursor-pointer" style={{ background: 'transparent' }} />
                <input type="text" value={settings[ck.key] || ''}
                  onChange={e => updateSetting(ck.key, e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-mono border"
                  style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                <div className="w-8 h-8 rounded-lg border shrink-0" style={{ background: settings[ck.key] || '#000', borderColor: 'var(--border)' }} />
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{ck.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="backdrop-blur-xl border rounded-2xl p-5" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <h2 className="font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--accent)' }}><Eye className="w-4 h-4" /> معاينة حية</h2>
        <div className="p-4 rounded-xl" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold" style={{ background: 'var(--accent)', color: '#1A1A2E' }}>F</div>
            <div><p className="font-medium" style={{ color: 'var(--text-primary)' }}>FOIA OS</p><p style={{ color: 'var(--text-muted)' }}>نظام إدارة طلبات السجلات</p></div>
            <div className="mr-auto px-3 py-1 rounded-full text-xs font-medium" style={{ background: '#10B98120', color: '#10B981' }}>🟢 مفتوحة</div>
          </div>
          <div className="flex gap-2">
            <span className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: '#D4A843', color: '#1A1A2E' }}>قضية جديدة</span>
            <span className="px-3 py-1.5 rounded-lg text-xs border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>إلغاء</span>
          </div>
        </div>
      </div>
    </div>
  );
}
