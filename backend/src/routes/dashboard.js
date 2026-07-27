const express = require('express');
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
router.use(requireAuth);
const { getSupabase } = require('../supabase');

// GET /api/dashboard — stats
router.get('/dashboard', async (req, res) => {
  try {
    const sup = getSupabase();

    // Total cases
    const { count: totalCases } = await sup.from('cases').select('*', { count: 'exact', head: true });

    // Cases by status
    const { data: byStatus } = await sup.from('cases').select('status').then(({ data }) => {
      const counts = {};
      for (const r of data || []) counts[r.status] = (counts[r.status] || 0) + 1;
      return { data: Object.entries(counts).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count) };
    });

    // Cases by priority
    const { data: byPriority } = await sup.from('cases').select('priority').then(({ data }) => {
      const counts = {};
      for (const r of data || []) counts[r.priority] = (counts[r.priority] || 0) + 1;
      return { data: Object.entries(counts).map(([priority, count]) => ({ priority, count })).sort((a, b) => b.count - a.count) };
    });

    // Recent activity — last 10 created cases
    const { data: recentCases } = await sup
      .from('cases')
      .select(`id, uuid, title, status, priority, created_at, agencies!left(name_en)`)
      .order('created_at', { ascending: false })
      .limit(10);

    // Normalize the joined field
    const recentCasesMapped = (recentCases || []).map(c => ({
      ...c,
      agency_name: c.agencies?.name_en || null,
      agencies: undefined
    }));

    // Recent communications
    const { data: recentCommunications } = await sup
      .from('communications')
      .select(`*, cases!left(title)`)
      .order('created_at', { ascending: false })
      .limit(10);

    const recentCommunicationsMapped = (recentCommunications || []).map(c => ({
      ...c,
      case_title: c.cases?.title || null,
      cases: undefined
    }));

    // Upcoming deadlines — cases with deadlines in the next 30 days
    const { data: upcomingDeadlines } = await sup
      .from('cases')
      .select(`id, uuid, title, deadline, status, priority, agencies!left(name_en), users!left(name)`)
      .not('deadline', 'is', null)
      .neq('status', 'closed')
      .gte('deadline', new Date().toISOString().split('T')[0])
      .order('deadline', { ascending: true })
      .limit(10);

    const upcomingDeadlinesMapped = (upcomingDeadlines || []).map(c => ({
      ...c,
      agency_name: c.agencies?.name_en || null,
      assigned_user_name: c.users?.name || null,
      agencies: undefined,
      users: undefined,
      days_remaining: c.deadline ? Math.ceil((new Date(c.deadline) - new Date()) / (1000 * 60 * 60 * 24)) : null
    }));

    // Total agencies
    const { count: totalAgencies } = await sup.from('agencies').select('*', { count: 'exact', head: true });

    // Total open requests
    const { count: totalRequests } = await sup.from('requests').select('*', { count: 'exact', head: true });

    // Pipeline list counts
    const { data: pipelineLists } = await sup
      .from('pipeline_lists')
      .select('id, name_ar, name_en, color, list_number')
      .order('list_number', { ascending: true });

    const pipelineCounts = [];
    for (const pl of pipelineLists || []) {
      const { count: taskCount } = await sup
        .from('case_tasks')
        .select('*', { count: 'exact', head: true })
        .eq('list_id', pl.id);

      const { count: requestCount } = await sup
        .from('requests')
        .select('*', { count: 'exact', head: true })
        .eq('classification_id', pl.id);

      pipelineCounts.push({ ...pl, task_count: taskCount, request_count: requestCount });
    }

    res.json({
      totalCases: totalCases || 0,
      byStatus: byStatus || [],
      byPriority: byPriority || [],
      recentCases: recentCasesMapped,
      recentCommunications: recentCommunicationsMapped,
      upcomingDeadlines: upcomingDeadlinesMapped,
      totalAgencies: totalAgencies || 0,
      totalRequests: totalRequests || 0,
      pipelineCounts
    });
  } catch (err) {
    console.error('Error getting dashboard:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
