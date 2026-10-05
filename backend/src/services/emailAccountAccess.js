/**
 * Per-employee mailbox visibility scope — "can this role see every email
 * account, or only the ones it's been explicitly assigned?" Mirrors
 * services/caseAccess.js's cases.view_all pattern exactly: role_permissions
 * resource='email_accounts' action='view_all' decides whether the
 * restriction applies at all, and employee_email_accounts (the per-user
 * join table) decides which specific accounts a restricted user can see.
 * Unconfigured (no row yet for a role) defaults to unrestricted, so this
 * feature never silently hides mailboxes from a role until an admin
 * explicitly restricts it from the Permissions tab.
 */
const { getSupabase } = require('../supabase');

async function canViewAllEmailAccounts(sup, role) {
  if (role === 'admin') return true;
  const { data } = await sup.from('role_permissions')
    .select('allowed').eq('role', role).eq('resource', 'email_accounts').eq('action', 'view_all').maybeSingle();
  return data ? data.allowed !== false : true;
}

/** Email account ids a user has been explicitly assigned to. */
async function getVisibleEmailAccountIds(sup, userId) {
  const { data } = await sup.from('employee_email_accounts').select('email_account_id').eq('user_id', userId);
  return (data || []).map(r => r.email_account_id);
}

/** Apply the visibility scope to a Supabase query builder for email_accounts. Returns the (possibly narrowed) query, or null if the user has zero visible accounts. */
async function scopeEmailAccountsQuery(sup, query, user) {
  if (await canViewAllEmailAccounts(sup, user.role)) return query;
  const ids = await getVisibleEmailAccountIds(sup, user.id);
  if (!ids.length) return null;
  return query.in('id', ids);
}

/** Single-account access check, for sending/reading via one specific account. */
async function canAccessEmailAccount(sup, user, accountId) {
  if (await canViewAllEmailAccounts(sup, user.role)) return true;
  const ids = await getVisibleEmailAccountIds(sup, user.id);
  return ids.includes(parseInt(accountId));
}

module.exports = { canViewAllEmailAccounts, getVisibleEmailAccountIds, scopeEmailAccountsQuery, canAccessEmailAccount };
