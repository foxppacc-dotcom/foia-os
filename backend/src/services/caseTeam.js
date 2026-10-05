// Whoever ADDS a case becomes part of that case's team automatically (case_assignees),
// so they are notified about it, show on its team tab, and count in their workload --
// not just "the creator" in a column nobody looks at. Used by every path that creates a
// case (manual / Excel / intake / the AI assistant / case-from-email).
async function addCreatorToTeam(sup, caseId, userId) {
  if (!caseId || !userId) return;
  try {
    const { data: existing } = await sup.from('case_assignees').select('id, deleted_at').eq('case_id', caseId).eq('user_id', userId).maybeSingle();
    if (existing) {
      if (existing.deleted_at) await sup.from('case_assignees').update({ deleted_at: null, deleted_by: null }).eq('id', existing.id);
      return;
    }
    const { error } = await sup.from('case_assignees').insert({ case_id: caseId, user_id: userId, role: 'member', assigned_at: new Date().toISOString() });
    if (error) console.error('[caseTeam] could not add the creator to the case team:', error.message);
  } catch (e) { console.error('[caseTeam] failed:', e.message); }
}

module.exports = { addCreatorToTeam };
