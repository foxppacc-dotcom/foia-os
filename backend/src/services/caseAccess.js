/**
 * Case visibility scope — "can this role see every case, or only the ones
 * they're actually attached to?" Mirrors the same role_permissions pattern
 * already used for nav/production-line visibility: resource='cases',
 * action='view_all'. Unconfigured (no row yet for a role) defaults to
 * unrestricted, so turning this feature on never silently hides cases from
 * a role until an admin explicitly restricts it from the Permissions tab.
 */
const { getSupabase } = require('../supabase');

async function canViewAllCases(sup, role) {
  if (role === 'admin') return true;
  const { data } = await sup.from('role_permissions')
    .select('allowed').eq('role', role).eq('resource', 'cases').eq('action', 'view_all').maybeSingle();
  return data ? data.allowed !== false : true;
}

/** Case IDs a user is personally attached to — assigned (case_assignees), created, or the legacy single-assignee column. */
async function getVisibleCaseIds(sup, userId) {
  const [{ data: assigned }, { data: created }, { data: legacy }] = await Promise.all([
    // case_assignees rows are soft-deleted (سلة المحذوفات) now -- without
    // this filter, removing someone from a case's team never actually
    // revoked their access to it; the case stayed fully visible/editable
    // to them forever since their row still existed, just marked trashed.
    sup.from('case_assignees').select('case_id').eq('user_id', userId).is('deleted_at', null),
    sup.from('cases').select('id').eq('created_by', userId),
    sup.from('cases').select('id').eq('assigned_to', userId),
  ]);
  const ids = new Set([
    ...(assigned || []).map(r => r.case_id),
    ...(created || []).map(r => r.id),
    ...(legacy || []).map(r => r.id),
  ]);
  if (!ids.size) return [];
  // None of the three sources above check the CASE's own deleted_at -- a
  // still-active case_assignees row (or created_by/legacy assigned_to)
  // kept full access to a case forever even after it was moved to سلة
  // المحذوفات, letting its creator/assignee keep reading and editing
  // (comments, requests, team, communications...) a case that's supposed to
  // be frozen for everyone except through the dedicated restore flow.
  const { data: active } = await sup.from('cases').select('id').in('id', [...ids]).is('deleted_at', null);
  return (active || []).map(r => r.id);
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

/**
 * Express middleware factory — gates any route whose case id sits directly
 * in the URL (e.g. /cases/:id/..., /cases/:caseId/...). A huge swath of
 * case-scoped sub-resource routes (team, checklist, requests, documents,
 * timeline, phone/mail logs, communications, assignees, compose...) across
 * many separate route files had ONLY `requirePermission('cases', 'edit')`-
 * style role checks and never this per-case check -- requirePermission only
 * confirms the role CAN edit/view cases in general, not that THIS specific
 * case is one the user is allowed to touch. A role restricted to its own
 * assigned cases (`cases.view_all = false`) could read or mutate ANY case's
 * data just by guessing/knowing its numeric id. Mount this on every such
 * route instead of hand-rolling the same check inline everywhere.
 */
function requireCaseAccess(paramName = 'id') {
  return async (req, res, next) => {
    try {
      const sup = getSupabase();
      const caseId = parseInt(req.params[paramName]);
      if (!caseId) return res.status(400).json({ error: 'Invalid case id' });
      if (!(await canAccessCase(sup, req.user, caseId))) {
        return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
      }
      next();
    } catch (err) { res.status(500).json({ error: err.message }); }
  };
}

module.exports = { canViewAllCases, getVisibleCaseIds, scopeCasesQuery, canAccessCase, requireCaseAccess };
