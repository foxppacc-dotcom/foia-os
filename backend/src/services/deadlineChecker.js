const { getSupabase } = require('../supabase');

// Scans requests whose expected_response_date has passed with no response
// yet, and creates one notification per case per day (deduped against
// existing notifications so re-running the cron doesn't spam users).
async function checkOverdueDeadlines() {
  const sup = getSupabase();
  const today = new Date().toISOString().split('T')[0];

  const { data: overdue, error } = await sup.from('requests')
    .select('id, case_id, agency_id, expected_response_date, agencies(name_ar, name_en)')
    .lt('expected_response_date', today)
    .is('response_date', null)
    .neq('status', 'closed');
  if (error) throw error;
  if (!overdue || !overdue.length) return { checked: 0, notified: 0 };

  // One notification per case per day (not per overdue request) — a case
  // with 3 overdue requests shouldn't spam 3 separate alerts.
  const byCase = new Map();
  for (const req of overdue) {
    if (!byCase.has(req.case_id)) byCase.set(req.case_id, []);
    byCase.get(req.case_id).push(req);
  }

  // Batched once for every case in this run instead of 3 sequential queries
  // PER case (dedup check, assignees, case row) -- with hundreds of overdue
  // cases that was hundreds of extra round trips on every cron run.
  const caseIds = [...byCase.keys()];
  const [{ data: recentNotifs }, { data: allAssignees }, { data: allCaseRows }] = await Promise.all([
    sup.from('notifications').select('target_id').eq('target_type', 'case').eq('type', 'deadline_overdue')
      .in('target_id', caseIds).gte('created_at', new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()),
    sup.from('case_assignees').select('case_id, user_id').in('case_id', caseIds),
    sup.from('cases').select('id, created_by, title').in('id', caseIds),
  ]);
  const alreadyNotified = new Set((recentNotifs || []).map(n => n.target_id));
  const assigneesByCase = {};
  (allAssignees || []).forEach(a => { (assigneesByCase[a.case_id] ||= []).push(a.user_id); });
  const caseRowById = Object.fromEntries((allCaseRows || []).map(c => [c.id, c]));

  let notified = 0;
  for (const [caseId, reqs] of byCase) {
    try {
      if (alreadyNotified.has(caseId)) continue;

      const caseRow = caseRowById[caseId];
      const userIds = new Set(assigneesByCase[caseId] || []);
      if (caseRow?.created_by) userIds.add(caseRow.created_by);
      if (!userIds.size) continue;

      const agencyNames = reqs.map(r => r.agencies?.name_ar || r.agencies?.name_en || 'جهة').join('، ');
      const title = reqs.length > 1 ? `⏰ ${reqs.length} جهات تخطّت الموعد المتوقع للرد` : '⏰ تخطّى الموعد المتوقع للرد';
      const body = `القضية "${caseRow?.title || caseId}" — ${agencyNames}`;
      // One insert per assignee, one at a time -- batched into a single
      // array insert instead. The error was also never checked before: a
      // failed insert meant that assignee silently never got told their
      // case's deadline passed, with no sign anything went wrong until the
      // 20h dedup window (line 31) expired and the cron retried.
      const { error: notifyErr } = await sup.from('notifications').insert(
        [...userIds].map(userId => ({ user_id: userId, type: 'deadline_overdue', title, body, target_type: 'case', target_id: caseId }))
      );
      if (notifyErr) { console.error(`[deadlineChecker] notification insert failed for case ${caseId}:`, notifyErr.message); continue; }
      notified++;
    } catch (e) {
      console.error(`[deadlineChecker] failed for case ${caseId}:`, e.message);
    }
  }
  return { checked: overdue.length, notified };
}

module.exports = { checkOverdueDeadlines };
