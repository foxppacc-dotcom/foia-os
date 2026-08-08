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

  let notified = 0;
  for (const [caseId, reqs] of byCase) {
    try {
      const { data: existing } = await sup.from('notifications')
        .select('id').eq('target_type', 'case').eq('target_id', caseId).eq('type', 'deadline_overdue')
        .gte('created_at', new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()).maybeSingle();
      if (existing) continue;

      const { data: assignees } = await sup.from('case_assignees').select('user_id').eq('case_id', caseId);
      const { data: caseRow } = await sup.from('cases').select('created_by, title').eq('id', caseId).maybeSingle();
      const userIds = new Set((assignees || []).map(a => a.user_id));
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
