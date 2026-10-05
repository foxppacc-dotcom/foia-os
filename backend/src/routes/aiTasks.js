const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const { runTask } = require('../services/aiTaskRunner');
const { executeFinding } = require('../services/aiTaskActions');
const { SENSORS } = require('../services/aiSensors');
const { computeNextRunAt, getListMap, getSetting, setSetting, fetchAll, chunk, clip, getLimits, LIMIT_RANGES } = require('../services/aiTaskCommon');

// Recurring AI tasks ("مهام المساعد الدورية"): management view of what the assistant
// runs by itself, what it found, and the one-click approvals. Resource 'ai_tasks'
// with actions view / manage / run / review (admin always passes).
router.use(requireAuth);

const AUTONOMY = ['report_only', 'propose', 'auto_followup'];

function cleanConfig(input, current = {}) {
  const out = { ...current };
  const num = (k, min, max) => { if (input[k] !== undefined) { const n = parseInt(input[k]); if (Number.isFinite(n)) out[k] = Math.min(max, Math.max(min, n)); } };
  num('fallback_days', 1, 120); num('followup_cooldown_days', 1, 60); num('max_candidates', 1, 60); num('batch_size', 1, 8);
  num('grace_hours', 1, 240); num('min_age_hours', 0, 240); num('max_auto_followups', 0, 20); num('rescan_hours', 1, 72);
  return out;
}

// ---------------- tasks ----------------
router.get('/ai-tasks/tasks', requirePermission('ai_tasks', 'view'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { data: tasks, error } = await sup.from('ai_recurring_tasks').select('*').is('deleted_at', null).order('id');
    if (error) throw error;
    const open = await fetchAll(() => sup.from('ai_task_findings').select('task_id, severity').in('status', ['open', 'failed']).order('id'));
    const counts = {};
    for (const f of open) { counts[f.task_id] = counts[f.task_id] || { open: 0, critical: 0 }; counts[f.task_id].open++; if (f.severity === 'critical') counts[f.task_id].critical++; }
    const owners = {};
    const ownerIds = [...new Set((tasks || []).map(t => t.owner_user_id).filter(Boolean))];
    if (ownerIds.length) { const { data: us } = await sup.from('users').select('id, name').in('id', ownerIds); (us || []).forEach(u => { owners[u.id] = u.name; }); }
    res.json({ success: true, data: (tasks || []).map(t => ({ ...t, open_findings: counts[t.id]?.open || 0, critical_findings: counts[t.id]?.critical || 0, owner_name: owners[t.owner_user_id] || null })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ai-tasks/tasks', requirePermission('ai_tasks', 'manage'), async (req, res) => {
  try {
    const sup = getSupabase();
    const b = req.body || {};
    if (!SENSORS[b.sensor] && b.sensor !== 'custom') return res.status(400).json({ error: `نوع الفحص غير مدعوم. المتاح: ${Object.keys(SENSORS).join(', ')}` });
    const title = clip(b.title, 120);
    if (!title) return res.status(400).json({ error: 'عنوان المهمة مطلوب' });
    const autonomy = AUTONOMY.includes(b.autonomy) ? b.autonomy : 'propose';
    const row = {
      sensor: b.sensor, title, description: clip(b.description, 400) || null, instructions: String(b.instructions || '').slice(0, 4000) || null,
      schedule_type: b.schedule_type === 'daily' ? 'daily' : 'interval', interval_minutes: Math.max(5, parseInt(b.interval_minutes) || 360),
      run_at_time: /^\d{1,2}:\d{2}$/.test(b.run_at_time || '') ? b.run_at_time : null, autonomy, config: cleanConfig(b.config || {}),
      owner_user_id: req.user.id, created_by: req.user.id, enabled: b.enabled !== false,
    };
    row.next_run_at = computeNextRunAt(row).toISOString();
    const { data, error } = await sup.from('ai_recurring_tasks').insert(row).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/ai-tasks/tasks/:id', requirePermission('ai_tasks', 'manage'), async (req, res) => {
  try {
    const sup = getSupabase();
    const id = parseInt(req.params.id);
    const { data: task } = await sup.from('ai_recurring_tasks').select('*').eq('id', id).is('deleted_at', null).maybeSingle();
    if (!task) return res.status(404).json({ error: 'المهمة غير موجودة' });
    const b = req.body || {};
    const u = {};
    if (b.title !== undefined) { const t = clip(b.title, 120); if (!t) return res.status(400).json({ error: 'العنوان مطلوب' }); u.title = t; }
    if (b.description !== undefined) u.description = clip(b.description, 400) || null;
    if (b.instructions !== undefined) u.instructions = String(b.instructions || '').slice(0, 4000);
    if (b.enabled !== undefined) u.enabled = !!b.enabled;
    if (b.autonomy !== undefined) { if (!AUTONOMY.includes(b.autonomy)) return res.status(400).json({ error: 'مستوى الاستقلالية غير صالح' }); u.autonomy = b.autonomy; }
    if (b.schedule_type !== undefined) u.schedule_type = b.schedule_type === 'daily' ? 'daily' : 'interval';
    if (b.interval_minutes !== undefined) u.interval_minutes = Math.max(5, parseInt(b.interval_minutes) || 360);
    if (b.run_at_time !== undefined) u.run_at_time = /^\d{1,2}:\d{2}$/.test(b.run_at_time || '') ? b.run_at_time : null;
    if (b.config !== undefined) u.config = cleanConfig(b.config || {}, task.config || {});
    if (b.owner_user_id !== undefined && req.user.role === 'admin') {
      const { data: owner } = await sup.from('users').select('id').eq('id', parseInt(b.owner_user_id)).is('deleted_at', null).maybeSingle();
      if (!owner) return res.status(400).json({ error: 'المستخدم المالك غير موجود' });
      u.owner_user_id = owner.id;
    }
    if (!Object.keys(u).length) return res.status(400).json({ error: 'لا توجد تعديلات' });
    // auto_followup actually sends e-mail to agencies: only an admin may switch it on
    if (u.autonomy === 'auto_followup' && req.user.role !== 'admin') return res.status(403).json({ error: 'تفعيل الإرسال التلقائي للمدير فقط' });
    if (u.schedule_type !== undefined || u.interval_minutes !== undefined || u.run_at_time !== undefined || u.enabled === true) {
      u.next_run_at = computeNextRunAt({ ...task, ...u }).toISOString();
    }
    const { data, error } = await sup.from('ai_recurring_tasks').update(u).eq('id', id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/ai-tasks/tasks/:id', requirePermission('ai_tasks', 'manage'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { error } = await sup.from('ai_recurring_tasks').update({ deleted_at: new Date().toISOString(), enabled: false }).eq('id', parseInt(req.params.id)).is('deleted_at', null);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// run now (background) / preview (sensor only, nothing written)
router.post('/ai-tasks/tasks/:id/run', requirePermission('ai_tasks', 'run'), async (req, res) => {
  const id = parseInt(req.params.id);
  runTask(id, { trigger: 'manual' }).catch(e => console.error('[aiTasks] manual run failed:', e.message));
  res.status(202).json({ success: true, message: 'بدأ التشغيل في الخلفية — تابع «سجل التشغيل»' });
});
router.post('/ai-tasks/tasks/:id/preview', requirePermission('ai_tasks', 'run'), async (req, res) => {
  try { res.json({ success: true, data: await runTask(parseInt(req.params.id), { dryRun: true }) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------- runs ----------------
router.get('/ai-tasks/runs', requirePermission('ai_tasks', 'view'), async (req, res) => {
  try {
    const sup = getSupabase();
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
    let q = sup.from('ai_task_runs').select('*, ai_recurring_tasks!task_id(title, sensor)').order('started_at', { ascending: false }).limit(limit);
    if (req.query.task_id) q = q.eq('task_id', parseInt(req.query.task_id));
    const { data, error } = await q;
    if (error) throw error;
    res.json({ success: true, data: (data || []).map(r => ({ ...r, task_title: r.ai_recurring_tasks?.title, sensor: r.ai_recurring_tasks?.sensor, ai_recurring_tasks: undefined })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------- findings ----------------
router.get('/ai-tasks/findings', requirePermission('ai_tasks', 'view'), async (req, res) => {
  try {
    const sup = getSupabase();
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const status = req.query.status || 'open';
    let q = sup.from('ai_task_findings').select('*', { count: 'exact' }).order('severity_rank', { ascending: true }).order('first_seen_at', { ascending: true }).range(offset, offset + limit - 1);
    if (status === 'open') q = q.in('status', ['open', 'failed']);
    else if (status !== 'all') q = q.eq('status', status);
    if (req.query.task_id) q = q.eq('task_id', parseInt(req.query.task_id));
    if (req.query.severity) q = q.eq('severity', req.query.severity);
    if (req.query.kind) q = q.eq('kind', req.query.kind);
    if (req.query.case_id) q = q.eq('case_id', parseInt(req.query.case_id));
    if (req.query.q) q = q.ilike('title', `%${String(req.query.q).replace(/[%,()]/g, ' ').trim()}%`);
    const { data, count, error } = await q;
    if (error) throw error;
    const rows = data || [];
    const caseIds = [...new Set(rows.map(f => f.case_id).filter(Boolean))];
    const titles = {};
    for (const ids of chunk(caseIds, 150)) { const { data: cs } = await sup.from('cases').select('id, title').in('id', ids); (cs || []).forEach(c => { titles[c.id] = c.title; }); }
    res.json({ success: true, total: count || 0, data: rows.map(f => ({ ...f, case_title: f.case_id ? titles[f.case_id] || null : null })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/ai-tasks/findings/:id', requirePermission('ai_tasks', 'view'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { data: f } = await sup.from('ai_task_findings').select('*').eq('id', parseInt(req.params.id)).maybeSingle();
    if (!f) return res.status(404).json({ error: 'البند غير موجود' });
    let case_title = null;
    if (f.case_id) { const { data: c } = await sup.from('cases').select('title').eq('id', f.case_id).maybeSingle(); case_title = c?.title || null; }
    res.json({ success: true, data: { ...f, case_title } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function loadFinding(req, res) {
  const sup = getSupabase();
  const { data } = await sup.from('ai_task_findings').select('*').eq('id', parseInt(req.params.id)).maybeSingle();
  if (!data) { res.status(404).json({ error: 'البند غير موجود' }); return null; }
  return { sup, finding: data };
}

router.post('/ai-tasks/findings/:id/approve', requirePermission('ai_tasks', 'review'), async (req, res) => {
  try {
    const ctx = await loadFinding(req, res); if (!ctx) return;
    if (!['open', 'failed'].includes(ctx.finding.status)) return res.status(409).json({ error: 'هذا البند لم يعد مفتوحًا' });
    const { draft, params } = req.body || {};
    const result = await executeFinding(ctx.sup, ctx.finding, req.user, { edits: { draft, params } });
    res.json({ success: true, data: result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/ai-tasks/findings/:id/dismiss', requirePermission('ai_tasks', 'review'), async (req, res) => {
  try {
    const ctx = await loadFinding(req, res); if (!ctx) return;
    await ctx.sup.from('ai_task_findings').update({ status: 'dismissed', resolved_at: new Date().toISOString(), resolved_by: req.user.id, resolved_reason: clip(req.body?.reason, 200) || 'dismissed' }).eq('id', ctx.finding.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ai-tasks/findings/:id/resolve', requirePermission('ai_tasks', 'review'), async (req, res) => {
  try {
    const ctx = await loadFinding(req, res); if (!ctx) return;
    await ctx.sup.from('ai_task_findings').update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: req.user.id, resolved_reason: 'manual' }).eq('id', ctx.finding.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ai-tasks/findings/:id/reopen', requirePermission('ai_tasks', 'review'), async (req, res) => {
  try {
    const ctx = await loadFinding(req, res); if (!ctx) return;
    await ctx.sup.from('ai_task_findings').update({ status: 'open', resolved_at: null, resolved_by: null, resolved_reason: null }).eq('id', ctx.finding.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------- summary / KPIs ----------------
router.get('/ai-tasks/summary', requirePermission('ai_tasks', 'view'), async (req, res) => {
  try {
    const sup = getSupabase();
    const all = await fetchAll(() => sup.from('ai_task_findings').select('id, task_id, kind, severity, status, first_seen_at, resolved_at, resolved_reason, case_id').order('id'));
    const open = all.filter(f => f.status === 'open' || f.status === 'failed');
    const bySeverity = { critical: 0, warning: 0, info: 0 };
    const byKind = {};
    for (const f of open) { bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1; byKind[f.kind] = (byKind[f.kind] || 0) + 1; }
    const autoResolved = all.filter(f => f.resolved_reason === 'auto' && f.resolved_at);
    const hours = autoResolved.map(f => (new Date(f.resolved_at) - new Date(f.first_seen_at)) / 3600000).filter(h => h >= 0);
    const avgHours = hours.length ? Math.round(hours.reduce((a, b) => a + b, 0) / hours.length) : null;
    const since = Date.now() - 7 * 86400000;
    const { data: lastRuns } = await sup.from('ai_task_runs').select('id, task_id, status, started_at, summary').order('started_at', { ascending: false }).limit(5);
    const budget = await getSetting(sup, 'llm_budget', {});
    res.json({
      success: true,
      data: {
        open: open.length, by_severity: bySeverity, by_kind: byKind,
        handled_by_team_7d: autoResolved.filter(f => new Date(f.resolved_at).getTime() >= since).length,
        avg_hours_to_handle: avgHours, executed_7d: all.filter(f => f.status === 'executed' && f.resolved_at && new Date(f.resolved_at).getTime() >= since).length,
        last_runs: lastRuns || [], llm_budget: budget,
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------- limits & budget (set by management) ----------------
router.get('/ai-tasks/limits', requirePermission('ai_tasks', 'view'), async (req, res) => {
  try {
    const sup = getSupabase();
    const limits = await getLimits(sup);
    const today = new Date().toISOString().slice(0, 10);
    const b = await getSetting(sup, 'llm_budget', {});
    const { data: cfg } = await sup.from('ai_provider_configs').select('daily_request_count, daily_count_reset_at').eq('is_active', true).is('deleted_at', null).maybeSingle();
    const { count: customCount } = await sup.from('ai_recurring_tasks').select('id', { count: 'exact', head: true }).eq('sensor', 'custom').is('deleted_at', null);
    res.json({ success: true, data: { limits, ranges: LIMIT_RANGES, usage: { tasks_llm_calls_today: b.date === today ? (b.count || 0) : 0, all_requests_today: cfg && cfg.daily_count_reset_at === today ? (cfg.daily_request_count || 0) : 0, custom_tasks: customCount || 0 } } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/ai-tasks/limits', requirePermission('ai_tasks', 'manage'), async (req, res) => {
  try {
    const sup = getSupabase();
    const current = await getLimits(sup);
    const next = { ...current };
    for (const k of Object.keys(LIMIT_RANGES)) {
      if (req.body?.[k] === undefined) continue;
      const n = parseInt(req.body[k]);
      const [min, max] = LIMIT_RANGES[k];
      if (!Number.isFinite(n) || n < min || n > max) return res.status(400).json({ error: `القيمة غير صالحة لـ ${k} (من ${min} إلى ${max})` });
      next[k] = n;
    }
    await setSetting(sup, 'limits', next);
    res.json({ success: true, data: next });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------- pipeline-list concept map ----------------
router.get('/ai-tasks/list-map', requirePermission('ai_tasks', 'view'), async (req, res) => {
  try {
    const map = await getListMap(getSupabase());
    res.json({ success: true, data: { payment: map.payment, terminal: map.terminal, confirmation: map.confirmation, awaiting: map.awaiting, lists: (map._lists || []).map(l => ({ id: l.id, name: l.name_ar || l.name_en })) } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/ai-tasks/list-map', requirePermission('ai_tasks', 'manage'), async (req, res) => {
  try {
    const sup = getSupabase();
    const b = req.body || {};
    const value = {};
    for (const k of ['payment', 'terminal', 'confirmation', 'awaiting']) { if (Array.isArray(b[k])) value[k] = b[k].map(Number).filter(Number.isFinite); }
    const current = await getSetting(sup, 'list_map', {});
    await setSetting(sup, 'list_map', { ...(current || {}), ...value });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
