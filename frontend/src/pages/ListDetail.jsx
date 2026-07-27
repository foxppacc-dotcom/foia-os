import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';

const LIST_COLORS = {
  1: '#10B981', 2: '#F59E0B', 3: '#6B7280', 4: '#EF4444',
  5: '#8B5CF6', 6: '#F97316', 7: '#EC4899',
};

const LIST_NAMES = {
  1: '✅ تم استلام السجلات', 2: '💰 مطلوب دفع', 3: '🚫 مفيش سجلات متوفرة',
  4: '⛔ تم الرفض بموجب القانون', 5: '⚖️ القضية مفتوحة في المحكمة',
  6: '📷 الوكالة لا تستخدم البودي كام', 7: '🆔 محتاج تأكيد مواطنة',
};

export default function ListDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/pipeline/lists/${id}`).then(d => {
      setData(d.data || {});
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  if (loading || !data) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-10 h-10 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
    </div>
  );

  const color = data.color || LIST_COLORS[id] || '#6B7280';
  const listName = data.name_ar || LIST_NAMES[id] || 'قائمة';

  return (
    <div className="space-y-6 animate-fadeIn max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/pipeline')}
          className="p-2 rounded-xl" style={{ color: 'var(--text-secondary)' }}>←</button>
        <div className="w-4 h-4 rounded-full" style={{ background: color }} />
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{listName}</h1>
        <span className="px-2.5 py-1 rounded-lg font-bold" style={{ background: color + '20', color }}>
          {data.requests?.length || 0} بطاقة
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* بطاقات القائمة */}
        <div className="md:col-span-2 space-y-3">
          <h2 className="font-bold" style={{ color: 'var(--text-primary)' }}>📋 البطاقات</h2>
          {(data.requests || []).length === 0 ? (
            <div className="p-8 rounded-xl border text-center" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
              <p style={{ color: 'var(--text-muted)' }}>لا توجد بطاقات في هذه القائمة</p>
            </div>
          ) : (data.requests || []).map(r => (
            <div key={r.id} onClick={() => r.case_id && navigate(`/cases/${r.case_id}`)}
              className="p-4 rounded-xl border cursor-pointer transition-all"
              style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
              onMouseOver={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
              onMouseOut={e => e.currentTarget.style.background = 'var(--bg-secondary)'}>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono font-bold" style={{ color, fontSize: '1rem' }}>#{r.case_id || r.id}</span>
                {r.case_priority === 'high' && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: '#EF444420', color: '#EF4444' }}>🔴 عاجل</span>
                )}
              </div>
              <p className="font-bold" style={{ color: 'var(--text-primary)' }}>{r.case_title || r.title || 'بدون عنوان'}</p>
              <div className="flex items-center gap-3 mt-1">
                {r.agency_name_ar && <span style={{ color: 'var(--text-muted)' }}>🏛️ {r.agency_name_ar}</span>}
                {r.sent_date && <span style={{ color: 'var(--text-muted)' }}>📅 {new Date(r.sent_date).toLocaleDateString('ar-EG')}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* فريق العمل + النشاط */}
        <div className="space-y-4">
          {/* فريق القائمة */}
          <div className="p-5 rounded-xl border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
            <h2 className="font-bold mb-3" style={{ color: 'var(--accent)' }}>👥 فريق العمل</h2>
            {(data.assignees || []).length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>لم يتم تعيين فريق</p>
            ) : (data.assignees || []).map(a => (
              <div key={a.id} className="flex items-center gap-2 py-1.5">
                <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs"
                  style={{ background: color + '20', color }}>{a.name?.charAt(0)}</div>
                <div>
                  <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{a.name}</p>
                  <p style={{ color: 'var(--text-muted)' }}>{a.role === 'admin' ? 'مدير' : 'عضو'}</p>
                </div>
              </div>
            ))}
          </div>

          {/* النشاط */}
          <div className="p-5 rounded-xl border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
            <h2 className="font-bold mb-3" style={{ color: 'var(--accent)' }}>📋 النشاط</h2>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {(data.activity || []).length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>لا يوجد نشاط مسجل</p>
              ) : (data.activity || []).map(a => (
                <div key={a.id} className="py-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{a.details || a.action_type}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{a.created_at}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
