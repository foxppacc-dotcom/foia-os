const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const { canViewAllCases, getVisibleCaseIds } = require('../services/caseAccess');

// All automation routes require auth
router.use(requireAuth);

// GET /api/automations — list all
router.get('/automations', requireRole('admin'), async (req, res) => {
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
    // Same case-visibility rule GET /cases already enforces -- this had NO
    // access check at all (not even a role gate, just requireAuth), so any
    // authenticated user could see every OTHER case's title through the
    // automation run history regardless of their own assigned-cases scope.
    const restricted = !(await canViewAllCases(sup, req.user.role));
    const visibleCaseIds = restricted ? await getVisibleCaseIds(sup, req.user.id) : null;
    if (restricted && !visibleCaseIds.length) return res.json({ success: true, data: [] });

    // No FK-embed relied on (`automations!left(...)`/`cases!left(...)`) --
    // PostgREST's schema-cache-based embeds have been unreliable elsewhere in
    // this codebase (see portals.js) and this one genuinely always 500'd
    // ("Could not find a relationship between 'automation_logs' and 'cases'
    // in the schema cache") -- this route was completely broken for every
    // user, not something my scoping change introduced. Batch-fetch by id
    // instead, same defensive pattern used throughout case_detail.routes.js.
    let query = sup.from('automation_logs').select('*').order('created_at', { ascending: false }).limit(50);
    if (restricted) query = query.in('case_id', visibleCaseIds);
    const { data, error } = await query;
    if (error) throw error;

    const automationIds = [...new Set((data || []).map(l => l.automation_id).filter(Boolean))];
    const caseIds = [...new Set((data || []).map(l => l.case_id).filter(Boolean))];
    const [{ data: automations }, { data: cases }] = await Promise.all([
      automationIds.length ? sup.from('automations').select('id, name').in('id', automationIds) : Promise.resolve({ data: [] }),
      caseIds.length ? sup.from('cases').select('id, title').in('id', caseIds) : Promise.resolve({ data: [] }),
    ]);
    const automationMap = Object.fromEntries((automations || []).map(a => [a.id, a.name]));
    const caseMap = Object.fromEntries((cases || []).map(c => [c.id, c.title]));

    const logs = (data || []).map(l => ({
      ...l, automation_name: automationMap[l.automation_id] || null, case_title: caseMap[l.case_id] || null,
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
    const { data: openCases } = await sup.from('cases').select('id, title, description').eq('status', 'open').limit(20);
    const openIds = (openCases || []).map(c => c.id);
    const caseMap = {}; (openCases || []).forEach(c => caseMap[c.id] = c);

    const { data: unclassified } = openIds.length
      ? await sup.from('requests').select('id, case_id, notes').is('classification_id', null).in('case_id', openIds).limit(20)
      : { data: [] };

    // Resolved by name_en rather than hardcoded 1-7 -- pipeline_lists ids are
    // seeded/inserted, not guaranteed sequential from 1 (this environment's
    // real ids start at 15), so a literal listId = 1 silently pointed at
    // whatever list (if any) happened to have that id, or a nonexistent row.
    // Same bug already fixed in classifier.js/cases.js/production.js/
    // dashboard.js/pipelineLists.js this session.
    const { data: allLists } = await sup.from('pipeline_lists').select('id, name_en');
    const listIdByName = Object.fromEntries((allLists || []).map(l => [l.name_en, l.id]));

    for (const r of unclassified || []) {
      const c = caseMap[r.case_id];
      const txt = `${c?.title || ''} ${c?.description || ''} ${r.notes || ''}`.toLowerCase();
      let listName = null;
      if (/body[- ]?cam|footage|video|تسجيل|فيديو/.test(txt)) listName = 'Records Received';
      else if (/payment|fee|charge|رسوم|دفع/.test(txt)) listName = 'Payment Required';
      else if (/no.*record|unavailable|doesn.*exist|مفيش|غير.*متوف/.test(txt)) listName = 'No Records Available';
      else if (/denied|refused|reject|رفض|مرفوض/.test(txt)) listName = 'Denied by Law';
      else if (/court|pending|investigat|محكمة|قيد.*التحقيق/.test(txt)) listName = 'Case Pending in Court';
      else if (/no.*bodycam|doesn.*use|لا.*تستخدم/.test(txt)) listName = 'Agency Has No Bodycams';
      else if (/citizenship|identity|إثبات|مواطنة|هوية/.test(txt)) listName = 'Citizenship Needed';
      const listId = listName ? listIdByName[listName] : null;

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
    const { data: openCases } = await sup.from('cases').select('id, title').neq('status', 'closed').limit(20);
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
