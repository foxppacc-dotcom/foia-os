// Shared helpers for per-list labels/milestones on pipeline cards (requests).
// Labels and milestones belong to ONE list; a card (request) can only carry
// the ones that belong to the list it currently sits in. Read-side filtering
// below enforces that regardless of which code path last moved the card, so a
// stale label from a previous list can never leak onto a card.

const CHUNK = 200;

/** The "Not Started" list also holds requests that were never classified (classification_id null). */
async function getNotStartedListId(sup) {
  const { data } = await sup.from('pipeline_lists').select('id').eq('name_en', 'Not Started').is('deleted_at', null).limit(1);
  return data?.[0]?.id ?? null;
}

/** The list a request effectively sits in. */
function effectiveListId(request, notStartedId) {
  return request.classification_id != null ? request.classification_id : notStartedId;
}

/**
 * Attach `labels: [{id,name,color}]` and `milestone: {id,name,color}|null`
 * to every request in place (returns the same array). Separate queries merged
 * in JS on purpose -- no new PostgREST embeds on `requests`.
 */
async function attachLabelsAndMilestones(sup, requests, notStartedId) {
  const list = requests || [];
  if (!list.length) return list;
  const ns = notStartedId === undefined ? await getNotStartedListId(sup) : notStartedId;

  const [{ data: labels }, { data: milestones }] = await Promise.all([
    sup.from('pipeline_list_labels').select('id, list_id, name, color, sort_order').is('deleted_at', null),
    sup.from('pipeline_list_milestones').select('id, list_id, name, color, sort_order').is('deleted_at', null),
  ]);
  const labelById = new Map((labels || []).map(l => [l.id, l]));
  const milestoneById = new Map((milestones || []).map(m => [m.id, m]));

  const ids = list.map(r => r.id);
  const links = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data } = await sup.from('request_labels').select('request_id, label_id').in('request_id', ids.slice(i, i + CHUNK));
    if (data) links.push(...data);
  }
  const byRequest = new Map();
  for (const l of links) {
    if (!byRequest.has(l.request_id)) byRequest.set(l.request_id, []);
    byRequest.get(l.request_id).push(l.label_id);
  }

  for (const r of list) {
    const listId = effectiveListId(r, ns);
    r.labels = (byRequest.get(r.id) || [])
      .map(id => labelById.get(id))
      .filter(l => l && l.list_id === listId)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
      .map(l => ({ id: l.id, name: l.name, color: l.color }));
    const m = r.milestone_id != null ? milestoneById.get(r.milestone_id) : null;
    r.milestone = m && m.list_id === listId ? { id: m.id, name: m.name, color: m.color } : null;
  }
  return list;
}

/** A list's own live labels/milestones, ordered. */
async function getListMeta(sup, listId) {
  const [{ data: labels }, { data: milestones }] = await Promise.all([
    sup.from('pipeline_list_labels').select('id, list_id, name, color, sort_order').eq('list_id', listId).is('deleted_at', null).order('sort_order').order('id'),
    sup.from('pipeline_list_milestones').select('id, list_id, name, color, sort_order').eq('list_id', listId).is('deleted_at', null).order('sort_order').order('id'),
  ]);
  return { labels: labels || [], milestones: milestones || [] };
}

/**
 * Per-role Production Line visibility (role_permissions resource='production_line',
 * action=<list_number>) is keyed by list NUMBER. Whenever list numbers change
 * (drag reorder, permanent delete closing a gap) the rows must be re-pointed to
 * the new numbers, otherwise a hidden list silently swaps places with whichever
 * list lands on its old number. `oldToNew` is a Map of old number -> new number
 * (strings); `dropNumber` optionally removes the rows of a list that no longer exists.
 */
async function remapProductionLineVisibility(sup, oldToNew, dropNumber) {
  try {
    if (dropNumber != null) await sup.from('role_permissions').delete().eq('resource', 'production_line').eq('action', String(dropNumber));
    if (!oldToNew || !oldToNew.size) return;
    const { data: visRows } = await sup.from('role_permissions').select('id, action').eq('resource', 'production_line');
    const moving = (visRows || []).filter(r => oldToNew.has(String(r.action)));
    // Two-phase because of UNIQUE(role, resource, action).
    for (const r of moving) await sup.from('role_permissions').update({ action: 'tmp:' + r.id }).eq('id', r.id);
    for (const r of moving) await sup.from('role_permissions').update({ action: oldToNew.get(String(r.action)) }).eq('id', r.id);
  } catch (e) { console.error('[pipelineMeta] production_line visibility remap failed:', e.message); }
}

module.exports = { getNotStartedListId, effectiveListId, attachLabelsAndMilestones, getListMeta, remapProductionLineVisibility };
