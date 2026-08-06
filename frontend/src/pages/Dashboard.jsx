import { useState, useEffect } from 'react';
import { api } from '../api';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3, FolderOpen, Clock, AlertTriangle, TrendingUp,
  Activity, Building2, Mail, Target, Sparkles, CheckCircle2,
  Calendar, ArrowRight, FileText, History
} from 'lucide-react';

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} د`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} س`;
  return `منذ ${Math.floor(hrs / 24)} يوم`;
}

const statCards = [
  { key: 'totalCases', label: 'إجمالي القضايا', icon: FolderOpen, color: 'var(--accent)', bg: 'from-[#D4A843]/20 to-transparent' },
  { key: 'openCases', label: 'قضايا مفتوحة', icon: Activity, color: '#3B82F6', bg: 'from-[#3B82F6]/20 to-transparent' },
  { key: 'pending', label: 'بانتظار الرد', icon: Clock, color: '#F59E0B', bg: 'from-[#F59E0B]/20 to-transparent' },
  { key: 'overdue', label: 'متأخرة', icon: AlertTriangle, color: '#EF4444', bg: 'from-[#EF4444]/20 to-transparent' },
  { key: 'totalAgencies', label: 'جهات التواصل', icon: Building2, color: '#8B5CF6', bg: 'from-[#8B5CF6]/20 to-transparent' },
  { key: 'totalRequests', label: 'الطلبات', icon: Target, color: '#10B981', bg: 'from-[#10B981]/20 to-transparent' },
];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.getDashboard().then(setData).catch(() => {});
  }, []);

  // System-wide activity feed -- gated by its own permission (resource
  // 'timeline', action 'view') so an admin decides per-role who sees it,
  // same fail-closed-until-configured convention as every other resource.
  useEffect(() => {
    api.get('/permissions/mine').then(perm => {
      const canView = perm.wildcard || (perm.permissions || []).some(p => p.resource === 'timeline' && p.action === 'view');
      if (canView) api.get('/activity?limit=20').then(d => setTimeline(d.data || [])).catch(() => {});
    }).catch(() => {});
  }, []);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  const stats = {
    totalCases: data.totalCases || 0,
    openCases: data.byStatus?.find(s => s.status === 'open')?.count || 0,
    pending: data.byStatus?.find(s => s.status === 'pending' || s.status === 'in_progress')?.count || 0,
    overdue: data.upcomingDeadlines?.filter(d => d.days_remaining < 0)?.length || 0,
    totalAgencies: data.totalAgencies || 0,
    totalRequests: data.totalRequests || 0,
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>لوحة التحكم</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>FOIA OS — نظام إدارة طلبات السجلات</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/intake')} 
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm transition-all active:scale-[0.97] btn-accent">
            <Sparkles className="w-4 h-4" />
            استقبال ذكي
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map(card => (
          <div key={card.key} className="relative overflow-hidden rounded-2xl p-4 transition-all duration-200 hover:-translate-y-0.5 group"
            style={{
              background: 'linear-gradient(135deg, var(--bg-tertiary), var(--bg-secondary))',
              border: '1px solid var(--border-strong)',
              boxShadow: 'var(--shadow-md)',
            }}>
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-2">
                <card.icon className="w-4 h-4" style={{ color: card.color }} />
                <TrendingUp className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
              </div>
              <p className="text-2xl font-bold mb-0.5" style={{ color: 'var(--text-primary)' }}>{stats[card.key] || 0}</p>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Overdue Responses — requests whose agency never responded by the
          expected date, aggregated system-wide (mirrors the same section
          shown per-case in CaseHeader). */}
      {data.overdueResponses?.length > 0 && (
        <div className="rounded-2xl p-5" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)', boxShadow: 'var(--shadow-md)' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold flex items-center gap-1.5" style={{ color: '#EF4444' }}>
              <AlertTriangle className="w-4 h-4" />
              تخطّى الموعد المتوقع للرد ({data.overdueResponses.length})
            </h2>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {data.overdueResponses.map(r => (
              <div key={r.id} onClick={() => navigate(`/cases/${r.case_id}`)}
                className="shrink-0 text-right rounded-xl p-3 min-w-[180px] cursor-pointer transition-colors"
                style={{ background: 'var(--bg-primary)', border: '1px solid rgba(239,68,68,0.2)' }}
                onMouseOver={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                onMouseOut={e => e.currentTarget.style.background = 'var(--bg-primary)'}>
                <p className="text-xs font-medium truncate mb-1" style={{ color: 'var(--text-primary)' }}>{r.case_title || `قضية #${r.case_id}`}</p>
                <p className="text-[10px] truncate mb-1.5" style={{ color: 'var(--text-muted)' }}>{r.agency_name || 'جهة'}</p>
                <span className="text-[10px] font-medium" style={{ color: '#EF4444' }}>متأخر {r.days_overdue} يوم</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status Distribution + Pipeline Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Status Distribution */}
        <div className="rounded-2xl p-5" style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-strong)',
          boxShadow: 'var(--shadow-md)',
        }}>
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--accent)' }}>حالة القضايا</h2>
          <div className="space-y-3">
            {data.byStatus?.map(s => (
              <div key={s.status} className="flex items-center gap-3">
                <span className="text-xs w-24" style={{ color: 'var(--text-secondary)' }}>
                  {s.status === 'open' ? '🟦 مفتوحة' : s.status === 'in_progress' ? '🟡 قيد التنفيذ' : s.status === 'closed' ? '🟢 مغلقة' : '⬜ ' + s.status}
                </span>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                  <div className="h-full rounded-full transition-all duration-500" 
                    style={{ 
                      width: `${(s.count / (data.totalCases || 1)) * 100}%`,
                      backgroundColor: s.status === 'open' ? '#3B82F6' : s.status === 'in_progress' ? '#F59E0B' : '#10B981'
                    }} />
                </div>
                <span className="text-xs w-8 text-left" style={{ color: 'var(--text-muted)' }}>{s.count}</span>
              </div>
            ))}
          </div>

          {/* Priority Distribution */}
          <h2 className="text-sm font-semibold mt-5 mb-3" style={{ color: 'var(--accent)' }}>الأولوية</h2>
          <div className="flex gap-3">
            {data.byPriority?.map(p => (
              <div key={p.priority} className="flex-1 p-3 rounded-xl text-center" style={{ background: 'var(--bg-primary)' }}>
                <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{p.count}</p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  {p.priority === 'high' ? '🔴 عاجل' : p.priority === 'medium' ? '🟡 متوسط' : '🟢 منخفض'}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Pipeline Summary */}
        <div className="rounded-2xl p-5" style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-strong)',
          boxShadow: 'var(--shadow-md)',
        }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>توزيع خط الإنتاج</h2>
            <button onClick={() => navigate('/pipeline')} className="flex items-center gap-1 text-[10px] transition-colors"
              style={{ color: 'var(--text-muted)' }}>
              عرض الكل <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-2.5">
            {data.pipelineCounts?.length > 0 ? data.pipelineCounts.map(p => {
              const total = p.task_count + p.request_count;
              return (
                <div key={p.id} className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                  <span className="text-xs flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{p.name_ar}</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{total}</span>
                </div>
              );
            }) : (
              <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>لا توجد بيانات</p>
            )}
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-2 mt-4">
            <div className="p-3 rounded-xl" style={{ background: 'var(--bg-primary)' }}>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>الجهات</p>
              <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{data.totalAgencies || 0}</p>
            </div>
            <div className="p-3 rounded-xl" style={{ background: 'var(--bg-primary)' }}>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>الطلبات</p>
              <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{data.totalRequests || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Cases + Deadlines */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Cases */}
        <div className="rounded-2xl p-5" style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-strong)',
          boxShadow: 'var(--shadow-md)',
        }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>أحدث القضايا</h2>
            <button onClick={() => navigate('/cases')} className="flex items-center gap-1 text-[10px] transition-colors"
              style={{ color: 'var(--text-muted)' }}>
              عرض الكل <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {data.recentCases?.length > 0 ? (
            <div className="space-y-2">
              {data.recentCases.slice(0, 5).map(c => (
                <div key={c.id} onClick={() => navigate(`/cases/${c.id}`)}
                  className="flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-colors"
                  style={{ background: 'var(--bg-primary)' }}
                  onMouseOver={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                  onMouseOut={e => e.currentTarget.style.background = 'var(--bg-primary)'}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-[9px] font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>#{c.id}</span>
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{c.title}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium`}
                      style={{
                        background: c.priority === 'high' ? 'rgba(239,68,68,0.1)' : c.priority === 'medium' ? 'rgba(245,158,11,0.1)' : 'rgba(59,130,246,0.1)',
                        color: c.priority === 'high' ? '#EF4444' : c.priority === 'medium' ? '#F59E0B' : '#3B82F6',
                      }}>
                      {c.priority === 'high' ? 'عاجل' : c.priority === 'medium' ? 'متوسط' : 'منخفض'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center py-8">
              <FileText className="w-8 h-8 mb-2" style={{ color: 'var(--text-muted)' }} />
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>لا توجد قضايا بعد</p>
              <button onClick={() => navigate('/intake')} className="mt-3 text-xs hover:underline" style={{ color: 'var(--accent)' }}>أنشئ أول قضية</button>
            </div>
          )}
        </div>

        {/* Upcoming Deadlines */}
        <div className="rounded-2xl p-5" style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-strong)',
          boxShadow: 'var(--shadow-md)',
        }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>المواعيد النهائية القادمة</h2>
            <Calendar className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          </div>
          {data.upcomingDeadlines?.length > 0 ? (
            <div className="space-y-2">
              {data.upcomingDeadlines.slice(0, 5).map(d => (
                <div key={d.id} onClick={() => navigate(`/cases/${d.id}`)}
                  className="flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-colors" style={{ background: 'var(--bg-primary)' }}
                  onMouseOver={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                  onMouseOut={e => e.currentTarget.style.background = 'var(--bg-primary)'}>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{d.title}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{d.deadline}</p>
                  </div>
                  <span className={`text-[10px] shrink-0`} style={{
                    color: d.days_remaining < 0 ? '#EF4444' : d.days_remaining <= 3 ? '#F59E0B' : 'var(--text-muted)'
                  }}>
                    {d.days_remaining < 0 ? `متأخرة ${Math.abs(d.days_remaining)} يوم` : `${d.days_remaining} يوم`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center py-8">
              <CheckCircle2 className="w-8 h-8 mb-2" style={{ color: 'var(--text-muted)' }} />
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>لا توجد مواعيد نهائية</p>
            </div>
          )}
        </div>
      </div>

      {/* Recent Communications */}
      <div className="rounded-2xl p-5" style={{
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-strong)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
      }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>آخر المراسلات</h2>
          <Mail className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        </div>
        {data.recentCommunications?.length > 0 ? (
          <div className="space-y-1">
            {data.recentCommunications.slice(0, 5).map(comm => (
              <div key={comm.id} onClick={() => navigate(`/cases/${comm.case_id}`)}
                className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors"
                style={{ color: 'var(--text-secondary)', background: 'var(--bg-primary)' }}
                onMouseOver={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                onMouseOut={e => e.currentTarget.style.background = 'var(--bg-primary)'}>
                <span className="text-xs">{comm.direction === 'outbound' ? '📤' : '📥'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{comm.subject || 'بدون موضوع'}</p>
                  <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{comm.case_title || `قضية #${comm.case_id}`}</p>
                </div>
                <span className="text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>{comm.created_at?.substring(0, 10)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>لا توجد مراسلات</p>
        )}
      </div>

      {/* Timeline — system-wide activity feed. Only rendered for roles
          granted resource 'timeline' action 'view' (see useEffect above);
          absent entirely otherwise, not just visually hidden. */}
      {timeline && (
        <div className="rounded-2xl p-5" style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-strong)',
          boxShadow: 'var(--shadow-md)',
        }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>الخط الزمني الشامل</h2>
            <History className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          </div>
          {timeline.length > 0 ? (
            <div className="space-y-1">
              {timeline.map(log => (
                <div key={log.id} onClick={() => log.target_type === 'case' && navigate(`/cases/${log.target_id}`)}
                  className={`flex items-center gap-3 p-2.5 rounded-xl transition-colors ${log.target_type === 'case' ? 'cursor-pointer' : ''}`}
                  style={{ background: 'var(--bg-primary)' }}
                  onMouseOver={e => log.target_type === 'case' && (e.currentTarget.style.background = 'var(--bg-elevated)')}
                  onMouseOut={e => e.currentTarget.style.background = 'var(--bg-primary)'}>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{log.target_title || log.action_type}</p>
                    <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{log.user_name || 'النظام'}</p>
                  </div>
                  <span className="text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>{timeAgo(log.created_at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>لا توجد أنشطة بعد</p>
          )}
        </div>
      )}
    </div>
  );
}
