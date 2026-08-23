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
  // No dedicated "completed_at" column on cases -- updated_at is the best
  // available proxy for when a case last changed (e.g. into a done status),
  // so "on time" here is an approximation, not an exact measurement.
  const onTime = rows.filter(c => DONE_STATUSES.includes(c.status) && c.deadline && new Date(c.updated_at) <= new Date(c.deadline)).length;

  return { total, completed, overdue, onTime, urgent };
}

module.exports = { getEmployeeCaseStats };
