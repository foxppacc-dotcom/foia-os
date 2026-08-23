const DONE_STATUSES = ['closed', 'production_done'];

// Shared by team.routes.js's /kpi/:userId (human-facing Profile page) and
// aiTools.js's generate_employee_report -- both used to independently query
// case_tasks, a sub-task feature that's essentially disconnected from how
// work actually gets assigned in this system (case_assignees + cases.created_by).
// Confirmed live: an employee with 161 assigned cases and 177 created cases
// showed "0 total tasks" from both call sites, since case_tasks had zero
// rows for her. Extracted into one function (not fixed separately in each
// file) specifically so the two call sites can't drift back out of sync
// again, the same reason useActiveProviderStatus was extracted earlier.
async function getEmployeeCaseStats(sup, userId) {
  const [{ data: assigned }, { data: created }] = await Promise.all([
    sup.from('case_assignees').select('case_id').eq('user_id', userId),
    sup.from('cases').select('id').eq('created_by', userId),
  ]);
  const caseIds = [...new Set([...(assigned || []).map(a => a.case_id), ...(created || []).map(c => c.id)])];
  if (!caseIds.length) return { total: 0, completed: 0, overdue: 0, onTime: 0, urgent: 0 };

  const { data: cases } = await sup.from('cases').select('id, status, priority, deadline, updated_at').in('id', caseIds);
  const rows = cases || [];
  const total = rows.length;
  const completed = rows.filter(c => DONE_STATUSES.includes(c.status)).length;
  const overdue = rows.filter(c => !DONE_STATUSES.includes(c.status) && c.deadline && new Date(c.deadline) < new Date()).length;
  const urgent = rows.filter(c => c.priority === 'urgent' && !DONE_STATUSES.includes(c.status)).length;

  // cases.updated_at bumps on ANY edit (title, priority, a comment...), not
  // just completion -- a case genuinely finished on time could look "late"
  // (or vice versa) after an unrelated edit long after closure.
  // production_queue.completed_at is a real, purpose-built completion
  // timestamp; prefer it and only fall back to the updated_at approximation
  // for a case that was completed without ever going through production.
  const doneIds = rows.filter(c => DONE_STATUSES.includes(c.status)).map(c => c.id);
  const completedAtByCase = {};
  if (doneIds.length) {
    const { data: pq } = await sup.from('production_queue').select('case_id, completed_at').in('case_id', doneIds).not('completed_at', 'is', null);
    (pq || []).forEach(p => { completedAtByCase[p.case_id] = p.completed_at; });
  }
  const onTime = rows.filter(c => {
    if (!DONE_STATUSES.includes(c.status) || !c.deadline) return false;
    const finishedAt = completedAtByCase[c.id] || c.updated_at;
    return new Date(finishedAt) <= new Date(c.deadline);
  }).length;

  return { total, completed, overdue, onTime, urgent };
}

module.exports = { getEmployeeCaseStats };
