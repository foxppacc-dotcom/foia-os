import { useState, useEffect } from 'react';
import { api } from '../api';
import { useNavigate } from 'react-router-dom';
import { 
  BarChart3, FolderOpen, Clock, AlertTriangle, TrendingUp, 
  Activity, Building2, Mail, Target, Sparkles, CheckCircle2,
  Calendar, ArrowRight, FileText
} from 'lucide-react';

const statCards = [
  { key: 'totalCases', label: 'إجمالي القضايا', icon: FolderOpen, color: '#D4A843', bg: 'from-[#D4A843]/20 to-transparent' },
  { key: 'openCases', label: 'قضايا مفتوحة', icon: Activity, color: '#3B82F6', bg: 'from-[#3B82F6]/20 to-transparent' },
  { key: 'pending', label: 'بانتظار الرد', icon: Clock, color: '#F59E0B', bg: 'from-[#F59E0B]/20 to-transparent' },
  { key: 'overdue', label: 'متأخرة', icon: AlertTriangle, color: '#EF4444', bg: 'from-[#EF4444]/20 to-transparent' },
  { key: 'totalAgencies', label: 'جهات التواصل', icon: Building2, color: '#8B5CF6', bg: 'from-[#8B5CF6]/20 to-transparent' },
  { key: 'totalRequests', label: 'الطلبات', icon: Target, color: '#10B981', bg: 'from-[#10B981]/20 to-transparent' },
];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.getDashboard().then(setData).catch(() => {});
  }, []);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#D4A843] border-t-transparent rounded-full animate-spin" />
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
          <h1 className="text-xl font-bold text-white">لوحة التحكم</h1>
          <p className="text-xs text-gray-600 mt-0.5">FOIA OS — نظام إدارة طلبات السجلات</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/intake')} className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm bg-gradient-to-r from-[#D4A843] to-[#e4b84a] text-[#0A0A0F] hover:shadow-lg transition-all active:scale-[0.97]">
            <Sparkles className="w-4 h-4" />
            استقبال ذكي
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-6 gap-4">
        {statCards.map(card => (
          <div key={card.key} className="relative overflow-hidden bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl p-4 hover:border-[#D4A84330] transition-all duration-300 group">
            <div className="absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity" style={{ backgroundImage: `linear-gradient(135deg, ${card.color}10, transparent)` }} />
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <card.icon className="w-4 h-4" style={{ color: card.color }} />
                <TrendingUp className="w-3 h-3 text-gray-700" />
              </div>
              <p className="text-2xl font-bold text-white mb-0.5">{stats[card.key] || 0}</p>
              <p className="text-[10px] text-gray-500">{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Status Distribution + Pipeline Summary */}
      <div className="grid grid-cols-2 gap-4">
        {/* Status Distribution */}
        <div className="bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-[#D4A843] mb-4">حالة القضايا</h2>
          <div className="space-y-3">
            {data.byStatus?.map(s => (
              <div key={s.status} className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-24">{s.status === 'open' ? '🟦 مفتوحة' : s.status === 'in_progress' ? '🟡 قيد التنفيذ' : s.status === 'closed' ? '🟢 مغلقة' : '⬜ ' + s.status}</span>
                <div className="flex-1 h-2 rounded-full bg-[#1a1a2e] overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" 
                    style={{ 
                      width: `${(s.count / (data.totalCases || 1)) * 100}%`,
                      backgroundColor: s.status === 'open' ? '#3B82F6' : s.status === 'in_progress' ? '#F59E0B' : '#10B981'
                    }} />
                </div>
                <span className="text-xs text-gray-500 w-8 text-left">{s.count}</span>
              </div>
            ))}
          </div>

          {/* Priority Distribution */}
          <h2 className="text-sm font-semibold text-[#D4A843] mt-5 mb-3">الأولوية</h2>
          <div className="flex gap-3">
            {data.byPriority?.map(p => (
              <div key={p.priority} className="flex-1 p-3 rounded-xl bg-[#0A0A0F] text-center">
                <p className="text-lg font-bold text-white">{p.count}</p>
                <p className="text-[10px] text-gray-500 mt-1">
                  {p.priority === 'high' ? '🔴 عاجل' : p.priority === 'medium' ? '🟡 متوسط' : '🟢 منخفض'}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Pipeline Summary */}
        <div className="bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[#D4A843]">توزيع خط الإنتاج</h2>
            <button onClick={() => navigate('/pipeline')} className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-white transition-colors">
              عرض الكل <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-2.5">
            {data.pipelineCounts?.length > 0 ? data.pipelineCounts.map(p => {
              const total = p.task_count + p.request_count;
              return (
                <div key={p.id} className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                  <span className="text-xs text-gray-400 flex-1 truncate">{p.name_ar}</span>
                  <span className="text-[10px] text-gray-600">{total}</span>
                </div>
              );
            }) : (
              <p className="text-xs text-gray-600 text-center py-4">لا توجد بيانات</p>
            )}
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-2 mt-4">
            <div className="p-3 rounded-xl bg-[#0A0A0F]">
              <p className="text-[10px] text-gray-500">الجهات</p>
              <p className="text-lg font-bold text-white">{data.totalAgencies || 0}</p>
            </div>
            <div className="p-3 rounded-xl bg-[#0A0A0F]">
              <p className="text-[10px] text-gray-500">الطلبات</p>
              <p className="text-lg font-bold text-white">{data.totalRequests || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Cases + Deadlines */}
      <div className="grid grid-cols-2 gap-4">
        {/* Recent Cases */}
        <div className="bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[#D4A843]">أحدث القضايا</h2>
            <button onClick={() => navigate('/cases')} className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-white transition-colors">
              عرض الكل <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {data.recentCases?.length > 0 ? (
            <div className="space-y-2">
              {data.recentCases.slice(0, 5).map(c => (
                <div key={c.id} onClick={() => navigate(`/cases/${c.id}`)} className="flex items-center justify-between p-2.5 rounded-xl bg-[#0A0A0F] hover:bg-[#1a1a2e] cursor-pointer transition-colors">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-[9px] font-mono text-gray-600 shrink-0">#{c.id}</span>
                    <p className="text-xs text-white font-medium truncate">{c.title}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                      c.priority === 'high' ? 'bg-[#EF4444]/10 text-[#EF4444]' : 
                      c.priority === 'medium' ? 'bg-[#F59E0B]/10 text-[#F59E0B]' : 
                      'bg-[#3B82F6]/10 text-[#3B82F6]'
                    }`}>
                      {c.priority === 'high' ? 'عاجل' : c.priority === 'medium' ? 'متوسط' : 'منخفض'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center py-8">
              <FileText className="w-8 h-8 text-gray-700 mb-2" />
              <p className="text-xs text-gray-600">لا توجد قضايا بعد</p>
              <button onClick={() => navigate('/intake')} className="mt-3 text-xs text-[#D4A843] hover:underline">أنشئ أول قضية</button>
            </div>
          )}
        </div>

        {/* Upcoming Deadlines */}
        <div className="bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[#D4A843]">المواعيد النهائية القادمة</h2>
            <Calendar className="w-4 h-4 text-gray-600" />
          </div>
          {data.upcomingDeadlines?.length > 0 ? (
            <div className="space-y-2">
              {data.upcomingDeadlines.slice(0, 5).map(d => (
                <div key={d.id} className="flex items-center justify-between p-2.5 rounded-xl bg-[#0A0A0F]">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-white truncate">{d.title}</p>
                    <p className="text-[10px] text-gray-600 mt-0.5">{d.deadline}</p>
                  </div>
                  <span className={`text-[10px] shrink-0 ${
                    d.days_remaining < 0 ? 'text-[#EF4444]' : 
                    d.days_remaining <= 3 ? 'text-[#F59E0B]' : 'text-gray-500'
                  }`}>
                    {d.days_remaining < 0 ? `متأخرة ${Math.abs(d.days_remaining)} يوم` : `${d.days_remaining} يوم`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center py-8">
              <CheckCircle2 className="w-8 h-8 text-gray-700 mb-2" />
              <p className="text-xs text-gray-600">لا توجد مواعيد نهائية</p>
            </div>
          )}
        </div>
      </div>

      {/* Recent Communications */}
      <div className="bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[#D4A843]">آخر المراسلات</h2>
          <Mail className="w-4 h-4 text-gray-600" />
        </div>
        {data.recentCommunications?.length > 0 ? (
          <div className="space-y-1">
            {data.recentCommunications.slice(0, 5).map(comm => (
              <div key={comm.id} onClick={() => navigate(`/cases/${comm.case_id}`)} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-[#1a1a2e] cursor-pointer transition-colors">
                <span className="text-xs">{comm.direction === 'outbound' ? '📤' : '📥'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white truncate">{comm.subject || 'بدون موضوع'}</p>
                  <p className="text-[10px] text-gray-600 truncate">{comm.case_title || `قضية #${comm.case_id}`}</p>
                </div>
                <span className="text-[10px] text-gray-600 shrink-0">{comm.created_at?.substring(0, 10)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-600 text-center py-4">لا توجد مراسلات</p>
        )}
      </div>
    </div>
  );
}
