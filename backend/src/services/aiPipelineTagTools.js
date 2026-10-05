// The assistant's view of, and control over, each pipeline list's Labels and Milestones
// (the per-list tags management configures inside every list) and the tags on cards.
//   get_list_tags      -- read: every list's labels/milestones and how many cards use each
//   manage_list_tags   -- create / rename / recolor / delete a label or milestone inside a list
//   tag_request        -- put labels / a milestone on a card (a request), or take them off
// Rules mirror routes/pipelineListMeta.js exactly (names 1-40 chars, #RRGGBB colors, unique
// per list, labels and milestones belong to ONE list) and the same permissions apply to the
// person chatting: pipeline:manage_labels to manage them, pipeline:edit to tag a card.
const { hasPermission } = require('../middleware/auth');
const { canAccessCase, canViewAllCases, getVisibleCaseIds } = require('./caseAccess');
const { logActivity } = require('./activityLogger');
const { getNotStartedListId, effectiveListId } = require('./pipelineMeta');

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_PER_LIST = 50;
const COLOR_NAMES = {
  أحمر: '#EF4444', احمر: '#EF4444', red: '#EF4444', برتقالي: '#F97316', orange: '#F97316', أصفر: '#EAB308', اصفر: '#EAB308', yellow: '#EAB308',
  أخضر: '#10B981', اخضر: '#10B981', green: '#10B981', فيروزي: '#14B8A6', teal: '#14B8A6', سماوي: '#06B6D4', cyan: '#06B6D4',
  أزرق: '#3B82F6', ازرق: '#3B82F6', blue: '#3B82F6', نيلي: '#6366F1', indigo: '#6366F1', بنفسجي: '#8B5CF6', purple: '#8B5CF6',
  وردي: '#EC4899', pink: '#EC4899', رمادي: '#6B7280', gray: '#6B7280', grey: '#6B7280', بني: '#92400E', brown: '#92400E',
};
const PALETTE = ['#EF4444', '#F97316', '#EAB308', '#10B981', '#14B8A6', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899'];

const clean = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
function resolveColor(input, fallbackIndex = 0) {
  if (!input) return PALETTE[fallbackIndex % PALETTE.length];
  const t = String(input).trim();
  const hex = t.startsWith('#') ? t : `#${t}`;
  if (COLOR_RE.test(hex)) return hex.toUpperCase();
  const named = COLOR_NAMES[t.toLowerCase()];
  if (named) return named;
  throw new Error(`لون غير مفهوم: ${t} (استخدم #RRGGBB أو اسم لون مثل أحمر/أزرق/أخضر)`);
}

async function allLists(sup) {
  const { data } = await sup.from('pipeline_lists').select('id, name_ar, name_en, list_number').is('deleted_at', null).order('list_number');
  return data || [];
}
async function resolveList(sup, { list_id, list }) {
  const lists = await allLists(sup);
  if (list_id) { const l = lists.find(x => x.id === parseInt(list_id)); if (!l) throw new Error('القائمة غير موجودة'); return l; }
  if (!list) throw new Error('list_id أو list (اسم القائمة) مطلوب');
  const needle = String(list).toLowerCase().trim();
  let matches = lists.filter(l => `${l.name_ar || ''}`.toLowerCase().trim() === needle || `${l.name_en || ''}`.toLowerCase().trim() === needle);
  if (!matches.length) matches = lists.filter(l => `${l.name_ar || ''} ${l.name_en || ''}`.toLowerCase().includes(needle));
  if (!matches.length) throw new Error(`لا توجد قائمة بهذا الاسم. القوائم: ${lists.map(l => l.name_ar || l.name_en).join('، ')}`);
  if (matches.length > 1) throw new Error(`أكثر من قائمة تطابق "${list}": ${matches.map(l => `${l.id}: ${l.name_ar || l.name_en}`).join(' | ')} -- حدّد list_id`);
  return matches[0];
}

// ---------------------------------------------------------------- get_list_tags
async function getListTags(sup, input = {}, ctx) {
  const lists = input.list_id || input.list ? [await resolveList(sup, input)] : await allLists(sup);
  const [{ data: labels }, { data: milestones }, { data: links }, { data: reqs }] = await Promise.all([
    sup.from('pipeline_list_labels').select('id, list_id, name, color, sort_order').is('deleted_at', null).order('sort_order').order('id'),
    sup.from('pipeline_list_milestones').select('id, list_id, name, color, sort_order').is('deleted_at', null).order('sort_order').order('id'),
    sup.from('request_labels').select('request_id, label_id'),
    sup.from('requests').select('id, case_id, milestone_id').is('deleted_at', null),
  ]);
  // usage counts only over cards the user may see
  const vis = (await canViewAllCases(sup, ctx.user.role)) ? null : new Set(await getVisibleCaseIds(sup, ctx.user.id));
  const visibleReq = new Set((reqs || []).filter(r => !vis || vis.has(r.case_id)).map(r => r.id));
  const labelUse = {}; (links || []).forEach(l => { if (visibleReq.has(l.request_id)) labelUse[l.label_id] = (labelUse[l.label_id] || 0) + 1; });
  const msUse = {}; (reqs || []).forEach(r => { if (r.milestone_id && visibleReq.has(r.id)) msUse[r.milestone_id] = (msUse[r.milestone_id] || 0) + 1; });
  return {
    lists: lists.map(l => ({
      list_id: l.id, list: l.name_ar || l.name_en,
      labels: (labels || []).filter(x => x.list_id === l.id).map(x => ({ id: x.id, name: x.name, color: x.color, cards: labelUse[x.id] || 0 })),
      milestones: (milestones || []).filter(x => x.list_id === l.id).map(x => ({ id: x.id, name: x.name, color: x.color, cards: msUse[x.id] || 0 })),
    })),
  };
}

// ---------------------------------------------------------------- manage_list_tags
async function manageListTags(sup, input = {}, ctx) {
  const { kind, action } = input; // kind: label | milestone ; action: create | update | delete
  if (!['label', 'milestone'].includes(kind)) throw new Error('kind يجب أن يكون label أو milestone');
  if (!['create', 'update', 'delete'].includes(action)) throw new Error('action يجب أن يكون create أو update أو delete');
  if (!(await hasPermission(sup, ctx.user, 'pipeline', 'manage_labels'))) throw new Error('Forbidden — لا تملك صلاحية إدارة الـ Labels والـ Milestones');
  const table = kind === 'label' ? 'pipeline_list_labels' : 'pipeline_list_milestones';
  const ar = kind === 'label' ? 'Label' : 'Milestone';

  if (action === 'create') {
    const list = await resolveList(sup, input);
    const name = clean(input.name);
    if (!name || name.length > 40) throw new Error('الاسم مطلوب (حتى 40 حرفًا)');
    const { data: existing } = await sup.from(table).select('id, name, sort_order').eq('list_id', list.id).is('deleted_at', null);
    if ((existing || []).length >= MAX_PER_LIST) throw new Error(`الحد الأقصى ${MAX_PER_LIST} في القائمة الواحدة`);
    if ((existing || []).some(e => e.name.toLowerCase() === name.toLowerCase())) throw new Error('يوجد عنصر بنفس الاسم في هذه القائمة');
    const color = resolveColor(input.color, (existing || []).length);
    const nextOrder = (existing || []).reduce((m, e) => Math.max(m, e.sort_order || 0), 0) + 1;
    const { data, error } = await sup.from(table).insert({ list_id: list.id, name, color, sort_order: nextOrder }).select('id, name, color').single();
    if (error) throw error;
    logActivity({ user_id: ctx.user?.id, user_name: ctx.user?.name, action_type: `pipeline_${kind}_created`, target_type: 'pipeline_list', target_id: list.id, target_title: list.name_ar, details: `إضافة ${ar} "${name}" في القائمة ${list.name_ar || list.name_en} (بواسطة المساعد الذكي)` });
    return { created: true, kind, id: data.id, name: data.name, color: data.color, list: list.name_ar || list.name_en };
  }

  const itemId = parseInt(input.id);
  if (!itemId) throw new Error('id مطلوب لهذا الإجراء (احصل عليه من get_list_tags)');
  const { data: item } = await sup.from(table).select('id, list_id, name, color').eq('id', itemId).is('deleted_at', null).maybeSingle();
  if (!item) throw new Error(`${ar} غير موجود`);

  if (action === 'update') {
    const updates = {};
    if (input.name !== undefined) {
      const name = clean(input.name);
      if (!name || name.length > 40) throw new Error('الاسم مطلوب (حتى 40 حرفًا)');
      const { data: sib } = await sup.from(table).select('id, name').eq('list_id', item.list_id).is('deleted_at', null);
      if ((sib || []).some(s => s.id !== itemId && s.name.toLowerCase() === name.toLowerCase())) throw new Error('يوجد عنصر بنفس الاسم في هذه القائمة');
      updates.name = name;
    }
    if (input.color !== undefined) updates.color = resolveColor(input.color);
    if (!Object.keys(updates).length) throw new Error('لا توجد تعديلات (name أو color)');
    const { data, error } = await sup.from(table).update(updates).eq('id', itemId).select('id, name, color').single();
    if (error) throw error;
    logActivity({ user_id: ctx.user?.id, user_name: ctx.user?.name, action_type: `pipeline_${kind}_updated`, target_type: 'pipeline_list', target_id: item.list_id, details: `تعديل ${ar} "${item.name}"${updates.name ? ` → "${updates.name}"` : ''} (بواسطة المساعد الذكي)` });
    return { updated: true, kind, id: data.id, name: data.name, color: data.color };
  }

  // delete (soft) + detach from cards
  const { error } = await sup.from(table).update({ deleted_at: new Date().toISOString() }).eq('id', itemId);
  if (error) throw error;
  if (kind === 'label') await sup.from('request_labels').delete().eq('label_id', itemId);
  else await sup.from('requests').update({ milestone_id: null }).eq('milestone_id', itemId);
  logActivity({ user_id: ctx.user?.id, user_name: ctx.user?.name, action_type: `pipeline_${kind}_deleted`, target_type: 'pipeline_list', target_id: item.list_id, details: `حذف ${ar} "${item.name}" (بواسطة المساعد الذكي)` });
  return { deleted: true, kind, id: itemId, name: item.name, notice: 'تمت إزالته من كل البطاقات.' };
}

// ---------------------------------------------------------------- tag_request
async function tagRequest(sup, input = {}, ctx) {
  const requestId = parseInt(input.request_id);
  if (!requestId) throw new Error('request_id مطلوب');
  if (!(await hasPermission(sup, ctx.user, 'pipeline', 'edit'))) throw new Error('Forbidden — لا تملك صلاحية تعديل بطاقات خط الإنتاج');
  const { data: r } = await sup.from('requests').select('id, case_id, classification_id, milestone_id').eq('id', requestId).is('deleted_at', null).maybeSingle();
  if (!r) throw new Error('الطلب غير موجود');
  if (!(await canAccessCase(sup, ctx.user, r.case_id))) throw new Error('Forbidden — هذه القضية غير مسندة إليك');
  const listId = effectiveListId(r, await getNotStartedListId(sup));

  const [{ data: labels }, { data: milestones }, { data: current }] = await Promise.all([
    sup.from('pipeline_list_labels').select('id, name').eq('list_id', listId).is('deleted_at', null),
    sup.from('pipeline_list_milestones').select('id, name').eq('list_id', listId).is('deleted_at', null),
    sup.from('request_labels').select('label_id').eq('request_id', requestId),
  ]);
  const findLabel = (v) => {
    const byId = (labels || []).find(l => l.id === parseInt(v)); if (byId) return byId;
    const byName = (labels || []).find(l => l.name.toLowerCase() === String(v).toLowerCase().trim());
    if (!byName) throw new Error(`لا يوجد Label "${v}" في قائمة هذا الطلب. المتاح: ${(labels || []).map(l => l.name).join('، ') || 'لا شيء'}`);
    return byName;
  };
  const toList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

  const result = {};
  const add = toList(input.add_labels).map(findLabel);
  const remove = toList(input.remove_labels).map(findLabel);
  const set = input.set_labels !== undefined ? toList(input.set_labels).map(findLabel) : null;
  if (add.length || remove.length || set) {
    let ids = new Set((current || []).map(c => c.label_id).filter(id => (labels || []).some(l => l.id === id)));
    if (set) ids = new Set(set.map(l => l.id));
    add.forEach(l => ids.add(l.id)); remove.forEach(l => ids.delete(l.id));
    const { error: delErr } = await sup.from('request_labels').delete().eq('request_id', requestId);
    if (delErr) throw delErr;
    if (ids.size) { const { error } = await sup.from('request_labels').insert([...ids].map(label_id => ({ request_id: requestId, label_id }))); if (error) throw error; }
    result.labels = (labels || []).filter(l => ids.has(l.id)).map(l => l.name);
  }
  if (input.milestone !== undefined) {
    if (input.milestone === null || input.milestone === '' || input.milestone === 'none') {
      await sup.from('requests').update({ milestone_id: null }).eq('id', requestId); result.milestone = null;
    } else {
      const m = (milestones || []).find(x => x.id === parseInt(input.milestone) || x.name.toLowerCase() === String(input.milestone).toLowerCase().trim());
      if (!m) throw new Error(`لا يوجد Milestone "${input.milestone}" في قائمة هذا الطلب. المتاح: ${(milestones || []).map(x => x.name).join('، ') || 'لا شيء'}`);
      const { error } = await sup.from('requests').update({ milestone_id: m.id }).eq('id', requestId);
      if (error) throw error;
      result.milestone = m.name;
    }
  }
  if (!Object.keys(result).length) throw new Error('لا يوجد ما يُغيَّر (add_labels / remove_labels / set_labels / milestone)');
  logActivity({ user_id: ctx.user?.id, user_name: ctx.user?.name, action_type: 'pipeline_card_tags', target_type: 'case', target_id: r.case_id, details: `تحديث تصنيفات البطاقة #${requestId}: ${JSON.stringify(result)} (بواسطة المساعد الذكي)` });
  return { request_id: requestId, ...result };
}

const TAG_TOOL_DEFS = [
  {
    name: 'get_list_tags', permission: 'get_list_tags',
    description: 'الـ Labels والـ Milestones المعرّفة داخل كل قائمة في خط الإنتاج (اسم ولون وعدد البطاقات التي تستخدم كلًا منها). اترك الباراميترات لعرض كل القوائم أو حدّد list_id أو list (اسم القائمة). استخدمها لتقييم كيف تُنظَّم القوائم قبل أي تعديل.',
    input_schema: { type: 'object', properties: { list_id: { type: 'number' }, list: { type: 'string', description: 'اسم القائمة أو جزء منه' } } },
    run: (sup, input, ctx) => getListTags(sup, input, ctx),
  },
  {
    name: 'manage_list_tags', permission: 'manage_list_tags',
    description: 'إنشاء أو تعديل (اسم/لون) أو حذف Label أو Milestone داخل قائمة معينة في خط الإنتاج (يحتاج صلاحية إدارة الـ Labels والـ Milestones). kind=label|milestone، action=create|update|delete. الإنشاء: list_id أو list + name + color اختياري (#RRGGBB أو اسم لون). التعديل/الحذف: id من get_list_tags. الحذف يزيله من كل البطاقات؛ نفّذه فقط بناءً على طلب صريح.',
    input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['label', 'milestone'] }, action: { type: 'string', enum: ['create', 'update', 'delete'] }, list_id: { type: 'number' }, list: { type: 'string' }, id: { type: 'number' }, name: { type: 'string' }, color: { type: 'string' } }, required: ['kind', 'action'] },
    run: (sup, input, ctx) => manageListTags(sup, input, ctx),
  },
  {
    name: 'tag_request', permission: 'tag_request',
    description: 'وضع/إزالة Labels وMilestone على بطاقة (طلب) معينة داخل قائمتها (يحتاج صلاحية تعديل خط الإنتاج). add_labels / remove_labels / set_labels (مصفوفة بأسماء أو أرقام)، milestone (اسم أو رقم، أو null للإزالة). يجب أن تكون من تلك القائمة نفسها؛ إن لم توجد أنشئها أولًا بـ manage_list_tags.',
    input_schema: { type: 'object', properties: { request_id: { type: 'number' }, add_labels: { type: 'array', items: {} }, remove_labels: { type: 'array', items: {} }, set_labels: { type: 'array', items: {} }, milestone: {} }, required: ['request_id'] },
    run: (sup, input, ctx) => tagRequest(sup, input, ctx),
  },
];

module.exports = { TAG_TOOL_DEFS };
