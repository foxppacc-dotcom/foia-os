/**
 * Once outgoing account X has emailed agency Y for case A, account X is
 * locked to agency Y for that case -- using the SAME account for the SAME
 * agency on a DIFFERENT case is blocked, so an inbound reply from that
 * agency filters to exactly one case instead of being ambiguous. Other
 * accounts remain free to email the same agency for other cases. The lock
 * itself is derived from real send history (communications.email_account_id
 * + agency_id), not a stored flag, so it can never drift out of sync with
 * what was actually sent; only the manual exceptions are stored.
 */
const { getSupabase } = require('../supabase');

/** Returns the OTHER case (if any) this exact account+agency pair is already
 *  locked to, or null if unlocked / already locked to caseId itself. */
async function getLockingCase(sup, emailAccountId, agencyId, caseId) {
  const { data: rows } = await sup.from('communications')
    .select('case_id')
    .eq('email_account_id', emailAccountId).eq('agency_id', agencyId).eq('direction', 'outbound')
    .neq('case_id', caseId)
    .limit(1);
  if (!rows?.length) return null;
  const { data: lockingCase } = await sup.from('cases').select('id, title').eq('id', rows[0].case_id).maybeSingle();
  return lockingCase || { id: rows[0].case_id, title: null };
}

async function hasOverride(sup, emailAccountId, agencyId, caseId) {
  const { data } = await sup.from('email_account_agency_overrides')
    .select('id').eq('email_account_id', emailAccountId).eq('agency_id', agencyId).eq('case_id', caseId).maybeSingle();
  return !!data;
}

/** Full check used both by the standalone status endpoint and the compose
 *  enforcement -- a single source of truth for "can this pair be used here". */
async function checkLock(sup, emailAccountId, agencyId, caseId) {
  const lockingCase = await getLockingCase(sup, emailAccountId, agencyId, caseId);
  if (!lockingCase) return { locked: false, lockedByCase: null, overridden: false };
  const overridden = await hasOverride(sup, emailAccountId, agencyId, caseId);
  return { locked: !overridden, lockedByCase: lockingCase, overridden };
}

module.exports = { getLockingCase, hasOverride, checkLock };
