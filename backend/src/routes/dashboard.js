const express = require('express');
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
router.use(requireAuth);
const { getSupabase } = require('../supabase');

// GET /api/dashboard — stats
router.get('/dashboard', async (req, res) => {
  try {
    const sup = getSupabase();

    // All of these are independent reads -- fire them together instead of
    // one-at-a-time (was ~9 sequential round trips, now 1 round trip's
    // worth of wall-clock time since PostgREST calls are HTTP requests).
    const [
      { count: totalCases },
      { data: statusRows },
      { data: priorityRows },
      { data: recentCases },
      { data: recentCommunications },
    ] = await Promise.all([
      sup.from('cases').select('*', { count: 'exact', head: true }),
      sup.from('cases').select('status'),
      sup.from('cases').select('priority'),
      sup.from('cases').select(`id, uuid, title, status, priority, created_at, agencies!left(name_en)`).order('created_at', { ascending: false }).limit(10),
      sup.from('communications').select(`*, cases!left(title)`).order('created_at', { ascending: false }).limit(10),
    ]);

    const byStatus = (() => {
      const counts = {};
      for (const r of statusRows || []) counts[r.status] = (counts[r.status] || 0) + 1;
      return Object.entries(counts).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
    })();

    const byPriority = (() => {
      const counts = {};
      for (const r of priorityRows || []) counts[r.priority] = (counts[r.priority] || 0) + 1;
      return Object.entries(counts).map(([priority, count]) => ({ priority, count })).sort((a, b) => b.count - a.count);
    })();

    // Normalize the joined field
    const recentCasesMapped = (recentCases || []).map(c => ({
      ...c,
      agency_name: c.agencies?.name_en || null,
      agencies: undefined
    }));

    const recentCommunicationsMapped = (recentCommunications || []).map(c => ({
      ...c,
      case_title: c.cases?.title || null,
      cases: undefined
    }));

    // Deadlines — includes overdue (deadline already passed) so the
    // "متأخرة" stat below isn't always zero; ordered soonest/most-overdue first.
    const todayStr = new Date().toISOString().split('T')[0];
    const [
      { data: upcomingDeadlines },
      { count: totalAgencies },
      { count: totalRequests },
      { data: pipelineLists },
      { data: overdueResponses },
    ] = await Promise.all([
      sup.from('cases').select(`id, uuid, title, deadline, status, priority, agencies!left(name_en), users!left(name)`).not('deadline', 'is', null).neq('status', 'closed').order('deadline', { ascending: true }).limit(10),
      sup.from('agencies').select('*', { count: 'exact', head: true }),
      sup.from('requests').select('*', { count: 'exact', head: true }),
      sup.from('pipeline_lists').select('id, name_ar, name_en, color, list_number').order('list_number', { ascending: true }),
      // Requests whose agency never responded by the expected date -- same
      // "تخطّى الموعد المتوقع للرد" concept the deadline-overdue notification
      // cron alerts on (services/deadlineChecker.js), surfaced here as its
      // own visible dashboard section instead of only a background alert.
      sup.from('requests')
        .select(`id, case_id, expected_response_date, cases!left(title), agencies!left(name_ar, name_en)`)
        .lt('expected_response_date', todayStr).is('response_date', null).neq('status', 'closed')
        .order('expected_response_date', { ascending: true }),
    ]);

    const upcomingDeadlinesMapped = (upcomingDeadlines || []).map(c => ({
      ...c,
      agency_name: c.agencies?.name_en || null,
      assigned_user_name: c.users?.name || null,
      agencies: undefined,
      users: undefined,
      days_remaining: c.deadline ? Math.ceil((new Date(c.deadline) - new Date()) / (1000 * 60 * 60 * 24)) : null
    }));

    // Pipeline list counts — 2 grouped queries instead of 2 per list (was
    // 14 sequential round trips on every dashboard load for 7 lists).
    const pipelineListIds = (pipelineLists || []).map(pl => pl.id);
    const taskCountByList = {}, requestCountByList = {};
    if (pipelineListIds.length) {
      const [{ data: taskRows }, { data: requestRows }] = await Promise.all([
        sup.from('case_tasks').select('list_id').in('list_id', pipelineListIds),
        sup.from('requests').select('classification_id').in('classification_id', pipelineListIds),
      ]);
      for (const t of taskRows || []) taskCountByList[t.list_id] = (taskCountByList[t.list_id] || 0) + 1;
      for (const r of requestRows || []) requestCountByList[r.classification_id] = (requestCountByList[r.classification_id] || 0) + 1;
    }
    const pipelineCounts = (pipelineLists || []).map(pl => ({
      ...pl, task_count: taskCountByList[pl.id] || 0, request_count: requestCountByList[pl.id] || 0,
    }));

    const overdueResponsesMapped = (overdueResponses || []).map(r => ({
      id: r.id,
      case_id: r.case_id,
      case_title: r.cases?.title || null,
      agency_name: r.agencies?.name_ar || r.agencies?.name_en || null,
      expected_response_date: r.expected_response_date,
      days_overdue: Math.floor((new Date(todayStr) - new Date(r.expected_response_date)) / (1000 * 60 * 60 * 24)),
    }));

    res.json({
      totalCases: totalCases || 0,
      byStatus: byStatus || [],
      byPriority: byPriority || [],
      recentCases: recentCasesMapped,
      recentCommunications: recentCommunicationsMapped,
      upcomingDeadlines: upcomingDeadlinesMapped,
      totalAgencies: totalAgencies || 0,
      totalRequests: totalRequests || 0,
      pipelineCounts,
      overdueResponses: overdueResponsesMapped,
    });
  } catch (err) {
    console.error('Error getting dashboard:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
