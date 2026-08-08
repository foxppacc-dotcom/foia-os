import { useState, useEffect } from 'react';
import { api } from '../api';
import { Plus, Trash2, Users } from 'lucide-react';

export default function ProductionListsAdmin() {
  const [pipelineLists, setPipelineLists] = useState([]);
  const [users, setUsers] = useState([]);
  const [listAssignees, setListAssignees] = useState({});
  const [newList, setNewList] = useState({ name_ar: '', name_en: '', color: '#6B7280' });

  useEffect(() => {
    api.get('/pipeline-lists').then(d => setPipelineLists(d.data || [])).catch(() => {});
    api.get('/users/list').then(d => setUsers(d.data || [])).catch(() => {});
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

  const updateListColor = async (id, color) => {
    try {
      await api.put(`/pipeline-lists/${id}`, { color });
      const d = await api.get('/pipeline-lists');
      setPipelineLists(d.data || []);
    } catch {}
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-4xl mx-auto">
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
  );
}
