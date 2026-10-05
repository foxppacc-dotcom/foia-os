const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const trash = require('../services/trash');
const aiDraftRegistry = require('../services/aiDraftRegistry');
const { logActivity } = require('../services/activityLogger');

router.use(requireAuth);

// GET /api/trash — one row per trashed item across every browsable entity
// in TRASH_REGISTRY (hidden case-dependent join tables are skipped -- they
// only ever make sense nested under a restored case, never on their own).
router.get('/trash', requirePermission('trash', 'view'), async (req, res) => {
  try {
    const sup = getSupabase();
    const entries = Object.entries(trash.TRASH_REGISTRY).filter(([, cfg]) => !cfg.hidden);

    const results = await Promise.allSettled(entries.map(([table, cfg]) =>
      sup.from(table).select(cfg.listColumns).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })
        .then(r => {
          if (r.error) throw r.error;
          return (r.data || []).map(row => ({
            entity_type: table,
            entity_label: cfg.label,
            id: row[cfg.idColumn],
            title: row[cfg.titleColumn] || null,
            deleted_at: row.deleted_at,
            case_id: cfg.caseScoped ? row.case_id : null,
            row,
          }));
        })
    ));

    const items = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') items.push(...r.value);
      else console.error(`[trash] list failed for "${entries[i][0]}":`, r.reason?.message || r.reason);
    });
    items.sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));

    res.json({ success: true, data: items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Restore/purge must only ever act on a row that is ACTUALLY in the trash.
// Without this, DELETE /trash/cases/123 on a LIVE case hard-deleted it (and all
// its dependents + Drive bytes), bypassing the soft-delete safety net, and an
// unknown id came back as {success:true}.
async function checkTrashed(sup, table, cfg, id) {
  if (!Number.isInteger(id)) return { status: 400, error: 'معرّف غير صالح' };
  const { data: row, error } = await sup.from(table).select('deleted_at').eq(cfg.idColumn, id).maybeSingle();
  if (error) return { status: 500, error: error.message };
  if (!row) return { status: 404, error: 'العنصر غير موجود' };
  if (!row.deleted_at) return { status: 409, error: 'العنصر ليس في سلة المحذوفات' };
  return null;
}

// POST /api/trash/:table/:id/restore
router.post('/trash/:table/:id/restore', requirePermission('trash', 'restore'), async (req, res) => {
  try {
    const { table } = req.params;
    const cfg = trash.TRASH_REGISTRY[table];
    if (!cfg) return res.status(400).json({ error: 'نوع غير صالح' });
    const sup = getSupabase();
    const bad = await checkTrashed(sup, table, cfg, parseInt(req.params.id));
    if (bad) return res.status(bad.status).json({ error: bad.error });
    const { error } = await trash.restoreItem(sup, { table, id: parseInt(req.params.id), idColumn: cfg.idColumn });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/trash/:table/:id — permanent, no way back past this point
router.delete('/trash/:table/:id', requirePermission('trash', 'destroy'), async (req, res) => {
  try {
    const { table } = req.params;
    const cfg = trash.TRASH_REGISTRY[table];
    if (!cfg) return res.status(400).json({ error: 'نوع غير صالح' });
    const sup = getSupabase();
    const bad = await checkTrashed(sup, table, cfg, parseInt(req.params.id));
    if (bad) return res.status(bad.status).json({ error: bad.error });
    const { error } = await trash.permanentlyDelete(sup, { table, id: parseInt(req.params.id), idColumn: cfg.idColumn });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/trash/ai-purge-confirm -- the human "حذف نهائي" click on a purge the AI
// assistant PROPOSED (aiTools.js permanently_delete_from_trash). The assistant can
// never purge on its own: it only registers a single-use token bound to
// (this user, this exact entity + id); only this route, called from the confirm
// button, consumes it. Still needs the user's own trash:destroy permission.
router.post('/trash/ai-purge-confirm', requirePermission('trash', 'destroy'), async (req, res) => {
  try {
    const { draft_token, entity_type } = req.body;
    const id = parseInt(req.body.id);
    let cfg;
    try { cfg = trash.aiTrashConfig(entity_type); } catch (e) { return res.status(400).json({ error: e.message }); }
    if (!aiDraftRegistry.consume(draft_token, req.user.id, id, `purge:${entity_type}:${id}`)) {
      return res.status(403).json({ error: 'انتهت صلاحية طلب الموافقة أو لا يطابق ما اقترحه المساعد -- اطلب من المساعد من جديد' });
    }
    const sup = getSupabase();
    const found = await trash.getTrashedRow(sup, entity_type, id);
    if (found.error) return res.status(found.status).json({ error: found.error });
    if (!(await trash.canTouchTrashedRow(sup, req.user, entity_type, found.row))) {
      return res.status(403).json({ error: 'Forbidden — هذا العنصر يخص قضية غير مسندة إليك' });
    }
    const { error } = await trash.permanentlyDelete(sup, { table: entity_type, id, idColumn: cfg.idColumn });
    if (error) return res.status(400).json({ error: error.message });
    logActivity({
      user_id: req.user?.id, user_name: req.user?.name,
      action_type: 'trash_purge', target_type: entity_type, target_id: id,
      target_title: String(found.row[cfg.titleColumn] || '').slice(0, 120),
      details: 'حذف نهائي من سلة المحذوفات بموافقة المستخدم على اقتراح المساعد الذكي',
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
