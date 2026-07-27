import { useState, useEffect } from 'react';
import { api } from '../api';
import { Save, RotateCcw, Palette, Eye, Check, Plus, Trash2, GripVertical, Users, ArrowUpDown } from 'lucide-react';

const themeKeys = [
  { key: 'theme_mode', label: 'الوضع', type: 'select', options: [
    { value: 'light', label: 'فاتح' },
    { value: 'dark', label: 'داكن' },
  ]},
];

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

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [pipelineLists, setPipelineLists] = useState([]);
  const [users, setUsers] = useState([]);
  const [listAssignees, setListAssignees] = useState({});
  const [activeTab, setActiveTab] = useState('theme');
  const [newList, setNewList] = useState({ name_ar: '', name_en: '', color: '#6B7280' });

  useEffect(() => {
    api.get('/settings').then(d => setSettings(d.data || {})).catch(() => {});
    api.get('/pipeline-lists').then(d => setPipelineLists(d.data || [])).catch(() => {});
    api.get('/users/list').then(d => setUsers(d.data || [])).catch(() => {});
    // Load assignees for each list
    api.get('/pipeline-lists').then(async (d) => {
      const lists = d.data || [];
      const assignees = {};
      for (const l of lists) {
        try {
          const a = await api.get(`/pipeline/lists/${l.id}/assignees`);
          assignees[l.id] = a.data || [];
        } catch {}
      }
      setListAssignees(assignees);
    }).catch(() => {});
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

  // ===== PIPELINE LIST MANAGEMENT =====

  const addList = async () => {
    if (!newList.name_ar.trim()) return;
    try {
      await api.post('/pipeline-lists', newList);
      setNewList({ name_ar: '', name_en: '', color: '#6B7280' });
      const d = await api.get('/pipeline-lists');
      setPipelineLists(d.data || []);
    } catch (e) { alert(e.message); }
  };

  const deleteList = async (id) => {
    if (!confirm('هل تريد حذف هذه القائمة؟ البطاقات سترجع لـ "بانتظار الرد".')) return;
    try {
      await api.delete(`/pipeline-lists/${id}`);
      const d = await api.get('/pipeline-lists');
      setPipelineLists(d.data || []);
    } catch {}
  };

  const moveListUp = async (list, index) => {
    if (index === 0) return;
    try {
      await api.put(`/pipeline-lists/${list.id}/reorder`, { list_number: list.list_number - 1 });
      const d = await api.get('/pipeline-lists');
      setPipelineLists(d.data || []);
    } catch {}
  };

  const moveListDown = async (list, index) => {
    if (index >= pipelineLists.length - 1) return;
    try {
      await api.put(`/pipeline-lists/${list.id}/reorder`, { list_number: list.list_number + 1 });
      const d = await api.get('/pipeline-lists');
      setPipelineLists(d.data || []);
    } catch {}
  };

  const updateListAssignees = async (listId, userIds) => {
    try {
      await api.post(`/pipeline/lists/${listId}/assignees`, { user_ids: userIds });
      const a = await api.get(`/pipeline/lists/${listId}/assignees`);
      setListAssignees(prev => ({ ...prev, [listId]: a.data || [] }));
    } catch {}
  };

  const [editingListColor, setEditingListColor] = useState(null);

  const updateListColor = async (id, color) => {
    try {
      await api.put(`/pipeline-lists/${id}`, { color });
      const d = await api.get('/pipeline-lists');
      setPipelineLists(d.data || []);
    } catch {}
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-4xl mx-auto">
      {/* Tab Bar */}
      <div className="flex gap-1 border-b pb-0.5" style={{ borderColor: 'var(--border)' }}>
        <button onClick={() => setActiveTab('theme')}
          className="px-4 py-2.5 font-medium transition-all rounded-t-xl"
          style={{
            color: activeTab === 'theme' ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: activeTab === 'theme' ? '2px solid var(--accent)' : '2px solid transparent'
          }}>
          🎨 الألوان والثيم
        </button>
        <button onClick={() => setActiveTab('pipeline')}
          className="px-4 py-2.5 font-medium transition-all rounded-t-xl"
          style={{
            color: activeTab === 'pipeline' ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: activeTab === 'pipeline' ? '2px solid var(--accent)' : '2px solid transparent'
          }}>
          📋 إدارة قوائم الإنتاج
        </button>
      </div>

      {/* ===== THEME TAB ===== */}
      {activeTab === 'theme' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>الإعدادات</h1>
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
      )}

      {/* ===== PIPELINE LISTS TAB ===== */}
      {activeTab === 'pipeline' && (
        <div className="space-y-6">
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📋 إدارة قوائم الإنتاج</h1>

          {/* Add New List */}
          <div className="p-5 rounded-xl border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
            <h2 className="font-semibold mb-3" style={{ color: 'var(--accent)' }}>➕ إضافة قائمة جديدة</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input value={newList.name_ar} onChange={e => setNewList({...newList, name_ar: e.target.value})}
                placeholder="الاسم بالعربية *"
                className="p-2.5 rounded-xl border" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
              <input value={newList.name_en} onChange={e => setNewList({...newList, name_en: e.target.value})}
                placeholder="English Name *"
                className="p-2.5 rounded-xl border" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
              <div className="flex items-center gap-2">
                <input type="color" value={newList.color} onChange={e => setNewList({...newList, color: e.target.value})}
                  className="w-10 h-10 rounded-lg border-0" />
                <input value={newList.color} onChange={e => setNewList({...newList, color: e.target.value})}
                  className="flex-1 p-2.5 rounded-xl border font-mono text-xs"
                  style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
              </div>
              <button onClick={addList}
                className="p-2.5 rounded-xl font-semibold" style={{ background: 'var(--accent)', color: '#1A1A2E' }}>
                <Plus className="w-4 h-4 inline ml-1" /> إضافة
              </button>
            </div>
          </div>

          {/* Existing Lists */}
          <div className="space-y-3">
            {pipelineLists.map((list, index) => (
              <div key={list.id} className="p-4 rounded-xl border" style={{ background: 'var(--bg-secondary)', borderColor: list.color + '40' }}>
                <div className="flex items-center gap-3">
                  {/* Drag handle */}
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => moveListUp(list, index)}
                      className="p-0.5 hover:opacity-70" style={{ color: 'var(--text-muted)' }}>▲</button>
                    <button onClick={() => moveListDown(list, index)}
                      className="p-0.5 hover:opacity-70" style={{ color: 'var(--text-muted)' }}>▼</button>
                  </div>

                  {/* Color + Name */}
                  <div className="w-4 h-4 rounded-full shrink-0" style={{ background: list.color }} />
                  <div className="flex-1">
                    <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                      {list.list_number}. {list.name_ar}
                    </p>
                    <p style={{ color: 'var(--text-muted)' }}>{list.name_en}</p>
                  </div>

                  {/* Color Picker Quick */}
                  <input type="color" value={list.color}
                    onChange={e => updateListColor(list.id, e.target.value)}
                    className="w-8 h-8 rounded-lg border-0 cursor-pointer" />

                  {/* Edit Name Button */}
                  <button onClick={() => {
                    const newNameAr = prompt('الاسم بالعربية:', list.name_ar);
                    if (newNameAr && newNameAr.trim()) {
                      const newNameEn = prompt('English Name:', list.name_en);
                      if (newNameEn && newNameEn.trim()) {
                        api.put(`/pipeline-lists/${list.id}`, { name_ar: newNameAr.trim(), name_en: newNameEn.trim() })
                          .then(() => api.get('/pipeline-lists'))
                          .then(d => setPipelineLists(d.data || []))
                          .catch(() => {});
                      }
                    }
                  }}
                    className="p-2 rounded-lg transition-all"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseOver={e => e.currentTarget.style.color = 'var(--accent)'}
                    onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}>
                    ✏️
                  </button>

                  {/* Assign Team */}
                  <div className="relative group">
                    <button className="p-2 rounded-lg transition-all"
                      style={{ color: 'var(--text-muted)' }}
                      onMouseOver={e => e.currentTarget.style.color = 'var(--accent)'}
                      onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}>
                      <Users className="w-4 h-4" />
                    </button>
                    <div className="absolute left-0 top-full mt-1 w-56 p-3 rounded-xl border z-50 hidden group-hover:block"
                      style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
                      <p className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>👥 تعيين فريق</p>
                      {users.length === 0 ? (
                        <p style={{ color: 'var(--text-muted)' }}>لا يوجد مستخدمين</p>
                      ) : users.map(u => {
                        const isAssigned = (listAssignees[list.id] || []).some(a => a.id === u.id);
                        return (
                          <label key={u.id} className="flex items-center gap-2 py-1 cursor-pointer">
                            <input type="checkbox" checked={isAssigned}
                              onChange={() => {
                                const curr = (listAssignees[list.id] || []).map(a => a.id);
                                const next = isAssigned ? curr.filter(id => id !== u.id) : [...curr, u.id];
                                updateListAssignees(list.id, next);
                              }}
                              className="w-4 h-4 accent-[#D4A843]" />
                            <span style={{ color: 'var(--text-primary)' }}>{u.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Delete */}
                  <button onClick={() => deleteList(list.id)}
                    className="p-2 rounded-lg transition-all"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseOver={e => e.currentTarget.style.color = '#EF4444'}
                    onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
