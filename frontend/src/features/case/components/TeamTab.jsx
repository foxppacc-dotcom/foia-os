import { useState, useEffect } from 'react';
import { Users, UserPlus, Trash2, Mail, Shield, Star, User, Briefcase, AlertCircle, ArrowUpCircle, X, Check } from 'lucide-react';
import { useCaseContext } from '../context/CaseContext';
import AppSection from '../../../components/ds/AppSection';
import AppButton from '../../../components/ds/AppButton';
import Button from '../../../components/ui/Button';

const API = import.meta.env.VITE_API_URL || 'https://backend-six-flax-84.vercel.app/api';
const tok = () => localStorage.getItem('token');
const hdrs = () => ({ 'Authorization': `Bearer ${tok()}`, 'Content-Type': 'application/json' });

const INVESTIGATION_ROLES = [
  { value: 'lead_investigator', label: 'محقق رئيسي' },
  { value: 'investigator', label: 'محقق' },
  { value: 'researcher', label: 'باحث' },
  { value: 'legal_reviewer', label: 'مراجع قانوني' },
  { value: 'producer', label: 'منتج' },
  { value: 'viewer', label: 'مشاهد' },
  { value: 'observer', label: 'مراقب' },
];

const ROLE_COLORS = {
  owner: '#d4a843', lead_investigator: '#3b82f6', investigator: '#8b5cf6',
  researcher: '#22c55e', legal_reviewer: '#ef4444', producer: '#eab308',
  viewer: '#636366', observer: '#636366',
};

export default function TeamTab() {
  const { id: caseId, c, team, users, handleAddTeam, handleRemoveTeam } = useCaseContext();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ user_id: '', role: 'investigator' });
  const [workload, setWorkload] = useState(null);
  const [transferTo, setTransferTo] = useState('');

  useEffect(() => {
    fetch(`${API}/users/workload`, { headers: hdrs() }).then(r => r.json()).then(d => setWorkload(d));
  }, []);

  const ownerId = c?.owner_id;
  const owner = users?.find(u => u.id === ownerId);
  const available = (users || []).filter(u => u.id !== ownerId && !team?.find(t => t.user_id === u.id));
  const getWorkload = (userId) => workload?.users?.find(u => u.user_id === userId);

  const handleAdd = async () => {
    if (!form.user_id) return;
    await handleAddTeam(form.user_id, form.role);
    setForm({ user_id: '', role: 'investigator' });
    setShowAdd(false);
  };

  const handleTransfer = async () => {
    if (!transferTo) return;
    await fetch(`${API}/cases/${caseId}/transfer`, { method: 'PUT', headers: hdrs(), body: JSON.stringify({ owner_id: parseInt(transferTo) }) });
    setTransferTo('');
    window.location.reload();
  };

  return (
    <div className="space-y-4">
      {/* Owner Card */}
      {owner && (
        <div className="rounded-lg p-3" style={{ background: 'linear-gradient(135deg, rgba(212,168,67,0.08), rgba(212,168,67,0.02))', border: '1px solid rgba(212,168,67,0.3)' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold" style={{ background: '#d4a843', color: 'white' }}>{owner.name?.[0] || '?'}</div>
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-sm" style={{ color: 'var(--ds-text-primary)' }}>{owner.name}</span>
                <Star className="w-3.5 h-3.5" style={{ color: '#d4a843' }} />
                <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(212,168,67,0.2)', color: '#d4a843' }}>مالك التحقيق</span>
              </div>
              <div className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>{owner.email} · {owner.title || ''}</div>
            </div>
          </div>
        </div>
      )}

      {/* Team Members */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>فريق التحقيق</span>
          <Button variant="primary" size="sm" onClick={() => setShowAdd(!showAdd)}>
            <UserPlus className="w-3.5 h-3.5" />إضافة عضو
          </Button>
        </div>

        {/* Add member form */}
        {showAdd && (
          <div className="rounded-lg p-3 flex items-center gap-2" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
            <select className="flex-1 px-2 py-1.5 rounded text-xs" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
              value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}>
              <option value="">اختر موظف...</option>
              {available.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
            </select>
            <select className="w-36 px-2 py-1.5 rounded text-xs" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
              value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              {INVESTIGATION_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <Button variant="primary" size="sm" onClick={handleAdd}><Check className="w-3 h-3" /></Button>
            <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}><X className="w-3 h-3" /></Button>
          </div>
        )}

        {/* Member cards */}
        {(team || []).map(tm => {
          const wl = getWorkload(tm.user_id);
          const roleInfo = INVESTIGATION_ROLES.find(r => r.value === tm.role) || { label: tm.role, value: tm.role };
          const color = ROLE_COLORS[tm.role] || '#636366';
          return (
            <div key={tm.id || tm.user_id} className="rounded-lg p-3 ds-transition-colors" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', borderRight: `3px solid ${color}` }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--ds-bg-tertiary)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--ds-bg-secondary)'}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0" style={{ background: color, color: 'white' }}>{(tm.user_name || tm.name || '?')[0]}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium" style={{ color: 'var(--ds-text-primary)' }}>{tm.user_name || tm.name}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: `${color}20`, color }}>{roleInfo.label}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>
                    {wl && <span>تحقيقات: {wl.active_investigations}</span>}
                    {wl && wl.pending_evidence > 0 && <span>توثيق: {wl.pending_evidence}</span>}
                    {wl && wl.stalled_investigations > 0 && <span style={{ color: '#ef4444' }}>متوقفة: {wl.stalled_investigations}</span>}
                    {wl && <span className={`px-1 rounded text-[9px] ${wl.vacation_status !== 'active' ? 'bg-purple-100 text-purple-600' : (wl.active_investigations || 0) > 10 ? 'bg-red-100 text-red-600' : ''}`}>
                      {wl.vacation_status !== 'active' ? 'إجازة' : (wl.active_investigations || 0) > 10 ? 'مثقل' : ''}
                    </span>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => handleRemoveTeam(tm.user_id)} style={{ color: '#ef4444' }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}

        {(!team || team.length === 0) && (
          <div className="text-center py-6 text-sm" style={{ color: 'var(--ds-text-muted)' }}>
            <Users className="w-8 h-8 mx-auto mb-2" />
            لا يوجد فريق بعد. أضف أعضاء للتحقيق.
          </div>
        )}
      </div>

      {/* Transfer Ownership */}
      {owner && (
        <div className="rounded-lg p-3" style={{ background: 'var(--ds-bg-secondary)', border: '1px dashed var(--ds-border)' }}>
          <div className="text-xs font-medium mb-2" style={{ color: 'var(--ds-text-muted)' }}>نقل الملكية</div>
          <div className="flex items-center gap-2">
            <select className="flex-1 px-2 py-1.5 rounded text-xs" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
              value={transferTo} onChange={e => setTransferTo(e.target.value)}>
              <option value="">اختر المالك الجديد...</option>
              {users?.filter(u => u.id !== ownerId).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <Button variant="primary" size="sm" onClick={handleTransfer} disabled={!transferTo}>
              <ArrowUpCircle className="w-3.5 h-3.5" />نقل
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
