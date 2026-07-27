import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { Phone, IdCard, Edit3, Save, X, LogIn, LogOut, ListTodo, Clock, Bell, BarChart3 } from 'lucide-react';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Tabs from '../components/ui/Tabs';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';

const PROFILE_TABS = [
  { key: 'tasks', label: 'المهام' },
  { key: 'attendance', label: 'الحضور' },
  { key: 'notifications', label: 'الإشعارات' },
  { key: 'kpi', label: 'مؤشرات الأداء' },
];

const ROLE_LABEL = { admin: 'مدير النظام', manager: 'مدير', agent: 'وكيل' };

export default function Profile() {
  const { id } = useParams();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [activeTab, setActiveTab] = useState('tasks');
  const [todayAttendance, setTodayAttendance] = useState(null);

  const fetchProfile = () => {
    api.get(`/profile/${id || 1}`).then(d => {
      setProfile(d);
      setForm({ name: d.user.name, phone: d.user.phone || '', job_title: d.user.job_title || '', department: d.user.department || '', bio: d.user.bio || '' });
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(() => { fetchProfile(); }, [id]);

  const checkToday = () => {
    const today = new Date().toISOString().split('T')[0];
    const rec = profile?.attendance?.find(a => a.date === today || a.date?.startsWith?.(today));
    setTodayAttendance(rec || null);
  };
  useEffect(() => { if (profile) checkToday(); }, [profile]);

  const handleCheckIn = async () => {
    try { await api.post('/attendance/check-in'); fetchProfile(); }
    catch (e) { alert('❌ ' + e.message); }
  };
  const handleCheckOut = async () => {
    try { await api.put('/attendance/check-out'); fetchProfile(); }
    catch (e) { alert('❌ ' + e.message); }
  };

  const saveProfile = async () => {
    try {
      await api.put(`/profile/${id || 1}`, form);
      setEditing(false);
      fetchProfile();
    } catch (e) { alert('❌ ' + e.message); }
  };

  const updateTaskStatus = async (taskId, status) => {
    try { await api.put(`/tasks/${taskId}/status`, { status }); fetchProfile(); }
    catch (e) { alert('❌ ' + e.message); }
  };

  const markAllRead = async () => {
    try { await api.put('/notifications/read-all'); fetchProfile(); }
    catch {}
  };

  if (loading) return <Spinner full />;
  if (!profile) return <EmptyState title="الملف الشخصي غير موجود" />;

  const u = profile.user;
  const kpi = profile.kpi || {};

  return (
    <div className="space-y-6 animate-fadeIn max-w-5xl mx-auto">
      <Card>
        <div className="flex items-start gap-5 flex-wrap">
          <div className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-extrabold shrink-0" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
            {u.name?.charAt(0) || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-3 max-w-lg">
                <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="الاسم" />
                <Input value={form.job_title} onChange={e => setForm({...form, job_title: e.target.value})} placeholder="المسمى الوظيفي" />
                <Input value={form.department} onChange={e => setForm({...form, department: e.target.value})} placeholder="القسم" />
                <Input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="رقم الهاتف" />
                <textarea value={form.bio} onChange={e => setForm({...form, bio: e.target.value})} placeholder="نبذة مختصرة" rows={3}
                  className="w-full p-2.5 rounded-xl border text-sm resize-none outline-none" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }} />
                <div className="flex gap-2">
                  <Button icon={Save} onClick={saveProfile}>حفظ</Button>
                  <Button variant="secondary" icon={X} onClick={() => setEditing(false)}>إلغاء</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{u.name}</h1>
                  <Badge variant="accent">{u.job_title || '—'}</Badge>
                  <button onClick={() => setEditing(true)} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}
                    onMouseOver={e => e.currentTarget.style.color = 'var(--accent)'} onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}>
                    <Edit3 className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{u.department || '—'} · {u.email}</p>
                <div className="flex items-center gap-3 text-sm mt-1.5 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                  {u.phone && <span className="inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{u.phone}</span>}
                  {u.employee_id && <span className="inline-flex items-center gap-1"><IdCard className="w-3.5 h-3.5" />{u.employee_id}</span>}
                  <span>{ROLE_LABEL[u.role] || 'مشاهد'}</span>
                </div>
                {u.bio && <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>{u.bio}</p>}
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-center shrink-0">
            {[
              { v: kpi.tasks_completed || 0, l: 'مهام منجزة', c: 'var(--success)' },
              { v: kpi.overdue_tasks || 0, l: 'متأخرة', c: 'var(--warning)' },
              { v: `${kpi.completion_rate || 0}%`, l: 'إنجاز', c: 'var(--info)' },
              { v: kpi.present_days || 0, l: 'حضور', c: '#8B5CF6' },
            ].map((s, i) => (
              <div key={i} className="px-3 py-2.5 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                <p className="text-lg font-bold" style={{ color: s.c }}>{s.v}</p>
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{s.l}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Tabs tabs={PROFILE_TABS} active={activeTab} onChange={setActiveTab} />

      {activeTab === 'tasks' && (
        <Card title={`المهام الموكلة (${profile.tasks?.length || 0})`} icon={<ListTodo className="w-4 h-4" style={{ color: 'var(--accent)' }} />}>
          {profile.tasks?.length === 0 ? <EmptyState compact title="لا توجد مهام" /> : (
            <div className="space-y-2">
              {profile.tasks.map(task => (
                <div key={task.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--bg-tertiary)' }}>
                  <input type="checkbox" checked={task.status === 'completed'}
                    onChange={() => updateTaskStatus(task.id, task.status === 'completed' ? 'pending' : 'completed')}
                    className="w-4 h-4 rounded shrink-0" style={{ accentColor: 'var(--accent)' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{task.title}</p>
                    <div className="flex items-center gap-2 text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      <Badge variant={task.status === 'completed' ? 'success' : task.status === 'in_progress' ? 'warning' : 'neutral'}>
                        {task.status === 'completed' ? 'مكتملة' : task.status === 'in_progress' ? 'جاري' : 'معلقة'}
                      </Badge>
                      {task.due_date && <span>{task.due_date.substring(0, 10)}</span>}
                      {task.overdue && <span style={{ color: 'var(--danger)' }}>متأخرة</span>}
                    </div>
                  </div>
                  <Badge variant={task.priority === 'urgent' ? 'danger' : task.priority === 'high' ? 'warning' : 'info'}>
                    {task.priority === 'urgent' ? 'عاجل' : task.priority === 'high' ? 'عالية' : 'عادية'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'attendance' && (
        <Card title="الحضور والانصراف" icon={<Clock className="w-4 h-4" style={{ color: '#8B5CF6' }} />}
          actions={
            !todayAttendance?.check_in ? (
              <Button size="sm" icon={LogIn} style={{ background: 'var(--success)', color: 'white' }} onClick={handleCheckIn}>تسجيل دخول</Button>
            ) : !todayAttendance?.check_out ? (
              <Button size="sm" icon={LogOut} style={{ background: 'var(--danger)', color: 'white' }} onClick={handleCheckOut}>تسجيل خروج</Button>
            ) : <Badge variant="success">تم التسجيل اليوم</Badge>
          }>
          {todayAttendance && (
            <div className="p-3 rounded-xl mb-4" style={{ background: 'var(--bg-tertiary)' }}>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>اليوم: {new Date().toLocaleDateString('ar-SA')}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                دخول: {todayAttendance.check_in ? new Date(todayAttendance.check_in).toLocaleTimeString('ar-SA') : '—'}
                {todayAttendance.check_out ? ` | خروج: ${new Date(todayAttendance.check_out).toLocaleTimeString('ar-SA')}` : ' | لم يتم تسجيل الخروج بعد'}
              </p>
            </div>
          )}
          <div className="grid grid-cols-7 gap-1.5 text-center">
            {Array.from({ length: 30 }, (_, i) => {
              const d = new Date(); d.setDate(d.getDate() - 29 + i);
              const dateStr = d.toISOString().split('T')[0];
              const rec = profile.attendance?.find(a => a.date === dateStr);
              return (
                <div key={i} className="p-1.5 rounded-lg text-xs" style={{
                  background: rec?.check_in ? (rec?.check_out ? 'var(--success-subtle)' : 'var(--warning-subtle)') : 'var(--bg-tertiary)',
                  color: rec?.check_in ? (rec?.check_out ? 'var(--success)' : 'var(--warning)') : 'var(--text-muted)',
                }}>
                  <p>{d.getDate()}</p>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {activeTab === 'notifications' && (
        <Card title="الإشعارات" icon={<Bell className="w-4 h-4" style={{ color: 'var(--accent)' }} />}
          actions={<>
            {profile.unreadCount > 0 && <Badge variant="accent">{profile.unreadCount}</Badge>}
            {profile.unreadCount > 0 && <button onClick={markAllRead} className="text-xs" style={{ color: 'var(--accent)' }}>قراءة الكل</button>}
          </>}>
          {profile.notifications?.length === 0 ? <EmptyState compact title="لا توجد إشعارات" /> : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {profile.notifications.map(n => (
                <div key={n.id} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: n.is_read ? 'transparent' : 'var(--accent-subtle)' }}>
                  <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: n.is_read ? 'var(--text-muted)' : 'var(--accent)' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{n.title}</p>
                    {n.body && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{n.body}</p>}
                    <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>{n.created_at?.substring(0, 16) || ''}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'kpi' && (
        <Card title="مؤشرات الأداء" icon={<BarChart3 className="w-4 h-4" style={{ color: 'var(--accent)' }} />}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'إجمالي المهام', value: kpi.total_tasks || 0, color: 'var(--text-secondary)' },
              { label: 'مكتملة', value: kpi.completed_tasks || 0, color: 'var(--success)' },
              { label: 'متأخرة', value: kpi.overdue_tasks || 0, color: 'var(--danger)' },
              { label: 'نسبة الإنجاز', value: `${kpi.completion_rate || 0}%`, color: 'var(--info)' },
              { label: 'الالتزام بالمواعيد', value: `${kpi.on_time_rate || 0}%`, color: '#8B5CF6' },
              { label: 'أيام الحضور', value: kpi.present_days || 0, color: 'var(--success)' },
              { label: 'أيام الغياب', value: kpi.absent_days || 0, color: 'var(--danger)' },
              { label: 'المهام العاجلة', value: kpi.urgent_tasks || 0, color: 'var(--warning)' },
            ].map((k, i) => (
              <div key={i} className="p-4 rounded-xl border text-center" style={{ borderColor: 'var(--border)' }}>
                <p className="text-2xl font-bold" style={{ color: k.color }}>{k.value}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
