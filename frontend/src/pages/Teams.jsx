import { useState, useEffect } from 'react';
import { api } from '../api';
import { Plus, Trash2, Users as UsersIcon } from 'lucide-react';

export default function Teams() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [expandedTeam, setExpandedTeam] = useState(null);
  const [members, setMembers] = useState([]);

  const fetchTeams = () => api.getTeams().then(d => { setTeams(d.data || []); setLoading(false); }).catch(() => setLoading(false));
  useEffect(() => { fetchTeams(); }, []);

  const createTeam = async () => {
    if (!formName.trim()) return;
    await api.createTeam({ name: formName });
    setShowForm(false); setFormName('');
    fetchTeams();
  };

  const deleteTeam = async (id) => {
    if (confirm('متأكد؟')) { await api.deleteTeam(id); fetchTeams(); }
  };

  const toggleMembers = async (id) => {
    if (expandedTeam === id) { setExpandedTeam(null); return; }
    const d = await api.getTeamMembers(id);
    setMembers(d.data || []);
    setExpandedTeam(id);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#D4A843] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">إدارة الفرق</h1>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm bg-gradient-to-r from-[#D4A843] to-[#e4b84a] text-[#0A0A0F] transition-all active:scale-[0.97]">
          <Plus className="w-4 h-4" /> فريق جديد
        </button>
      </div>

      {showForm && (
        <div className="card-container rounded-2xl p-5 animate-slideUp">
          <h3 className="text-sm font-semibold var(--accent) mb-3">فريق جديد</h3>
          <div className="flex gap-3">
            <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="اسم الفريق" onKeyDown={e => e.key === 'Enter' && createTeam()} className="flex-1 px-4 py-2.5 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white placeholder-gray-500 focus:outline-none focus:border-[#D4A843] text-sm" />
            <button onClick={createTeam} className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#D4A843] to-[#e4b84a] text-[#0A0A0F] transition-all">إنشاء</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {teams.map(t => (
          <div key={t.id} className="card-container rounded-2xl p-5 hover:border-[#D4A84330] transition-all">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#D4A843]/20 to-transparent flex items-center justify-center">
                  <UsersIcon className="w-5 h-5 var(--accent)" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">{t.name}</h3>
                  <p className="text-[10px] text-gray-500">{t.member_count || 0} أعضاء</p>
                </div>
              </div>
              <button onClick={() => deleteTeam(t.id)} className="p-1.5 rounded-lg hover:bg-[#EF4444]/10 text-gray-500 hover:text-[#EF4444] transition-all">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <button onClick={() => toggleMembers(t.id)} className="w-full text-xs text-gray-500 hover:text-white py-1.5 rounded-lg hover:var(--bg-tertiary) transition-all">
              {expandedTeam === t.id ? 'إخفاء الأعضاء' : 'عرض الأعضاء'}
            </button>

            {expandedTeam === t.id && (
              <div className="mt-2 space-y-1.5">
                {members.length === 0 ? (
                  <p className="text-xs text-gray-600 text-center py-2">لا يوجد أعضاء</p>
                ) : members.map(m => (
                  <div key={m.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#0A0A0F]">
                    <span className="text-xs text-white">{m.name}</span>
                    <span className="text-[10px] text-gray-500">{m.email}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {teams.length === 0 && (
          <div className="col-span-3 flex flex-col items-center py-12">
            <UsersIcon className="w-10 h-10 text-gray-700 mb-3" />
            <p className="text-sm text-gray-500">لا توجد فرق بعد</p>
          </div>
        )}
      </div>
    </div>
  );
}
