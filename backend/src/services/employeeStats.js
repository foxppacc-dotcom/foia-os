const DONE_STATUSES = ['closed', 'production_done'];

// Extracted out of getEmployeeCaseStats so /profile/:id's own separate
// (and previously duplicated) case_assignees/created_by union can call
// this instead of re-deriving it -- the two call sites drifting apart is
// exactly the bug class the comment below already documents.
async function getEmployeeCaseIds(sup, userId) {
  const [{ data: assigned }, { data: created }] = await Promise.all([
    // Same fix already applied in caseAccess.js's getVisibleCaseIds (with the
    // same reasoning): an assignee row surviving as soft-deleted still kept
    // that case counted in this user's stats forever after they were
    // removed from its team.
    sup.from('case_assignees').select('case_id').eq('user_id', userId).is('deleted_at', null),
    sup.from('cases').select('id').eq('created_by', userId),
  ]);
  const ids = [...new Set([...(assigned || []).map(a => a.case_id), ...(created || []).map(c => c.id)])];
  if (!ids.length) return [];
  // Neither source above checks the CASE's own deleted_at -- a still-active
  // case_assignees row, or a created_by match, kept a TRASHED case counted
  // in this employee's live KPI/report stats forever. Mirrors the identical
  // final re-filter in caseAccess.js's getVisibleCaseIds.
  const { data: active } = await sup.from('cases').select('id').in('id', ids).is('deleted_at', null);
  return (active || []).map(r => r.id);
}

// Whether this user ever did anything real on each of these cases --
// "real" means an activity_logs row THEY authored (documents, requests,
// status changes, production, etc.) or a case_comments row THEY posted.
// Deliberately does NOT count being assigned itself: assign/unassign
// activity_logs rows carry the ASSIGNER's user_id, not the assignee's
// (confirmed in assignees.js / case_detail.routes.js), so simply being
// added to a case's team never counts as that assignee's own activity --
// that distinction is the entire point of this function. Wrapped so a
// missing index/table (migration not run yet) degrades to "no activity
// data" rather than 500ing the whole profile page.
async function getEmployeeCaseActivity(sup, userId, caseIds) {
  const activity = new Map(caseIds.map(id => [id, { hasActivity: false, lastActivityAt: null }]));
  if (!caseIds.length) return activity;
  const bump = (caseId, at) => {
    const row = activity.get(caseId);
    if (!row) return;
    row.hasActivity = true;
    if (!row.lastActivityAt || new Date(at) > new Date(row.lastActivityAt)) row.lastActivityAt = at;
  };
  // activity_logs is the largest, continuously-growing table in this system
  // (see migration 016's own note) -- a veteran employee with hundreds of
  // cases and years of history would otherwise pull their ENTIRE activity
  // trail on every single profile view, with no bound at all. Ordering by
  // most-recent-first and capping means a case only misses its hasActivity
  // flag if literally none of a user's last 5000 logged actions across
  // their WHOLE caseload touched it -- an acceptable edge for a soft
  // performance signal, not a hard security check, matching the same
  // bounded-lookback tradeoff mailPoller.js's sender_continuity tier
  // already accepts against this same table.
  const ACTIVITY_LOOKBACK_LIMIT = 5000;
  try {
    // 'case' alone missed most real work -- uploading a document, updating
    // the investigation checklist, or assigning a team member all log under
    // their OWN target_type ('document'/'checklist'/'team'), not 'case',
    // but all three use target_id = the case id (unlike 'request'/
    // 'request_classification', which log the REQUEST's own id and can't be
    // matched against caseIds this way). Missing this meant an employee who
    // genuinely worked a case -- just never posted a team-discussion comment
    // -- still showed up badged "معيّن — بدون نشاط" on their own profile.
    const { data: logs } = await sup.from('activity_logs')
      .select('target_id, created_at').eq('user_id', userId).in('target_type', ['case', 'document', 'checklist', 'team']).in('target_id', caseIds)
      .order('created_at', { ascending: false }).limit(ACTIVITY_LOOKBACK_LIMIT);
    for (const row of logs || []) bump(row.target_id, row.created_at);
  } catch (e) { /* index/table may not be migrated in yet */ }
  try {
    const { data: comments } = await sup.from('case_comments')
      .select('case_id, created_at').eq('user_id', userId).in('case_id', caseIds).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(ACTIVITY_LOOKBACK_LIMIT);
    for (const row of comments || []) bump(row.case_id, row.created_at);
  } catch (e) { /* case_comments.user_id may not be indexed yet */ }
  return activity;
}

// Last 30 days of real active-usage time (user_activity_time, populated by
// the /api/activity/heartbeat route) -- separate from attendance_logs
// (physical check-in/out) since the user explicitly wants actual in-app
// usage, not just presence. Degrades to all-zero if the table doesn't
// exist yet rather than failing the whole profile load.
async function getEmployeeActiveTime(sup, userId) {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    const { data } = await sup.from('user_activity_time').select('date, active_seconds').eq('user_id', userId).gte('date', since);
    const rows = data || [];
    const last30DaysSeconds = rows.reduce((sum, r) => sum + (r.active_seconds || 0), 0);
    const todaySeconds = rows.find(r => r.date === today)?.active_seconds || 0;
    return { todaySeconds, last30DaysSeconds, activeDaysLast30: rows.filter(r => r.active_seconds > 0).length };
  } catch (e) {
    return { todaySeconds: 0, last30DaysSeconds: 0, activeDaysLast30: 0 };
  }
}

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
  const caseIds = await getEmployeeCaseIds(sup, userId);
  if (!caseIds.length) return { total: 0, completed: 0, overdue: 0, onTime: 0, urgent: 0, workedOnCases: 0, idleAssignedCases: 0 };

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

  const activity = await getEmployeeCaseActivity(sup, userId, caseIds);
  const workedOnCases = [...activity.values()].filter(a => a.hasActivity).length;
  const idleAssignedCases = caseIds.length - workedOnCases;

  return { total, completed, overdue, onTime, urgent, workedOnCases, idleAssignedCases };
}

module.exports = { getEmployeeCaseStats, getEmployeeCaseIds, getEmployeeCaseActivity, getEmployeeActiveTime };
