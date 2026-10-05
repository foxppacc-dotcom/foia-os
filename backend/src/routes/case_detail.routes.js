const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
router.use(requireAuth);
const { getSupabase } = require('../supabase');
const { canAccessCase, requireCaseAccess } = require('../services/caseAccess');
const trash = require('../services/trash');
const { isSafeLinkUrl } = require('../services/urlSafety');
// Every route below except /dashboard previously had ZERO per-case access
// check -- a role restricted to its own assigned cases could read/mutate
// ANY case's team, checklist, requests, documents, or timeline just by
// knowing its numeric id. requireCaseAccess('id') mounted per-route below
// closes this uniformly (every path here carries the case id as :id
// directly, confirmed by inspection).
const caseGate = requireCaseAccess('id');
const { notifyUsers, getCaseRecipients, getCaseActivityRecipients } = require('../services/notificationService');

// Same rule as cases.js's own GET /cases/:id: a trashed case's dependents
// share its exact deleted_at -- only exclude individually-trashed rows on
// an otherwise-active case, so a trashed case still shows its full
// last-known state (needed for the restore banner to be useful at all).
function applyIfActive(query, caseRow) {
  return caseRow?.deleted_at ? query : query.is('deleted_at', null);
}

// GET /api/cases/:id/dashboard — combined overview
router.get('/cases/:id/dashboard', requirePermission('cases', 'view'), async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);

    if (!(await canAccessCase(sup, req.user, caseId))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }

    // Fetch case first (required)
    const caseRow = await sup.from('cases').select('*').eq('id', caseId).single();
    if (caseRow.error) return res.status(404).json({ error: 'Case not found' });

    // Opening the case is itself the "I saw this" signal for its own
    // activity badge in القضايا (Cases.jsx) -- clear it here instead of
    // requiring a separate click per notification. Fire-and-forget: must
    // never slow down or fail the dashboard load itself.
    sup.from('notifications').update({ is_read: true })
      .eq('user_id', req.user.id).eq('target_type', 'case').eq('target_id', caseId).eq('is_read', false)
      .then(() => {}).catch(() => {});

    // Fetch all other data independently — failures are non-fatal
    const [team, requests, checklist, documents, timeline, channels, comments] = await Promise.all([
      applyIfActive(sup.from('case_assignees').select('*').eq('case_id', caseId), caseRow.data).then(r => {
        if (r.error) return [];
        return r.data || [];
      }).then(async (assignees) => {
        // Batch fetch user names separately (no FK join)
        if (!assignees.length) return [];
        const ids = [...new Set(assignees.map(a => a.user_id))];
        const { data: users } = await sup.from('users').select('id, name, email').in('id', ids);
        const userMap = {};
        (users || []).forEach(u => userMap[u.id] = u);
        return assignees.map(a => ({ ...a, users: userMap[a.user_id] || null }));
      }),
      applyIfActive(sup.from('requests').select('*').eq('case_id', caseId), caseRow.data).then(async (r) => {
        if (r.error) return [];
        const reqs = r.data || [];
        // Batch fetch agencies + overdue-acknowledgment users separately
        const agencyIds = [...new Set(reqs.map(r => r.agency_id).filter(Boolean))];
        const ackUserIds = [...new Set(reqs.map(r => r.overdue_ack_by).filter(Boolean))];
        const [{ data: ags }, { data: ackUsers }] = await Promise.all([
          agencyIds.length ? sup.from('agencies').select('*').in('id', agencyIds) : Promise.resolve({ data: [] }),
          ackUserIds.length ? sup.from('users').select('id, name').in('id', ackUserIds) : Promise.resolve({ data: [] }),
        ]);
        const agMap = {};
        (ags || []).forEach(a => agMap[a.id] = a);
        const ackUserMap = {};
        (ackUsers || []).forEach(u => ackUserMap[u.id] = u);
        return reqs.map(r => ({
          ...r,
          agencies: agMap[r.agency_id] || null,
          overdue_ack_user: r.overdue_ack_by ? (ackUserMap[r.overdue_ack_by] || null) : null,
        }));
      }),
      applyIfActive(sup.from('case_records_checklist').select('*').eq('case_id', caseId).order('record_type'), caseRow.data)
        .then(async (r) => r.error ? generateChecklist(sup, caseId) : (r.data?.length > 0 ? r.data : generateChecklist(sup, caseId)))
        // mergeChecklistWithLogs is intentionally NOT run here once rows are
        // real/persisted (the branch above only falls through to
        // generateChecklist for genuinely virtual/unpersisted data). It
        // replays the last activity_logs snapshot over the row's own fields,
        // so a fresh, successful PUT to case_records_checklist would get
        // silently overwritten back to whatever was last logged -- e.g.
        // clicking a status button in "حالة التحقيق" would appear to save,
        // then instantly revert on the next fetch. persistChecklist below
        // only inserts missing rows; it never touches existing ones.
        .then(cl => persistChecklist(sup, caseId, cl)),
      applyIfActive(sup.from('case_documents').select('*').eq('case_id', caseId).order('created_at', { ascending: false }), caseRow.data)
        .then(r => r.error ? [] : (r.data || [])),
      sup.from('activity_logs').select('*')
        .or(`and(target_type.eq.case,target_id.eq.${caseId}),and(target_type.eq.checklist,target_id.eq.${caseId}),and(target_type.eq.document,target_id.eq.${caseId}),and(target_type.eq.request,target_id.eq.${caseId}),and(target_type.eq.team,target_id.eq.${caseId})`)
        .order('created_at', { ascending: false }).limit(50)
        .then(r => r.error ? [] : (r.data || [])),
      applyIfActive(sup.from('case_agency_channels').select('*').eq('case_id', caseId).order('created_at'), caseRow.data)
        .then(r => r.error ? [] : (r.data || [])),
      // Team discussion (نقاش الفريق) -- human-posted notes/comments on the
      // case, distinct from the auto-generated system entries (case
      // created, classified, document uploaded...) that also live in this
      // same table. No FK-embed relationship relied on (batch-fetch names
      // separately, same defensive pattern used for `team`/`requests` above)
      // since PostgREST's schema cache has been unreliable for embeds
      // elsewhere in this codebase (see portals.js's earlier fix).
      applyIfActive(sup.from('case_comments').select('*').eq('case_id', caseId).order('created_at', { ascending: false }), caseRow.data)
        .then(async (r) => {
          if (r.error) return [];
          const rows = r.data || [];
          const userIds = [...new Set(rows.map(c => c.user_id).filter(Boolean))];
          const { data: users } = userIds.length ? await sup.from('users').select('id, name').in('id', userIds) : { data: [] };
          const userMap = Object.fromEntries((users || []).map(u => [u.id, u.name]));
          return rows.map(c => ({ ...c, user_name: c.user_id ? (userMap[c.user_id] || null) : null }));
        }),
    ]);

    const recordsProgress = {
      total: checklist?.length || 7,
      received: checklist?.filter(c => c.status === 'received').length || 0,
      pending: checklist?.filter(c => c.status === 'pending').length || 0,
      na: checklist?.filter(c => c.status === 'not_applicable').length || 0,
    };

    res.json({
      case: caseRow.data,
      team: team || [],
      requests: await mergeAgencyClassification(sup, caseId, requests || []),
      checklist: checklist || [],
      documents: documents || [],
      timeline: timeline || [],
      records_progress: recordsProgress,
      channels: channels || [],
      comments: comments || [],
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Merge virtual checklist with saved data from activity_logs
async function mergeChecklistWithLogs(sup, caseId, virtual) {
  try {
    const { data: logs } = await sup.from('activity_logs')
      .select('details')
      .eq('target_type', 'checklist')
      .eq('target_id', caseId)
      .order('created_at', { ascending: false });

    const savedMap = {};
    for (const log of logs || []) {
      try {
        const d = JSON.parse(log.details);
        if (d && d.record_type && !savedMap[d.record_type]) {
          savedMap[d.record_type] = d;
        }
      } catch(e) {}
    }

    return virtual.map(item => {
      const saved = savedMap[item.record_type];
      if (saved) {
        return {
          ...item,
          status: saved.status || item.status,
          doc_status: saved.doc_status || item.doc_status || item.status,
          receipt_status: saved.receipt_status || item.receipt_status || '',
          notes: saved.notes || item.notes || '',
          evidence_stage: saved.evidence_stage || item.evidence_stage || null,
        };
      }
      return item;
    });
  } catch(e) {
    return virtual;
  }
}

// Merge agency classifications from activity_logs into requests
async function mergeAgencyClassification(sup, caseId, requestsArray) {
  try {
    const ids = requestsArray.map(r => r.id).filter(Boolean);
    if (ids.length === 0) return requestsArray;
    
    const { data: logs } = await sup.from('activity_logs')
      .select('details, target_id')
      .eq('target_type', 'request_classification')
      .in('target_id', ids)
      .order('created_at', { ascending: false });

    const classMap = {};
    for (const log of logs || []) {
      if (!classMap[log.target_id]) {
        try {
          const d = JSON.parse(log.details);
          if (d && d.classification) {
            classMap[log.target_id] = d.classification;
          }
        } catch(e) {}
      }
    }

    return requestsArray.map(r => ({
      ...r,
      agency_classification: classMap[r.id] || r.agency_classification || null,
    }));
  } catch(e) {
    return requestsArray;
  }
}

// Generate checklist from templates or fallback to defaults (without 911_calls)
async function generateChecklist(sup, caseId) {
  try {
    const { data: templates } = await sup
      .from('checklist_templates')
      .select('*')
      .eq('enabled', true)
      .order('sort_order');
    if (templates && templates.length > 0) {
      return templates.map(t => ({
        case_id: caseId,
        template_id: t.id,
        record_type: t.record_type || t.title,
        status: 'pending',
        notes: '',
        evidence_stage: null,
        // These rows don't exist in case_records_checklist yet either --
        // must be marked the same as the hardcoded-fallback branch below so
        // persistChecklist() actually inserts them and assigns a real id.
        // Previously false here caused persistChecklist's `!items[0]._virtual`
        // guard to skip persistence entirely: every item kept id=undefined,
        // so React's per-item state (case_id keyed by item.id in
        // ChecklistTab) collapsed onto one shared key -- expanding/collapsing
        // any one checklist card visibly expanded/collapsed all of them.
        _virtual: true,
      }));
    }
  } catch (e) {
    console.warn('[checklist] Could not load templates:', e.message);
  }
  // Fallback: hardcoded defaults (NO 911 calls)
  return [
    { case_id: caseId, record_type: 'emergency_calls', status: 'pending', notes: '', _virtual: true },
    { case_id: caseId, record_type: 'cctv', status: 'pending', notes: '', _virtual: true },
    { case_id: caseId, record_type: 'body_cam', status: 'pending', notes: '', _virtual: true },
    { case_id: caseId, record_type: 'dash_cam', status: 'pending', notes: '', _virtual: true },
    { case_id: caseId, record_type: 'interrogation_video', status: 'pending', notes: '', _virtual: true },
    { case_id: caseId, record_type: 'victim_statement', status: 'pending', notes: '', _virtual: true },
  ];
}

// Try to persist virtual checklist items to the real table
async function persistChecklist(sup, caseId, items) {
  if (!items.length || !items[0]._virtual) return items;
  // supabase-js query builders resolve {data, error} rather than throwing, so
  // a bare `await ...insert(item)` here never populated `item.id` on the
  // returned rows -- every virtual checklist item rendered with the same
  // undefined id (React "duplicate key" warning in OverviewTab). Explicitly
  // select the generated id back, with a per-item synthetic fallback so IDs
  // stay unique even if the table/insert itself fails.
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    delete item._virtual;
    if (item.evidence_stage === undefined) item.evidence_stage = null;
    try {
      const { data, error } = await sup.from('case_records_checklist').insert(item).select('id').single();
      if (error) throw error;
      item.id = data.id;
    } catch (insertErr) {
      console.warn('[persistChecklist] insert error:', insertErr.message);
      item.id = -(i + 1);
    }
  }
  return items;
}

// GET /api/cases/:id/export-pdf — printable case summary: header, case
// summary, and every manually/FileFetch-uploaded file's name + clickable
// link. Deliberately excludes files whose `source` is 'email' (sent/received
// as an attachment) or 'discussion' (posted in a team-discussion comment) --
// only files someone actually filed under the case's own Documents tab (or a
// FileFetch submission, which lands the same way) belong in this report.
router.get('/cases/:id/export-pdf', requirePermission('cases', 'view'), async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    if (!(await canAccessCase(sup, req.user, caseId))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }
    const { data: caseRow, error: caseErr } = await sup.from('cases').select('id, title, case_summary').eq('id', caseId).single();
    if (caseErr || !caseRow) return res.status(404).json({ error: 'Case not found' });

    const { data: allDocs } = await sup.from('case_documents')
      .select('original_name, filename, url, file_path, source, upload_source, created_at')
      .eq('case_id', caseId).is('deleted_at', null)
      .order('created_at', { ascending: false });
    const docs = (allDocs || []).filter(d => d.source !== 'email' && d.source !== 'discussion');

    const { renderCasePdf } = require('../services/casePdfExport');
    const buffer = await renderCasePdf(caseRow, docs);
    // Downloaded file name itself should read "<case number> - <case title>"
    // -- filename* (RFC 5987) carries the real UTF-8 name (Arabic titles),
    // filename is a plain-ASCII fallback for any client that ignores filename*.
    const safeTitle = String(caseRow.title || 'بدون عنوان').replace(/[\\/:*?"<>|]/g, '').trim();
    const niceName = `${caseId} - ${safeTitle}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="case-${caseId}-export.pdf"; filename*=UTF-8''${encodeURIComponent(niceName)}`);
    res.send(buffer);
  } catch (ex) {
    console.error('[export-pdf] failed:', ex.message);
    res.status(500).json({ error: ex.message });
  }
});

// GET /api/cases/:id/team
router.get('/cases/:id/team', caseGate, async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    const { data, error } = await sup.from('case_assignees').select('*').eq('case_id', caseId).is('deleted_at', null);
    if (error) throw error;
    if (!data || data.length === 0) return res.json({ data: [] });
    // Batch fetch user names separately (no FK join)
    const ids = [...new Set(data.map(a => a.user_id))];
    const { data: users } = await sup.from('users').select('id, name, email').in('id', ids);
    const userMap = {};
    (users || []).forEach(u => userMap[u.id] = u);
    const result = data.map(a => ({ ...a, users: userMap[a.user_id] || null }));
    res.json({ data: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/cases/:id/team
router.post('/cases/:id/team', caseGate, async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    // caseGate only confirms this user is allowed to touch this case in
    // general -- not that the case isn't currently sitting in سلة
    // المحذوفات. Assigning someone to a trashed case's team should only
    // become possible again after it's restored.
    const { data: caseRow } = await sup.from('cases').select('deleted_at').eq('id', caseId).maybeSingle();
    if (caseRow?.deleted_at) return res.status(400).json({ error: 'لا يمكن تعديل فريق قضية موجودة في سلة المحذوفات' });
    const { user_id: userIdInput, role: roleType, specialty_id, custom_role_name } = req.body;
    const userId = parseInt(userIdInput) || parseInt(req.body.userId) || parseInt(req.body.user_id);
    if (!userId) return res.status(400).json({ error: 'user_id is required' });
    const user_id = userId;
    const fields = {
      role: roleType || 'member',
      specialty_id: specialty_id || null,
    };
    if (custom_role_name) fields.custom_role_name = custom_role_name;

    // Re-adding someone previously removed from this case's team would
    // otherwise try to INSERT a second (case_id, user_id) row on top of
    // their existing (now soft-deleted) one -- reactivate that row instead
    // of inserting a fresh one, whether or not a unique constraint would
    // have turned that into a raw duplicate-key 500.
    const { data: existing } = await sup.from('case_assignees').select('id').eq('case_id', caseId).eq('user_id', user_id).maybeSingle();

    let data, error;
    if (existing) {
      ({ data, error } = await sup.from('case_assignees').update({ ...fields, deleted_at: null, deleted_by: null }).eq('id', existing.id).select().single());
    } else {
      const insertData = { case_id: caseId, user_id, ...fields };
      ({ data, error } = await sup.from('case_assignees').insert(insertData).select().single());
      if (error && error.message.includes('custom_role_name')) {
        delete insertData.custom_role_name;
        ({ data, error } = await sup.from('case_assignees').insert(insertData).select().single());
      }
    }
    if (error) throw error;

    // Log activity
    await sup.from('activity_logs').insert({
      user_id: req.user.id, user_name: req.user.name,
      action_type: 'assign', target_type: 'team', target_id: caseId,
      target_title: `Assigned user #${user_id} as ${roleType || 'member'}`,
    });

    // target_type/target_id were previously never set here, so this
    // notification rendered in the bell but couldn't navigate anywhere when
    // clicked -- see notificationService.js. Skip if assigning yourself.
    if (user_id !== req.user?.id) {
      await notifyUsers(sup, [user_id], {
        type: 'case_update', title: '📋 تم تعيينك في قضية', body: `${req.user?.name || 'أحد الموظفين'} أضافك إلى فريق القضية #${caseId}`,
        target_type: 'case', target_id: caseId,
      });
    }

    res.status(201).json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/cases/:id/team/:userId
router.delete('/cases/:id/team/:userId', caseGate, async (req, res) => {
  try {
    const sup = getSupabase();
    const { error } = await trash.softDelete(sup, { table: 'case_assignees', userId: req.user?.id, extraFilters: { case_id: parseInt(req.params.id), user_id: parseInt(req.params.userId) } });
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== AGENCY COMMUNICATION CHANNELS ====================
// Per-(case, agency) portal link + email + filter keywords, used to help
// mailPoller.js auto-match an inbound email to this specific case even when
// nothing else (thread headers, reference number, agency's own address on
// file) resolves it -- see services/mailPoller.js tiers 3b/4b.

// POST /api/cases/:id/agencies/:agencyId/channels
router.post('/cases/:id/agencies/:agencyId/channels', caseGate, async (req, res) => {
  try {
    const sup = getSupabase();
    const { portal_link, email, filter_keywords } = req.body;
    if (!portal_link && !email && !filter_keywords) return res.status(400).json({ error: 'أدخل رابط بوابة أو بريد إلكتروني أو كلمات فلترة على الأقل' });
    if (portal_link && !isSafeLinkUrl(portal_link)) return res.status(400).json({ error: 'رابط البوابة غير صالح -- يجب أن يبدأ بـ http:// أو https://' });
    // Same split mailPoller.js's own matchToCase uses (each line/comma-separated
    // segment is checked independently against every new inbound email) --
    // reject the whole submission if ANY individual phrase is a generic
    // portal label rather than a real unique code (see isGenericFilterPhrase's
    // own comment for the live incident this prevents).
    if (filter_keywords) {
      const { isGenericFilterPhrase } = require('../services/mailPoller');
      const bad = filter_keywords.split(/[,\n]+/).map(p => p.trim()).filter(Boolean).find(isGenericFilterPhrase);
      if (bad) return res.status(400).json({ error: `"${bad}" عبارة عامة جدًا وموجودة في رسائل تأكيد أي بوابة تقريبًا -- استخدم الكود/الرقم الفعلي المميز فقط، مش تسمية الحقل` });
    }
    const { data, error } = await sup.from('case_agency_channels').insert({
      case_id: parseInt(req.params.id),
      agency_id: parseInt(req.params.agencyId),
      portal_link: portal_link || null,
      email: email || null,
      filter_keywords: filter_keywords || null,
    }).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, data });

    // A channel/keyword just added here may match an email that already
    // arrived and sat unlinked BEFORE this channel existed -- matching only
    // ever ran once, at ingestion time, so without this it would never be
    // caught. Fire-and-forget: the channel is already saved and the response
    // already sent, this is just a best-effort catch-up.
    try {
      const mailPoller = require('../services/mailPoller');
      mailPoller.rescanUnmatched().catch(e => console.error('[channels] rescanUnmatched failed:', e.message));
    } catch (e) { console.error('[channels] rescanUnmatched trigger failed:', e.message); }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/cases/rescan-unmatched — manually re-run email auto-matching
// against already-received, still-unlinked inbound messages using CURRENT
// case/agency/channel data. Meant to be triggered after editing anything
// that could affect matching (defendant name, title, source agency, request
// reference numbers) rather than only after adding a channel.
// System-wide (not case-scoped, so caseGate doesn't apply) and re-runs
// matching against EVERY still-unlinked inbound message -- a real,
// system-wide job, not a per-request lookup. It's meant for any
// case-handling user (triggered from AgenciesTab.jsx after editing data
// that affects matching), so gating it by role would break the feature for
// its actual users -- the real gap was that ANY authenticated user could
// re-trigger this expensive job back-to-back with no limit at all. A short
// global cooldown (not per-user -- there's no value in two people re-running
// the same system-wide scan seconds apart) closes that without restricting
// who can use it.
let lastRescanAt = 0;
const RESCAN_COOLDOWN_MS = 30 * 1000;
router.post('/cases/rescan-unmatched', async (req, res) => {
  try {
    const now = Date.now();
    if (now - lastRescanAt < RESCAN_COOLDOWN_MS) {
      return res.status(429).json({ error: 'تم فحص الرسائل مؤخرًا -- حاول بعد قليل' });
    }
    lastRescanAt = now;
    const mailPoller = require('../services/mailPoller');
    const result = await mailPoller.rescanUnmatched();
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/cases/:id/agencies/:agencyId/channels/:channelId
router.delete('/cases/:id/agencies/:agencyId/channels/:channelId', caseGate, async (req, res) => {
  try {
    const sup = getSupabase();
    const { error } = await trash.softDelete(sup, { table: 'case_agency_channels', id: parseInt(req.params.channelId), userId: req.user?.id, extraFilters: { case_id: parseInt(req.params.id) } });
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/cases/:id/checklist
router.get('/cases/:id/checklist', caseGate, async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    const { data, error } = await sup.from('case_records_checklist').select('*').eq('case_id', caseId).order('record_type');
    if (error || !data || data.length === 0) {
      // Table doesn't exist or empty — return virtual checklist merged with activity_logs
      const virtual = (await generateChecklist(sup, caseId)).map((item, i) => ({ ...item, id: -(i + 1) }));
      const merged = await mergeChecklistWithLogs(sup, caseId, virtual);
      return res.json({ data: merged });
    }
    res.json({ data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/cases/:id/checklist/:recordType
router.put('/cases/:id/checklist/:recordType', caseGate, async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    const { status, notes, doc_status, receipt_status, evidence_stage } = req.body;
    const recordType = req.params.recordType;

    // Try update on real table first
    const updateFields = {};
    if (doc_status !== undefined) updateFields.doc_status = doc_status;
    if (receipt_status !== undefined) updateFields.receipt_status = receipt_status;
    if (status !== undefined) updateFields.status = status;
    if (notes !== undefined) updateFields.notes = notes;
    if (evidence_stage !== undefined) updateFields.evidence_stage = evidence_stage;

    const { data, error } = await sup.from('case_records_checklist').update(updateFields)
      .eq('case_id', caseId).eq('record_type', recordType).select().single();

    // If table doesn't exist, log to activity_logs and return success
    if (error) {
      // Try UPSERT: insert the row if it doesn't exist
      const upsertData = { case_id: caseId, record_type: recordType, notes: notes || '', status: status || 'pending', evidence_stage: evidence_stage || null };
      if (evidence_stage !== undefined) upsertData.evidence_stage = evidence_stage;
      try { await sup.from('case_records_checklist').upsert(upsertData, { onConflict: 'case_id,record_type' }); } catch (uErr) { console.warn('[checklist] upsert error:', uErr.message); }
      
      const details = { record_type: recordType, notes, doc_status, receipt_status, status, evidence_stage };
      await sup.from('activity_logs').insert({
        user_id: req.user.id, user_name: req.user.name,
        action_type: 'update', target_type: 'checklist', target_id: caseId,
        target_title: `Updated ${recordType}${evidence_stage ? ' stage='+evidence_stage : ''}${status ? ' status='+status : ''}${notes ? ' ('+notes.substring(0,100)+')' : ''}`,
        details: JSON.stringify(details),
      });
      return res.json({ success: true, data: { case_id: caseId, record_type: recordType, notes, doc_status, receipt_status, status, evidence_stage, _virtual: true } });
    }

    await sup.from('activity_logs').insert({
      user_id: req.user.id, user_name: req.user.name,
      action_type: 'update', target_type: 'checklist', target_id: caseId,
      target_title: `Updated ${recordType} → ${evidence_stage || status || doc_status || receipt_status}`,
    });

    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/cases/:id/requests (enhanced with classification)
router.get('/cases/:id/requests', caseGate, async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    const { data, error } = await sup.from('requests').select('*').eq('case_id', caseId).is('deleted_at', null);
    if (error) throw error;
    if (!data || data.length === 0) return res.json({ data: [] });
    // Batch fetch agencies separately (no FK join)
    const agencyIds = [...new Set(data.map(r => r.agency_id).filter(Boolean))];
    if (!agencyIds.length) return res.json({ data });
    const { data: ags } = await sup.from('agencies').select('*').in('id', agencyIds).is('deleted_at', null);
    const agMap = {};
    (ags || []).forEach(a => agMap[a.id] = a);
    const result = data.map(r => ({ ...r, agencies: agMap[r.agency_id] || null }));
    res.json({ data: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/cases/:id/requests/:reqId/classification
router.put('/cases/:id/requests/:reqId/classification', caseGate, async (req, res) => {
  try {
    const sup = getSupabase();
    const reqId = parseInt(req.params.reqId);
    const { agency_classification } = req.body;

    // caseGate only confirms the caller can access case :id -- the update
    // below used to match on reqId alone with no relation back to :id at
    // all, so anyone with access to even one case could rewrite the
    // agency_classification of a request belonging to a completely
    // different, inaccessible case just by guessing/knowing its id. Confirm
    // reqId actually belongs to case :id before writing anything.
    const { data: existingReq } = await sup.from('requests').select('id, case_id').eq('id', reqId).maybeSingle();
    if (!existingReq || existingReq.case_id !== parseInt(req.params.id)) {
      return res.status(404).json({ error: 'Request not found on this case' });
    }

    // Try direct update first
    const { error } = await sup.from('requests').update({ agency_classification }).eq('id', reqId);
    
    // If column doesn't exist, save to activity_logs as fallback
    if (error && error.message?.includes('agency_classification')) {
      // Load existing details for this request, update classification
      const { data: existingLogs } = await sup.from('activity_logs')
        .select('details')
        .eq('target_type', 'request_classification')
        .eq('target_id', reqId)
        .order('created_at', { ascending: false }).limit(1);
      
      await sup.from('activity_logs').insert({
        user_id: req.user.id, user_name: req.user.name,
        action_type: 'update', target_type: 'request_classification', target_id: reqId,
        target_title: `صنّف الجهة: ${agency_classification}`,
        details: JSON.stringify({ agency_id: req.params.id, classification: agency_classification }),
      });
      return res.json({ success: true, _fallback: true, agency_classification });
    }
    if (error) throw error;
    res.json({ success: true, agency_classification });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const REPLY_OUTCOMES = ['pending', 'records_received', 'no_records', 'rejected', 'payment_requested'];

// PUT /api/cases/:id/requests/:reqId/reply-outcome — what the agency actually
// did (sent records / said none exist / rejected / asked for payment), so both
// staff and the AI assistant can filter/monitor agencies by real outcome, not
// just the coarse pending/sent/responded workflow status.
router.put('/cases/:id/requests/:reqId/reply-outcome', caseGate, async (req, res) => {
  try {
    const sup = getSupabase();
    const reqId = parseInt(req.params.reqId);
    const { reply_outcome } = req.body;
    if (!REPLY_OUTCOMES.includes(reply_outcome)) {
      return res.status(400).json({ error: `reply_outcome يجب أن تكون إحدى: ${REPLY_OUTCOMES.join(', ')}` });
    }

    // Same IDOR guard as the classification route above -- confirm reqId
    // actually belongs to case :id before writing anything.
    const { data: existingReq } = await sup.from('requests').select('id, case_id').eq('id', reqId).maybeSingle();
    if (!existingReq || existingReq.case_id !== parseInt(req.params.id)) {
      return res.status(404).json({ error: 'Request not found in this case' });
    }

    const { error } = await sup.from('requests').update({ reply_outcome }).eq('id', reqId);
    if (error) throw error;
    res.json({ success: true, reply_outcome });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/cases/:id/requests — add agency to case
router.post('/cases/:id/requests', caseGate, async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    const { agency_id, channel_method, contact_value } = req.body;
    if (!agency_id) return res.status(400).json({ error: 'agency_id required' });
    const { data, error } = await sup.from('requests').insert({
      case_id: caseId, agency_id, status: 'pending',
      channel_method: channel_method || 'email', contact_value: contact_value || null
    }).select().single();
    if (error) throw error;

    await sup.from('activity_logs').insert({
      user_id: req.user.id, user_name: req.user.name,
      action_type: 'create', target_type: 'request', target_id: data.id,
      target_title: `Added agency #${agency_id} to case`,
    });

    res.status(201).json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/cases/:id/requests/:reqId — remove agency from case
router.delete('/cases/:id/requests/:reqId', caseGate, async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    const reqId = parseInt(req.params.reqId);
    const { error: delErr } = await trash.softDelete(sup, { table: 'requests', id: reqId, userId: req.user?.id, extraFilters: { case_id: caseId } });
    if (delErr) return res.status(400).json({ error: delErr.message });
    await sup.from('activity_logs').insert({
      user_id: req.user.id, user_name: req.user.name,
      action_type: 'delete', target_type: 'request', target_id: reqId,
      target_title: `Removed agency from case`,
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/cases/:id/documents
router.get('/cases/:id/documents', caseGate, async (req, res) => {
  try {
    const sup = getSupabase();
    const { data, error } = await sup.from('case_documents').select('*').eq('case_id', parseInt(req.params.id)).is('deleted_at', null).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ data: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const multer = require('multer');
const path = require('path');
const storage = require('../services/storage');
const caseFileStorage = require('../services/caseFileStorage');
const gdrive = require('../services/googleDriveService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

// POST /api/cases/:id/documents — upload document (multipart)
router.post('/cases/:id/documents', caseGate, upload.single('file'), async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    
    // Support both multipart and JSON body
    let filename = req.body?.filename || req.file?.originalname || 'unnamed';
    let original_name = req.body?.original_name || req.file?.originalname || filename;
    let file_type = req.body?.file_type || 'document';
    let description = req.body?.description || '';
    let mime_type = req.body?.mime_type || req.file?.mimetype || 'application/octet-stream';
    let size = req.body?.size || req.file?.size || 0;

    // ---- Idempotency guard (prevents duplicate Drive uploads) ----
    // The client may retry after a network error that happened AFTER the
    // file actually reached Google Drive (bytes sent, response lost). A
    // naive retry would then upload a second copy to Drive. If an identical
    // file (same case + original_name + size) already exists, return the
    // existing row instead — no new bytes, no duplicate storage.
    const { data: existingDoc } = await sup.from('case_documents')
      .select('id, original_name, drive_file_id, file_path, url')
      .eq('case_id', caseId)
      .eq('original_name', original_name)
      .eq('size', size)
      .is('deleted_at', null)
      .maybeSingle();
    if (existingDoc) {
      return res.status(200).json({ success: true, data: existingDoc, duplicate: true });
    }

    // Google Drive is the single permanent storage backend for new uploads —
    // bytes go straight from the multer memory buffer to Drive, never to
    // Supabase Storage or local/Vercel disk.
    let driveFields = null;
    if (req.file) {
      if (!(await gdrive.isConnected())) {
        return res.status(503).json({ error: 'حساب Google Drive غير متصل — لازم يتم ربطه من صفحة Google Drive قبل رفع أي ملف' });
      }
      try {
        driveFields = await caseFileStorage.saveCaseFile({
          caseId, buffer: req.file.buffer, fileName: original_name, mimeType: mime_type, category: 'attachments',
        });
      } catch (uploadErr) {
        return res.status(500).json({ error: 'فشل رفع الملف إلى Google Drive: ' + uploadErr.message });
      }
    }

    let file_ext = path.extname(original_name).toLowerCase();

    // Auto-detect file type from extension
    if (['.jpg','.jpeg','.png','.gif','.webp','.bmp'].includes(file_ext)) file_type = 'image';
    else if (['.mp4','.mov','.avi','.mkv','.webm'].includes(file_ext)) file_type = 'video';
    else if (['.mp3','.wav','.ogg','.flac'].includes(file_ext)) file_type = 'audio';
    else if (['.pdf','.doc','.docx','.xls','.xlsx','.txt'].includes(file_ext)) file_type = 'document';

    const insertData = {
      case_id: caseId, filename, original_name, mime_type, size,
      uploaded_by: req.user.id, file_type, description,
    };
    if (driveFields) {
      Object.assign(insertData, driveFields);
      insertData.url = driveFields.file_path;
    } else {
      // JSON body submissions with a pre-existing file_path (no multipart file) — legacy compat.
      let file_path = req.body?.file_path || '';
      if (file_path && !file_path.startsWith('uploads/')) {
        const idx = file_path.indexOf('uploads');
        if (idx >= 0) file_path = file_path.substring(idx).replace(/\\\\/g, '/');
      }
      insertData.file_path = file_path || 'uploads/placeholder';
    }
    // Try with the full column set — if a column doesn't exist yet, retry without it.
    let { data, error } = await sup.from('case_documents').insert(insertData).select().single();
    while (error && /column .* does not exist|Could not find the '(\w+)' column/.test(error.message)) {
      const m = error.message.match(/'(\w+)' column|column "(\w+)"/);
      const badCol = m && (m[1] || m[2]);
      if (!badCol || !(badCol in insertData)) break;
      delete insertData[badCol];
      ({ data, error } = await sup.from('case_documents').insert(insertData).select().single());
    }
    if (error) throw error;

    await sup.from('activity_logs').insert({
      user_id: req.user.id, user_name: req.user.name,
      action_type: 'create', target_type: 'document', target_id: caseId,
      target_title: `Uploaded: ${original_name}`,
    });

    try {
      const recipients = await getCaseActivityRecipients(sup, caseId, { excludeUserId: req.user.id });
      await notifyUsers(sup, recipients, {
        type: 'document_uploaded', title: '📎 مستند جديد', body: `${req.user?.name || 'أحد الموظفين'} رفع "${original_name}" على القضية`,
        target_type: 'case', target_id: caseId,
      });
    } catch (e) { console.error('[documents] notification failed:', e.message); }

    res.status(201).json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/cases/:id/photo — set/replace the case's own display photo
// (shown large on the case header and on its Pipeline cards). Stored on
// Drive exactly like any other case file (caseFileStorage.saveCaseFile),
// but tracked on `cases.photo_url`/`photo_drive_file_id` directly rather
// than as a case_documents row -- this is cosmetic case metadata, not a
// piece of evidence/correspondence that belongs in the Files tab.
router.post('/cases/:id/photo', caseGate, upload.single('photo'), async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    if (!req.file) return res.status(400).json({ error: 'لم يتم إرسال أي صورة' });
    if (!req.file.mimetype?.startsWith('image/') || req.file.mimetype === 'image/svg+xml') {
      return res.status(400).json({ error: 'الملف المرفوع ليس صورة صالحة' });
    }
    if (!(await gdrive.isConnected())) {
      return res.status(503).json({ error: 'حساب Google Drive غير متصل — لازم يتم ربطه من صفحة Google Drive قبل رفع أي صورة' });
    }

    const { data: existing } = await sup.from('cases').select('photo_drive_file_id').eq('id', caseId).maybeSingle();

    const driveFields = await caseFileStorage.saveCaseFile({
      caseId, buffer: req.file.buffer, fileName: req.file.originalname || 'case-photo', mimeType: req.file.mimetype, category: 'attachments',
    });
    const photo_url = `/api/gdrive/image/${driveFields.drive_file_id}`;

    const { data, error } = await sup.from('cases')
      .update({ photo_url, photo_drive_file_id: driveFields.drive_file_id })
      .eq('id', caseId).select('id, photo_url, photo_drive_file_id').single();
    if (error) throw error;

    // Best-effort cleanup of the file it's replacing -- never blocks the
    // response on this, a leftover orphaned Drive file is harmless clutter,
    // not a correctness problem.
    if (existing?.photo_drive_file_id && existing.photo_drive_file_id !== driveFields.drive_file_id) {
      gdrive.deleteFile(existing.photo_drive_file_id).catch(e => console.warn('[case photo] old file cleanup failed:', e.message));
    }

    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/cases/:id/photo — remove the case's display photo, clearing
// both DB columns and best-effort deleting the underlying Drive file.
router.delete('/cases/:id/photo', caseGate, async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    const { data: existing } = await sup.from('cases').select('photo_drive_file_id').eq('id', caseId).maybeSingle();

    const { data, error } = await sup.from('cases')
      .update({ photo_url: null, photo_drive_file_id: null })
      .eq('id', caseId).select('id, photo_url, photo_drive_file_id').single();
    if (error) throw error;

    if (existing?.photo_drive_file_id) {
      gdrive.deleteFile(existing.photo_drive_file_id).catch(e => console.warn('[case photo] cleanup failed:', e.message));
    }

    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/cases/:id/documents/:docId
router.delete('/cases/:id/documents/:docId', caseGate, async (req, res) => {
  try {
    const sup = getSupabase();
    const docId = parseInt(req.params.docId);
    const caseId = parseInt(req.params.id);
    
    // Soft delete only -- moves the row to سلة المحذوفات, restorable. The
    // underlying Drive/storage bytes are untouched here and only actually
    // removed by trash.permanentlyDelete, once someone destroys it for real.
    const { error: delErr } = await trash.softDelete(sup, { table: 'case_documents', id: docId, userId: req.user?.id, extraFilters: { case_id: caseId } });
    if (delErr) return res.status(400).json({ error: delErr.message });

    // Log activity
    try {
      await sup.from('activity_logs').insert({
        user_id: req.user?.id || null, user_name: req.user?.name || 'System',
        action_type: 'delete', target_type: 'document', target_id: docId,
        target_title: '🗑️ حذف ملف',
      });
    } catch(e) {}
    
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/cases/:id/timeline
router.get('/cases/:id/timeline', caseGate, async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    const { data, error } = await sup.from('activity_logs').select('*')
      .or(`and(target_type.eq.case,target_id.eq.${caseId}),and(target_type.eq.checklist,target_id.eq.${caseId}),and(target_type.eq.document,target_id.eq.${caseId}),and(target_type.eq.request,target_id.eq.${caseId}),and(target_type.eq.team,target_id.eq.${caseId})`)
      .order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    res.json({ data: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
