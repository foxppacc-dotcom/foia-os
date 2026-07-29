const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSupabase } = require('../supabase');

// All automation routes require auth
router.use(requireAuth);

// GET /api/automations — list all
router.get('/automations', async (req, res) => {
  try {
    const sup = getSupabase();
    const { data, error } = await sup.from('automations').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/automations — create
router.post('/automations', requireRole('admin'), async (req, res) => {
  try {
    const { name, trigger_type, trigger_config, action_type, action_config } = req.body;
    if (!name || !trigger_type || !action_type) return res.status(400).json({ error: 'name, trigger_type, action_type required' });

    const sup = getSupabase();
    const { data, error } = await sup.from('automations').insert({
      name, trigger_type, trigger_config: JSON.stringify(trigger_config || {}),
      action_type, action_config: JSON.stringify(action_config || {}),
    }).select().single();
    if (error) throw error;

    res.json({ success: true, id: data.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/automations/:id — update
router.put('/automations/:id', requireRole('admin'), async (req, res) => {
  try {
    const { name, trigger_type, trigger_config, action_type, action_config, is_active } = req.body;
    const sup = getSupabase();
    const id = parseInt(req.params.id);
    const { data: a } = await sup.from('automations').select('id').eq('id', id).maybeSingle();
    if (!a) return res.status(404).json({ error: 'Not found' });

    const { error } = await sup.from('automations').update({
      name, trigger_type, trigger_config: JSON.stringify(trigger_config || {}),
      action_type, action_config: JSON.stringify(action_config || {}),
      is_active: is_active ?? true,
    }).eq('id', id);
    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/automations/:id
router.delete('/automations/:id', requireRole('admin'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { error } = await sup.from('automations').delete().eq('id', parseInt(req.params.id));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/automations/:id/run — run manually
router.post('/automations/:id/run', requireRole('admin'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { data: a } = await sup.from('automations').select('*').eq('id', parseInt(req.params.id)).maybeSingle();
    if (!a) return res.status(404).json({ error: 'Not found' });

    const result = await executeAutomation(a, sup);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/automations/run-all — run all active
router.post('/automations/run-all', requireRole('admin'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { data: list } = await sup.from('automations').select('*').eq('is_active', true);
    const results = [];
    for (const a of list || []) {
      try {
        results.push({ name: a.name, result: await executeAutomation(a, sup) });
      } catch (e) {
        results.push({ name: a.name, error: e.message });
      }
    }
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/automations/logs — automation history
router.get('/automations/logs', async (req, res) => {
  try {
    const sup = getSupabase();
    const { data, error } = await sup.from('automation_logs')
      .select('*, automations!left(name), cases!left(title)')
      .order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    const logs = (data || []).map(l => ({
      ...l, automation_name: l.automations?.name || null, case_title: l.cases?.title || null,
      automations: undefined, cases: undefined,
    }));
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Execute a single automation
 */
async function executeAutomation(a, sup) {
  const result = { matched: 0, actions: [] };
  const today = new Date().toISOString().split('T')[0];

  // CASE 1: Send follow-up for overdue deadlines
  if (a.action_type === 'follow_up_overdue') {
    const { data: overdue } = await sup.from('cases')
      .select('id, title, deadline, status')
      .not('deadline', 'is', null).lt('deadline', today).neq('status', 'closed').limit(20);

    for (const c of overdue || []) {
      await sup.from('communications').insert({
        case_id: c.id, type: 'email', direction: 'outbound',
        subject: `متابعة الطلب — ${c.title}`,
        body: `هذا تذكير بأن الموعد النهائي ${c.deadline} قد مضى. نرجو المتابعة.`,
      });
      await logAction(sup, a.id, c.id, 'follow_up_sent', '🤖 أتمتة: تم إرسال متابعة تلقائية للطلب المتأخر');
      result.matched++;
      result.actions.push({ case_id: c.id, action: 'follow_up' });
    }
  }

  // CASE 2: Escalate high-priority cases without recent activity
  else if (a.action_type === 'escalate_stale_high') {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
    const { data: stale } = await sup.from('cases')
      .select('id, title, status, updated_at')
      .eq('priority', 'high').eq('status', 'open').lt('updated_at', threeDaysAgo).limit(10);

    for (const c of stale || []) {
      await sup.from('cases').update({ priority: 'high', status: 'in_progress' }).eq('id', c.id);
      await logAction(sup, a.id, c.id, 'escalated', '🚨 أتمتة: تم تصعيد القضية لعدم وجود نشاط لمدة 3 أيام');
      result.matched++;
      result.actions.push({ case_id: c.id, action: 'escalated' });
    }
  }

  // CASE 3: Auto-classify newly created cases without classification
  else if (a.action_type === 'auto_classify') {
    const { data: openCases } = await sup.from('cases').select('id, title, description').eq('status', 'open');
    const openIds = (openCases || []).map(c => c.id);
    const caseMap = {}; (openCases || []).forEach(c => caseMap[c.id] = c);

    const { data: unclassified } = openIds.length
      ? await sup.from('requests').select('id, case_id, notes').is('classification_id', null).in('case_id', openIds).limit(20)
      : { data: [] };

    for (const r of unclassified || []) {
      const c = caseMap[r.case_id];
      const txt = `${c?.title || ''} ${c?.description || ''} ${r.notes || ''}`.toLowerCase();
      let listId = null;
      if (/body[- ]?cam|footage|video|تسجيل|فيديو/.test(txt)) listId = 1;
      else if (/payment|fee|charge|رسوم|دفع/.test(txt)) listId = 2;
      else if (/no.*record|unavailable|doesn.*exist|مفيش|غير.*متوف/.test(txt)) listId = 3;
      else if (/denied|refused|reject|رفض|مرفوض/.test(txt)) listId = 4;
      else if (/court|pending|investigat|محكمة|قيد.*التحقيق/.test(txt)) listId = 5;
      else if (/no.*bodycam|doesn.*use|لا.*تستخدم/.test(txt)) listId = 6;
      else if (/citizenship|identity|إثبات|مواطنة|هوية/.test(txt)) listId = 7;

      if (listId) {
        await sup.from('requests').update({ classification_id: listId }).eq('id', r.id);
        await logAction(sup, a.id, r.case_id, `classified_to_${listId}`);
        result.matched++;
        result.actions.push({ case_id: r.case_id, request_id: r.id, list_id: listId });
      }
    }
  }

  // CASE 4: Notify about upcoming deadlines (within 3 days)
  else if (a.action_type === 'deadline_reminder') {
    const threeDaysOut = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
    const { data: upcoming } = await sup.from('cases')
      .select('id, title, deadline')
      .not('deadline', 'is', null).gte('deadline', today).lte('deadline', threeDaysOut).neq('status', 'closed').limit(20);

    for (const c of upcoming || []) {
      await logAction(sup, a.id, c.id, 'reminder_sent', `⏰ أتمتة: الموعد النهائي ${c.deadline} يقترب (خلال 3 أيام)`);
      result.matched++;
      result.actions.push({ case_id: c.id, action: 'reminder' });
    }
  }

  // CASE 5: Auto-close cases where all requests are responded
  else if (a.action_type === 'auto_close_completed') {
    const { data: openCases } = await sup.from('cases').select('id, title').neq('status', 'closed');
    for (const c of openCases || []) {
      const { data: reqs } = await sup.from('requests').select('status').eq('case_id', c.id);
      if (!reqs || reqs.length === 0) continue;
      if (reqs.every(r => r.status === 'responded')) {
        await sup.from('cases').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', c.id);
        await logAction(sup, a.id, c.id, 'auto_closed', '✅ أتمتة: تم إغلاق القضية — جميع الطلبات تم الرد عليها');
        result.matched++;
        result.actions.push({ case_id: c.id, action: 'closed' });
        if (result.matched >= 10) break;
      }
    }
  }

  // Update last_run
  await sup.from('automations').update({ last_run: new Date().toISOString() }).eq('id', a.id);

  return result;
}

async function logAction(sup, automationId, caseId, status, activityTitle) {
  try {
    await sup.from('automation_logs').insert({ automation_id: automationId, case_id: caseId, status });
    if (activityTitle) {
      await sup.from('activity_logs').insert({
        action_type: 'automation', target_type: 'case', target_id: caseId, target_title: activityTitle,
      });
    }
  } catch (e) { console.error('[automation] logAction failed:', e.message); }
}

module.exports = router;
