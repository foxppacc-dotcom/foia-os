// The single mechanism behind "سلة المحذوفات" -- every DELETE route in the
// app that used to remove a row immediately now calls softDelete() instead,
// and only the dedicated Trash page (routes/trash.js) can restore() or
// permanentlyDelete() an item. One convention (deleted_at + deleted_by),
// not a per-table bespoke flag, so a single registry can drive the trash
// list UI, the restore/destroy routes, AND stay in sync as tables are added.
const caseCascade = require('./caseCascade');
const { deleteDocumentBytes, deleteCommunicationAttachments } = require('./fileCleanup');

// `hidden: true` entries are case-dependent join/detail tables -- only ever
// meaningful nested under a restored case (see caseCascade.js), never
// independently browsable at the top level of /trash. `caseScoped: true`
// marks entities whose delete is already scoped to a specific case
// (informational only right now -- not read anywhere yet, kept for the
// Trash page to group/label rows by case if that's ever wanted).
const TRASH_REGISTRY = {
  cases:                       { label: 'القضايا', idColumn: 'id', titleColumn: 'title', listColumns: 'id, title, status, deleted_at' },
  agencies:                    { label: 'الجهات', idColumn: 'id', titleColumn: 'name_en', listColumns: 'id, name_en, name_ar, deleted_at' },
  forum_topics:                { label: 'مواضيع المنتدى', idColumn: 'id', titleColumn: 'title', listColumns: 'id, title, deleted_at' },
  forum_comments:               { label: 'تعليقات المنتدى', idColumn: 'id', titleColumn: 'content', listColumns: 'id, content, deleted_at' },
  case_comments:                { label: 'نقاش القضايا', idColumn: 'id', titleColumn: 'content', listColumns: 'id, content, case_id, deleted_at', caseScoped: true },
  users:                        { label: 'المستخدمين', idColumn: 'id', titleColumn: 'name', listColumns: 'id, name, email, role, deleted_at' },
  teams:                        { label: 'الفرق', idColumn: 'id', titleColumn: 'name', listColumns: 'id, name, deleted_at' },
  roles:                        { label: 'الأدوار', idColumn: 'id', titleColumn: 'label', listColumns: 'id, name, label, deleted_at' },
  case_team_roles:              { label: 'مسميات فريق القضية', idColumn: 'id', titleColumn: 'label', listColumns: 'id, label, deleted_at' },
  departments:                  { label: 'الأقسام', idColumn: 'id', titleColumn: 'name', listColumns: 'id, name, deleted_at' },
  portal_credentials:           { label: 'بوابات', idColumn: 'id', titleColumn: 'portal_name', listColumns: 'id, portal_name, deleted_at' },
  email_accounts:               { label: 'حسابات البريد', idColumn: 'id', titleColumn: 'email', listColumns: 'id, email, name, deleted_at' },
  intake_criteria_definitions:  { label: 'معايير الاستقبال', idColumn: 'id', titleColumn: 'label_ar', listColumns: 'id, label_ar, deleted_at' },
  phone_logs:                   { label: 'سجل المكالمات', idColumn: 'id', titleColumn: 'notes', listColumns: 'id, notes, case_id, deleted_at', caseScoped: true },
  mail_logs:                    { label: 'البريد الفعلي', idColumn: 'id', titleColumn: 'notes', listColumns: 'id, notes, case_id, deleted_at', caseScoped: true },
  automations:                  { label: 'الأتمتة', idColumn: 'id', titleColumn: 'name', listColumns: 'id, name, deleted_at' },
  ai_provider_configs:          { label: 'مزودو الذكاء الاصطناعي', idColumn: 'id', titleColumn: 'provider', listColumns: 'id, provider, model, deleted_at' },
  checklist_templates:          { label: 'قوالب القوائم', idColumn: 'id', titleColumn: 'title', listColumns: 'id, title, deleted_at' },
  pipeline_lists:                { label: 'قوائم خط الإنتاج', idColumn: 'id', titleColumn: 'name_ar', listColumns: 'id, name_ar, name_en, deleted_at' },
  case_documents:               { label: 'مستندات القضايا', idColumn: 'id', titleColumn: 'original_name', listColumns: 'id, original_name, case_id, deleted_at', caseScoped: true, ownsBytes: true },
  communications:               { label: 'المراسلات', idColumn: 'id', titleColumn: 'subject', listColumns: 'id, subject, case_id, deleted_at', caseScoped: true, ownsBytes: true },
  case_assignees:                { label: 'فريق القضية', idColumn: 'id', caseScoped: true, hidden: true },
  case_agency_channels:          { label: 'قنوات جهات القضية', idColumn: 'id', caseScoped: true, hidden: true },
  case_records_checklist:        { label: 'قوائم مراجعة القضية', idColumn: 'id', caseScoped: true, hidden: true },
  production_queue:              { label: 'قائمة المونتاج', idColumn: 'id', caseScoped: true, hidden: true },
  requests:                      { label: 'الطلبات', idColumn: 'id', caseScoped: true, hidden: true },
};

// `id`/`ids` are optional -- compound-key tables with no surrogate id
// (case_assignees, case_agency_channels) are matched purely on extraFilters.
async function softDelete(sup, { table, id, ids, userId, idColumn = 'id', extraFilters = {} }) {
  let q = sup.from(table).update({ deleted_at: new Date().toISOString(), deleted_by: userId || null });
  if (Array.isArray(ids)) q = q.in(idColumn, ids);
  else if (id !== undefined) q = q.eq(idColumn, id);
  for (const [k, v] of Object.entries(extraFilters)) q = q.eq(k, v);
  return q;
}

async function restoreItem(sup, { table, id, idColumn = 'id', extraFilters = {} }) {
  if (table === 'cases') return caseCascade.restoreCase(sup, { id });
  // checklist_templates' delete route also disables the template
  // (enabled:false) -- restore must undo that too, or the item vanishes
  // from Trash but stays invisible everywhere the template list is read.
  const updates = { deleted_at: null, deleted_by: null };
  if (table === 'checklist_templates') updates.enabled = true;
  let q = sup.from(table).update(updates).eq(idColumn, id);
  for (const [k, v] of Object.entries(extraFilters)) q = q.eq(k, v);
  return q;
}

// Byte/storage cleanup for case_documents/communications is handled by the
// CALLER (routes/trash.js), which has access to the gdrive/storage services
// -- this stays a plain row delete so the service itself doesn't need to
// import every storage backend.
async function permanentlyDelete(sup, { table, id, idColumn = 'id' }) {
  if (table === 'cases') return caseCascade.permanentlyDeleteCase(sup, { id });
  if (table === 'pipeline_lists') return _permanentlyDeletePipelineList(sup, id);
  if (table === 'case_documents') return _permanentlyDeleteCaseDocument(sup, id);
  if (table === 'communications') return _permanentlyDeleteCommunication(sup, id);
  return sup.from(table).delete().eq(idColumn, id);
}

// The byte-cleanup deferred out of case_detail.routes.js's/documentCenter.js's
// soft-delete routes -- only runs here, on the real permanent step.
async function _permanentlyDeleteCaseDocument(sup, id) {
  const { data: doc } = await sup.from('case_documents').select('storage_key, storage_provider, drive_file_id').eq('id', id).maybeSingle();
  await deleteDocumentBytes(doc);
  return sup.from('case_documents').delete().eq('id', id);
}

async function _permanentlyDeleteCommunication(sup, id) {
  const { data: comm } = await sup.from('communications').select('metadata').eq('id', id).maybeSingle();
  await deleteCommunicationAttachments(comm);
  return sup.from('communications').delete().eq('id', id);
}

// Moved out of routes/pipelineLists.js's DELETE route verbatim -- soft-delete
// must not touch other rows (it needs to stay cleanly restorable), so the
// requests-unlink and the list_number gap-close only happen here, for real,
// on the permanent step.
async function _permanentlyDeletePipelineList(sup, id) {
  const { data: gone } = await sup.from('pipeline_lists').select('list_number').eq('id', id).maybeSingle();
  const { error: unlinkErr } = await sup.from('requests').update({ classification_id: null, milestone_id: null }).eq('classification_id', id);
  if (unlinkErr) return { error: unlinkErr };
  const { error: deleteErr } = await sup.from('pipeline_lists').delete().eq('id', id);
  if (deleteErr) return { error: deleteErr };

  const { data: remaining } = await sup.from('pipeline_lists').select('id, list_number').order('list_number', { ascending: true });
  const oldToNew = new Map();
  for (let i = 0; i < (remaining || []).length; i++) {
    if (remaining[i].list_number !== i + 1) {
      oldToNew.set(String(remaining[i].list_number), String(i + 1));
      await sup.from('pipeline_lists').update({ list_number: i + 1 }).eq('id', remaining[i].id);
    }
  }
  // Per-role production-line visibility is keyed by list_number: drop the deleted
  // list's own rows and re-point the shifted ones, or the wrong lists end up hidden.
  const { remapProductionLineVisibility } = require('./pipelineMeta');
  await remapProductionLineVisibility(sup, oldToNew, gone ? gone.list_number : null);
  return { error: null };
}

// ---- helpers shared by the Trash routes and the AI assistant's trash tools ----

// Account / credential entities stay manageable ONLY from the Trash page itself: the
// assistant never lists, restores or purges them (re-enabling a deleted employee or
// role, or a stored credential, is not something a chat should be able to do).
const AI_TRASH_EXCLUDED = new Set(['users', 'roles', 'email_accounts', 'portal_credentials', 'ai_provider_configs']);

/** Registry config for an entity the AI may touch; throws a clear Arabic error otherwise. */
function aiTrashConfig(entityType) {
  const cfg = TRASH_REGISTRY[entityType];
  if (!cfg || cfg.hidden || AI_TRASH_EXCLUDED.has(entityType)) {
    const allowed = Object.entries(TRASH_REGISTRY).filter(([k, c]) => !c.hidden && !AI_TRASH_EXCLUDED.has(k)).map(([k]) => k).join(', ');
    throw new Error(`entity_type غير مدعوم: ${entityType}. المتاح: ${allowed}`);
  }
  return cfg;
}

/** Loads one row and verifies it is actually in the trash. Returns { row } or { status, error }. */
async function getTrashedRow(sup, table, id) {
  const cfg = TRASH_REGISTRY[table];
  if (!cfg) return { status: 400, error: 'نوع غير صالح' };
  if (!Number.isInteger(id)) return { status: 400, error: 'معرّف غير صالح' };
  const cols = Array.from(new Set(['deleted_at', ...String(cfg.listColumns || cfg.idColumn).split(',').map(c => c.trim())])).join(', ');
  const { data: row, error } = await sup.from(table).select(cols).eq(cfg.idColumn, id).maybeSingle();
  if (error) return { status: 500, error: error.message };
  if (!row) return { status: 404, error: 'العنصر غير موجود' };
  if (!row.deleted_at) return { status: 409, error: 'العنصر ليس في سلة المحذوفات' };
  return { row };
}

/** Case scoping for a trashed row: a user restricted to their own cases only touches those cases' items. */
async function canTouchTrashedRow(sup, user, table, row) {
  const { canAccessCase } = require('./caseAccess');
  if (table === 'cases') return canAccessCase(sup, user, row.id);
  if (TRASH_REGISTRY[table]?.caseScoped && row.case_id) return canAccessCase(sup, user, row.case_id);
  return true;
}

module.exports = { TRASH_REGISTRY, softDelete, restoreItem, permanentlyDelete, AI_TRASH_EXCLUDED, aiTrashConfig, getTrashedRow, canTouchTrashedRow };
