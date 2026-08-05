/**
 * Case visibility scope — "can this role see every case, or only the ones
 * they're actually attached to?" Mirrors the same role_permissions pattern
 * already used for nav/production-line visibility: resource='cases',
 * action='view_all'. Unconfigured (no row yet for a role) defaults to
 * unrestricted, so turning this feature on never silently hides cases from
 * a role until an admin explicitly restricts it from the Permissions tab.
 */

async function canViewAllCases(sup, role) {
  if (role === 'admin') return true;
  const { data } = await sup.from('role_permissions')
    .select('allowed').eq('role', role).eq('resource', 'cases').eq('action', 'view_all').maybeSingle();
  return data ? data.allowed !== false : true;
}

/** Case IDs a user is personally attached to — assigned (case_assignees), created, or the legacy single-assignee column. */
async function getVisibleCaseIds(sup, userId) {
  const [{ data: assigned }, { data: created }, { data: legacy }] = await Promise.all([
    sup.from('case_assignees').select('case_id').eq('user_id', userId),
    sup.from('cases').select('id').eq('created_by', userId),
    sup.from('cases').select('id').eq('assigned_to', userId),
  ]);
  const ids = new Set([
    ...(assigned || []).map(r => r.case_id),
    ...(created || []).map(r => r.id),
    ...(legacy || []).map(r => r.id),
  ]);
  return [...ids];
}

/** Apply the visibility scope to a Supabase query builder for the cases list. Returns the (possibly narrowed) query, or null if the user has zero visible cases. */
async function scopeCasesQuery(sup, query, user) {
  if (await canViewAllCases(sup, user.role)) return query;
  const ids = await getVisibleCaseIds(sup, user.id);
  if (!ids.length) return null;
  return query.in('id', ids);
}

/** Single-case access check, for GET/PUT/DELETE on one specific case. */
async function canAccessCase(sup, user, caseId) {
  if (await canViewAllCases(sup, user.role)) return true;
  const ids = await getVisibleCaseIds(sup, user.id);
  return ids.includes(parseInt(caseId));
}

module.exports = { canViewAllCases, getVisibleCaseIds, scopeCasesQuery, canAccessCase };
