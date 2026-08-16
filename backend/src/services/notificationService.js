/**
 * Central notification fan-out. Before this existed, 3 separate call sites
 * each hand-rolled their own recipient query and their own insert shape --
 * two of them never set target_type/target_id at all, so those
 * notifications rendered fine in the bell but couldn't navigate anywhere
 * when clicked. Every new trigger point should go through here instead.
 */
const { getSupabase } = require('../supabase');

// Best-effort, batched insert -- must never throw into the caller, since by
// the time a notification fires the primary action (case saved, comment
// posted, email matched...) has already succeeded and shouldn't be undone
// or reported as failed just because the notify step had trouble.
async function notifyUsers(sup, userIds, { type, title, body, target_type = null, target_id = null }) {
  // A single NaN/invalid id in the batch would fail the WHOLE multi-row
  // insert (Postgres rejects the entire statement), silently dropping
  // notifications for every valid recipient alongside it -- not just the
  // bad one. Coerce and reject non-finite values up front.
  const ids = [...new Set((userIds || []).map(id => typeof id === 'string' ? parseInt(id) : id).filter(Number.isFinite))];
  if (!ids.length) return;
  try {
    const { error } = await sup.from('notifications').insert(
      ids.map(user_id => ({ user_id, type, title, body, target_type, target_id, is_read: false }))
    );
    if (error) console.error(`[notify] insert failed (${type}):`, error.message);
  } catch (e) {
    console.error(`[notify] insert threw (${type}):`, e.message);
  }
}

// Case-level recipients: the case team (case_assignees), its creator, and
// the legacy single assigned_to column -- the same "who's attached to this
// case" definition caseAccess.js already uses for read-visibility, just
// resolved for one case and returning user ids instead of case ids.
async function getCaseRecipients(sup, caseId, { excludeUserId = null } = {}) {
  const [{ data: assignees }, { data: caseRow }] = await Promise.all([
    sup.from('case_assignees').select('user_id').eq('case_id', caseId),
    sup.from('cases').select('created_by, assigned_to').eq('id', caseId).maybeSingle(),
  ]);
  const ids = new Set((assignees || []).map(a => a.user_id));
  if (caseRow?.created_by) ids.add(caseRow.created_by);
  if (caseRow?.assigned_to) ids.add(caseRow.assigned_to);
  if (excludeUserId) ids.delete(excludeUserId);
  return [...ids];
}

// Users whose ROLE grants a given permission -- for events that aren't tied
// to one case's assignees but should still reach the right people by what
// they're authorized to do (e.g. every manager who can see all cases, or
// everyone who can manage email accounts), not a hardcoded "admins only"
// list. Admins always qualify, matching requirePermission's own bypass.
async function getUsersWithPermission(sup, resource, action, { excludeUserId = null } = {}) {
  const { data: users } = await sup.from('users').select('id, role');
  if (!users?.length) return [];
  const roles = [...new Set(users.map(u => u.role).filter(Boolean))];
  const { data: perms } = await sup.from('role_permissions')
    .select('role, allowed').in('role', roles).eq('resource', resource).eq('action', action);
  const permMap = new Map((perms || []).map(p => [p.role, p.allowed]));
  const ids = users
    .filter(u => u.role === 'admin' || permMap.get(u.role) === true)
    .map(u => u.id);
  return excludeUserId ? ids.filter(id => id !== excludeUserId) : ids;
}

// Recipients for the case-activity badge specifically (نقاش الفريق/قائمة
// التدقيق notes & mentions, emails linked, files uploaded): the case's own
// team PLUS anyone whose role can view every case (managers/supervisors
// overseeing the whole board, not just their own assignments) -- otherwise
// a supervisor who isn't personally on a case's team never saw that case's
// activity badge at all, even though they can browse into any case anyway.
async function getCaseActivityRecipients(sup, caseId, { excludeUserId = null } = {}) {
  const [teamIds, supervisorIds] = await Promise.all([
    getCaseRecipients(sup, caseId, { excludeUserId }),
    getUsersWithPermission(sup, 'cases', 'view_all', { excludeUserId }),
  ]);
  return [...new Set([...teamIds, ...supervisorIds])];
}

module.exports = { notifyUsers, getCaseRecipients, getUsersWithPermission, getCaseActivityRecipients };
