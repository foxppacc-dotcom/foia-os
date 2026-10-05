import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Clock, AlertTriangle, XCircle } from 'lucide-react';
import { api } from '../api';
import { formatArabicDate, formatArabicDateTime } from '../utils/formatDate';

// "المهام" -- two separate views:
// 1) "طلباتي" -- every reminder/follow-up/to-do the current user has asked
//    the AI assistant to track (aiTools.js's set_reminder/log_requested_task),
//    unioned from two backing tables (GET /ai/tasks tags each row with
//    `kind`): 'case' (case_tasks, day-granularity, notifies the whole case
//    team) and 'personal' (ai_requested_tasks, minute-precision or no due
//    time at all, notifies only this user). Whether it's actually notified
//    yet (notified_at) is the "result" the user explicitly asked to see here,
//    separate from the notification bell itself.
// 2) "تنظيمه الداخلي" -- read-only: how the assistant organized its own
//    breakdown of a complex task (GET /ai/self-organization), never mixed
//    with the user's own requests above.
// Shared by the full-page AI assistant chat；kept as its own component since
// the widget's small panel has no room for it.
export default function AITasksPanel({ toast }) {
  const navigate = useNavigate();
  const [view, setView] = useState('mine'); // 'mine' | 'self'
  const [tasks, setTasks] = useState([]);
  const [selfNotes, setSelfNotes] = useState('');
  const [recurring, setRecurring] = useState(null); // the assistant's real recurring tasks (null = not permitted)
  const [recurringSummary, setRecurringSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(null);

  const fetchTasks = () => {
    setLoading(true);
    api.get('/ai/tasks').then(d => setTasks(d.tasks || [])).catch(e => toast?.error?.(e.message)).finally(() => setLoading(false));
  };
  // "تنظيمه الداخلي" used to be only a free-text notes blob that nothing filled in on its own.
  // It now shows the assistant's REAL recurring tasks (the ones it runs by itself on a
  // schedule) for anyone allowed to see them, with the old notes kept underneath.
  const fetchSelfOrganization = () => {
    setLoading(true);
    Promise.all([
      api.get('/ai/self-organization').then(d => setSelfNotes(d.notes || '')).catch(() => {}),
      api.get('/ai-tasks/tasks').then(d => setRecurring(d.data || [])).catch(() => setRecurring(null)),
      api.get('/ai-tasks/summary').then(d => setRecurringSummary(d.data)).catch(() => setRecurringSummary(null)),
    ]).finally(() => setLoading(false));
  };
  const scheduleText = (t) => {
    if (t.schedule_type === 'daily') return `يوميًا ${t.run_at_time || ''}`;
    const m = t.interval_minutes;
    return m % 60 === 0 ? (m === 60 ? 'كل ساعة' : `كل ${m / 60} ساعات`) : `كل ${m} دقيقة`;
  };
  useEffect(() => { view === 'mine' ? fetchTasks() : fetchSelfOrganization(); }, [view]);

  // 'case'/'personal' rows are marked COMPLETE by the user (they did the
  // thing); 'scheduled_message' rows are CANCELLED instead -- there's
  // nothing to "complete", it either sends automatically or the user
  // pre-empts that by cancelling while still pending.
  const TERMINAL_STATUSES = ['completed', 'sent', 'cancelled', 'failed'];
  const handleAction = async (t) => {
    setCompleting(t.id);
    try {
      if (t.kind === 'scheduled_message') {
        await api.put(`/ai/scheduled-messages/${t.id}/cancel`, {});
      } else {
        await api.put(t.kind === 'personal' ? `/ai/requested-tasks/${t.id}/status` : `/tasks/${t.id}/status`, { status: 'completed' });
      }
      fetchTasks();
    } catch (e) { toast?.error?.(e.message); }
    setCompleting(null);
  };

  const pending = tasks.filter(t => !TERMINAL_STATUSES.includes(t.status));
  const completed = tasks.filter(t => TERMINAL_STATUSES.includes(t.status));

  const renderTask = (t) => {
    const isDone = TERMINAL_STATUSES.includes(t.status);
    const Icon = t.kind === 'scheduled_message' ? XCircle : CheckCircle2;
    const kindLabel = t.kind === 'personal' ? 'شخصي' : t.kind === 'scheduled_message' ? 'رسالة مجدولة' : 'قضية';
    return (
    <div key={`${t.kind}-${t.id}`} className="p-3 rounded-xl flex items-start gap-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
      <button onClick={() => handleAction(t)} disabled={completing === t.id || isDone} title={t.kind === 'scheduled_message' ? 'إلغاء الجدولة' : 'تعليم كمكتمل'} className="shrink-0 mt-0.5">
        <Icon className="w-5 h-5" style={{ color: isDone ? (['cancelled', 'failed'].includes(t.status) ? '#ef4444' : '#22c55e') : 'var(--text-muted)' }} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm" style={{ color: 'var(--text-primary)', textDecoration: isDone ? 'line-through' : 'none' }}>{t.title}</p>
        {t.kind === 'scheduled_message' && (
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{t.description}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          <span className="px-1.5 py-0.5 rounded-md" style={{ background: 'var(--bg-tertiary)' }}>{kindLabel}</span>
          {t.case_title && (
            <button onClick={() => navigate(`/cases/${t.case_id}`)} className="underline" style={{ color: 'var(--accent)' }}>
              {t.case_title}
            </button>
          )}
          {t.due_date && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />{t.kind === 'case' ? formatArabicDate(t.due_date) : formatArabicDateTime(t.due_date)}
            </span>
          )}
          {t.overdue && (
            <span className="flex items-center gap-1" style={{ color: '#ef4444' }}>
              <AlertTriangle className="w-3 h-3" />متأخر
            </span>
          )}
        </div>
        {/* النتيجة -- هل حصل فعليًا (تنبيه/إرسال) ولا لسه */}
        <p className="text-[11px] mt-1" style={{ color: t.notified_at ? '#22c55e' : 'var(--text-muted)' }}>
          {t.status === 'completed' ? `✅ تم الإنجاز${t.completed_at ? ` — ${formatArabicDateTime(t.completed_at)}` : ''}`
            : t.status === 'sent' ? `📨 تم الإرسال فعليًا — ${formatArabicDateTime(t.notified_at)}`
            : t.status === 'cancelled' ? '❌ تم الإلغاء'
            : t.status === 'failed' ? '⚠️ فشل الإرسال'
            : t.notified_at ? `🔔 ${t.kind === 'personal' ? 'تم تنبيهك' : 'تم تنبيه الفريق'} — ${formatArabicDateTime(t.notified_at)}`
            : t.kind === 'scheduled_message' ? 'بانتظار موعد الإرسال التلقائي'
            : t.due_date ? 'بانتظار موعد التذكير' : 'مهمة بلا موعد تنبيه'}
        </p>
      </div>
    </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex gap-1.5 p-3 pb-0 shrink-0">
        <button onClick={() => setView('mine')} className="px-3 py-1.5 rounded-xl text-xs font-medium"
          style={{ background: view === 'mine' ? 'var(--accent)' : 'var(--bg-tertiary)', color: view === 'mine' ? 'white' : 'var(--text-secondary)' }}>
          طلباتي
        </button>
        <button onClick={() => setView('self')} className="px-3 py-1.5 rounded-xl text-xs font-medium"
          style={{ background: view === 'self' ? 'var(--accent)' : 'var(--bg-tertiary)', color: view === 'self' ? 'white' : 'var(--text-secondary)' }}>
          تنظيمه الداخلي
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>...جارٍ التحميل</div>
      ) : view === 'mine' ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>قيد الانتظار ({pending.length})</p>
            {pending.length === 0 ? (
              <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>لا توجد مهام/تذكيرات مطلوبة من المساعد حاليًا.</p>
            ) : <div className="space-y-2">{pending.map(renderTask)}</div>}
          </div>
          {completed.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>مكتملة ({completed.length})</p>
              <div className="space-y-2 opacity-70">{completed.map(renderTask)}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            هذه المهام يشغّلها المساعد بنفسه بشكل دوري نيابةً عن الإدارة (متابعة الطلبات القديمة، التحقق من طلبات الدفع، الردود الضائعة...)، وما يجده يظهر في صفحة «مهام المساعد».
          </p>
          {recurring === null ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>لا تملك صلاحية عرض مهام المساعد الدورية.</p>
          ) : recurring.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>لا توجد مهام دورية بعد.</p>
          ) : (
            <>
              {recurringSummary && <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{recurringSummary.open} أمر مفتوح يحتاج انتباه · تعامل الفريق مع {recurringSummary.handled_by_team_7d} آخر 7 أيام</p>}
              <div className="space-y-2">
                {recurring.map(t => (
                  <div key={t.id} className="p-3 rounded-xl text-sm" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', opacity: t.enabled ? 1 : 0.6 }}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{t.title}</p>
                      {t.open_findings > 0 && <span className="px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0" style={{ background: t.critical_findings ? 'var(--danger-subtle)' : 'var(--warning-subtle)', color: t.critical_findings ? 'var(--danger)' : 'var(--warning)' }}>{t.open_findings} مفتوح</span>}
                    </div>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                      {t.enabled ? scheduleText(t) : 'متوقفة'}{t.last_run_at ? ` · آخر تشغيل ${formatArabicDateTime(t.last_run_at)}` : ' · لم تعمل بعد'}{t.config?.created_by_ai ? ' · أنشأها المساعد بنفسه' : ''}
                    </p>
                    {Array.isArray(t.config?.plan) && t.config.plan.length > 0 && (
                      <ol className="mt-2 pr-4 space-y-0.5 text-[11px] list-decimal" style={{ color: 'var(--text-secondary)' }}>
                        {t.config.plan.map((s, i) => <li key={i}>{s}</li>)}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={() => navigate('/ai-tasks')} className="w-full py-2 rounded-xl text-xs font-medium" style={{ background: 'var(--accent)', color: 'white' }}>فتح صفحة مهام المساعد</button>
            </>
          )}
          {selfNotes && (
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>ملاحظات المساعد الشخصية على أسلوب عمله</p>
              <div className="p-3 rounded-xl text-sm whitespace-pre-wrap" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>{selfNotes}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
