// Extracted out of cases.js's own DELETE /cases/:id so the trash service
// can reuse the EXACT same cascade logic (soft AND permanent) instead of a
// second, easily-drifting copy. There is no enforced FK/cascade behind
// these tables -- deleting/trashing the case row alone would leave every
// dependent table pointing at a case_id whose parent is gone (Inbox still
// listing the case's communications, canAccessCase silently no-op'ing on a
// trashed id, Drive-uploaded files becoming unreachable through the app
// while still consuming storage). Takes `sup` as a parameter (not imported
// here) matching every other service function in this codebase.

const { deleteDocumentBytes, deleteCommunicationAttachments } = require('./fileCleanup');

// activity_logs is deliberately excluded from every list below in every
// function -- it's the audit trail, including of the deletion/trashing
// itself, and is never restored or wiped alongside the case's own data.
const DEPENDENT_TABLES = [
  'requests', 'case_documents', 'case_comments', 'communications',
  'case_assignees', 'case_agency_channels', 'case_records_checklist', 'production_queue',
];

// Children get the SAME deleted_at stamp as the case, but ONLY children that are
// still live: a row someone trashed on its own earlier (a removed team member,
// a deleted document...) keeps its own earlier stamp, so restoreCase below can
// tell "trashed together with the case" from "trashed separately" and never
// resurrects the latter.
async function softDeleteCase(sup, { id, userId }) {
  const now = new Date().toISOString();
  for (const table of DEPENDENT_TABLES) {
    const { error } = await sup.from(table).update({ deleted_at: now, deleted_by: userId }).eq('case_id', id).is('deleted_at', null);
    if (error) console.error(`[caseCascade] soft-delete cleanup failed for ${table}:`, error.message);
  }
  return sup.from('cases').update({ deleted_at: now, deleted_by: userId }).eq('id', id);
}

async function restoreCase(sup, { id }) {
  const { data: caseRow } = await sup.from('cases').select('deleted_at').eq('id', id).maybeSingle();
  const stamp = caseRow?.deleted_at || null;
  for (const table of DEPENDENT_TABLES) {
    let q = sup.from(table).update({ deleted_at: null, deleted_by: null }).eq('case_id', id);
    // Only children trashed together with the case; fall back to the old
    // blanket restore if the case has no stamp for some reason.
    q = stamp ? q.eq('deleted_at', stamp) : q.not('deleted_at', 'is', null);
    const { error } = await q;
    if (error) console.error(`[caseCascade] restore failed for ${table}:`, error.message);
  }
  return sup.from('cases').update({ deleted_at: null, deleted_by: null }).eq('id', id);
}

// Unchanged from the original route body -- the real, hard, irreversible
// delete. Only ever reached now via the Trash page's "حذف نهائي" action,
// never directly from a case's own header.
async function permanentlyDeleteCase(sup, { id }) {
  // case_documents/communications may own real Drive/storage bytes -- clean
  // those up BEFORE the generic per-table delete loop below removes the
  // rows that recorded where those bytes live. Same cleanup trash.js's own
  // single-row permanent-delete does, applied here to every row this case
  // owns (this used to be a plain `.delete()` with no cleanup at all,
  // silently leaking every Drive file/attachment behind a purged case).
  const [{ data: docs }, { data: comms }] = await Promise.all([
    sup.from('case_documents').select('storage_key, storage_provider, drive_file_id').eq('case_id', id),
    sup.from('communications').select('metadata').eq('case_id', id),
  ]);
  // Rows first, bytes LAST: if a dependent delete (or the case delete) fails we
  // stop and report it with every file still intact, instead of purging the
  // Drive bytes and then reporting success/leaving orphan rows pointing at them.
  for (const table of DEPENDENT_TABLES) {
    const { error } = await sup.from(table).delete().eq('case_id', id);
    if (error) {
      console.error(`[caseCascade] permanent-delete cleanup failed for ${table}:`, error.message);
      return { error: new Error(`تعذر حذف بيانات ${table} المرتبطة بالقضية: ${error.message}`) };
    }
  }
  await sup.from('notifications').delete().eq('target_type', 'case').eq('target_id', id);
  const result = await sup.from('cases').delete().eq('id', id);
  if (result.error) return result;
  for (const doc of docs || []) await deleteDocumentBytes(doc);
  for (const comm of comms || []) await deleteCommunicationAttachments(comm);
  return result;
}

module.exports = { DEPENDENT_TABLES, softDeleteCase, restoreCase, permanentlyDeleteCase };
