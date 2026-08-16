const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { getSupabase } = require('../supabase');
const { processDocument, extractText, extractMetadata, detectDuplicates } = require('../services/aiIntake');
const { classifyIntakeText, blankAnswers } = require('../services/aiClassifier');
const caseFileStorage = require('../services/caseFileStorage');
const { requireAuth, requirePermission, hasPermission } = require('../middleware/auth');
const { canAccessCase } = require('../services/caseAccess');
router.use(requireAuth);

// The OCR step shells out to a Python script that needs a real file path on
// disk (extractText -> execSync), so this can't just switch to
// multer.memoryStorage() and read a buffer. /tmp is the one directory
// Vercel's serverless filesystem actually allows writes to (ephemeral,
// wiped between invocations) -- the previous destination
// (backend/uploads/intake, under the read-only deployed bundle) silently
// failed every write attempt.
const INTAKE_DIR = os.tmpdir();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, INTAKE_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}_${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.txt', '.png', '.jpg', '.jpeg', '.tiff', '.bmp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Unsupported file type'));
  }
});

const INTAKE_ACTIONS = ['view', 'create', 'edit', 'promote', 'manage_criteria'];

// Being able to submit/triage/promote is meaningless without being able to
// see the queue -- but the Permissions matrix renders these as 5
// independent checkboxes, so an admin granting only "إنشاء" (without also
// checking "عرض") would otherwise 403 that role on the very page it needs
// to review what it just submitted. Reading is implied by ANY granted
// intake capability, same rule already applied to the forum resource.
async function requireIntakeVisible(req, res, next) {
  if (req.user.role === 'admin') return next();
  try {
    const sup = getSupabase();
    const { data } = await sup.from('role_permissions')
      .select('action, allowed').eq('role', req.user.role).eq('resource', 'intake').in('action', INTAKE_ACTIONS);
    if ((data || []).some(r => r.allowed)) return next();
  } catch (e) { /* table not migrated yet -- fail closed */ }
  return res.status(403).json({ error: 'Forbidden — insufficient permissions' });
}

// Every intake case's triage answers are keyed against whatever criteria
// are currently active -- fetched fresh each time rather than cached, since
// an admin can add/deactivate a criterion at any moment (see
// intake_criteria_definitions CRUD below) and every read path needs to
// reflect that immediately.
async function getActiveCriteriaDefs(sup) {
  const { data } = await sup.from('intake_criteria_definitions').select('*').eq('is_active', true).order('sort_order', { ascending: true });
  return data || [];
}

// "Most complete" scoring for the triage table -- how much real information
// exists about this submission, not whether the case IS complete/ready
// (that's a human judgment made via the promote button). Weighted so
// answering the triage checklist matters most (60%), with the rest split
// across attached evidence and the journalism/origin fields Cases.jsx's own
// creation form collects.
function computeCompleteness(caseRow, criteriaDefs, agencyCount, documentCount) {
  const answers = caseRow.intake_criteria || {};
  const answeredCount = criteriaDefs.filter(c => answers[c.key] && answers[c.key].value !== null && answers[c.key].value !== undefined).length;
  const criteriaScore = criteriaDefs.length ? (answeredCount / criteriaDefs.length) * 60 : 0;
  const evidenceScore = (documentCount > 0 ? 15 : 0) + (agencyCount > 0 ? 15 : 0);
  const optionalFields = ['defendant_name', 'source_agency_name', 'story_hook', 'case_summary'];
  const populated = optionalFields.filter(f => caseRow[f] && String(caseRow[f]).trim()).length;
  const fieldScore = Math.min(populated, 4) * 2.5;
  return Math.round(criteriaScore + evidenceScore + fieldScore);
}

/**
 * POST /api/intake/upload
 * Upload a document → OCR → Extract metadata → AI-suggest triage criteria → create intake case
 */
router.post('/intake/upload', requirePermission('intake', 'create'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { title } = req.body;
    const filePath = req.file.path;
    const originalName = req.file.originalname;
    const sup = getSupabase();
    const criteriaDefs = await getActiveCriteriaDefs(sup);

    // Step 1: Extract text via OCR
    const text = await extractText(filePath);

    if (!text || text.length < 10) {
      return res.json({
        success: true,
        message: 'تم رفع الملف لكن لم يتم استخراج نص كافٍ',
        file: { name: originalName, path: filePath },
        metadata: { summary: '', agencies: [], dates: [], case_numbers: [] },
        suggestion: 'قد يكون الملف فارغاً أو مشفراً'
      });
    }

    // Step 2: Extract metadata
    const metadata = extractMetadata(text);

    // Step 2.5: Check for duplicates
    const duplicates = await detectDuplicates(text);

    // Step 2.6: AI-suggested first pass on the triage criteria -- a human
    // reviews/confirms every answer before promotion, this is only ever a
    // starting point (see classifyIntakeText's own no-throw guarantee).
    const intakeCriteria = await classifyIntakeText(text, criteriaDefs);

    // Step 3: Create the intake case -- NOT yet a "ready to work" case;
    // in_intake_review keeps it out of the main القضايا list (see GET
    // /cases) until a reviewer explicitly promotes it.
    const caseTitle = title || originalName.replace(/\.[^/.]+$/, '').substring(0, 100);

    const { data: created, error: caseErr } = await sup.from('cases').insert({
      uuid: require('uuid').v4(),
      title: caseTitle,
      description: metadata.summary.substring(0, 1000),
      status: 'open', priority: metadata.priority || 'medium',
      created_by: req.user?.id,
      in_intake_review: true, intake_source: 'file', intake_criteria: intakeCriteria,
    }).select().single();
    if (caseErr) throw caseErr;
    const caseId = created.id;

    // Add a note about AI extraction
    try {
      await sup.from('activity_logs').insert({
        user_id: req.user?.id, user_name: req.user?.name,
        action_type: 'ai_intake', target_type: 'case', target_id: caseId,
        target_title: `🤖 تم استخراج تلقائي من الملف: ${originalName}`,
      });
    } catch (e) { console.error('[intake] activity_logs insert failed:', e.message); }

    // If agencies were detected, create requests
    for (const agency of metadata.agencies.slice(0, 5)) {
      await sup.from('requests').insert({
        case_id: caseId, notes: `جهة تم اكتشافها: ${agency}`, status: 'pending', sent_date: new Date().toISOString().split('T')[0],
      });
    }

    // Save the OCR text and AI summary to the case description
    await sup.from('cases').update({
      description: `[AI Summary]\n${metadata.summary}\n\n[Detected Agencies]\n${metadata.agencies.join(', ')}\n\n[Detected Dates]\n${metadata.dates.join(', ')}\n\n[Case Numbers]\n${metadata.case_numbers.join(', ')}\n\n[Evidence]\n${metadata.evidence_mentions.join(', ')}`,
    }).eq('id', caseId);

    // Archive the originally-uploaded document itself as a real case
    // document (it's the source evidence the case was built from) — same
    // Drive storage path every other upload uses, not left behind in /tmp.
    try {
      const buffer = fs.readFileSync(filePath);
      const driveFields = await caseFileStorage.saveCaseFile({
        caseId, buffer, fileName: originalName, mimeType: req.file.mimetype, category: 'attachments',
      });
      await sup.from('case_documents').insert({
        case_id: caseId, filename: originalName, original_name: originalName,
        mime_type: req.file.mimetype, size: req.file.size,
        file_type: 'document', uploaded_by: req.user?.id,
        ...driveFields, url: driveFields.file_path,
      });
    } catch (archiveErr) {
      console.error('[intake] failed to archive source document to Drive:', archiveErr.message);
    } finally {
      fs.unlink(filePath, () => {});
    }

    res.json({
      success: true,
      message: '✅ تم استخراج البيانات وإضافتها لقائمة الفرز',
      case_id: caseId,
      file: { name: originalName, path: filePath },
      metadata: {
        summary: metadata.summary.substring(0, 300),
        agencies: metadata.agencies,
        dates: metadata.dates,
        case_numbers: metadata.case_numbers,
        evidence: metadata.evidence_mentions,
        names: metadata.names.slice(0, 10),
        classification: metadata.classification,
        priority: metadata.priority,
      },
      intake_criteria: intakeCriteria,
      duplicates,
      suggestion: duplicates.length > 0 ? '⚠️ تم العثور على قضايا مشابهة' : undefined,
    });

  } catch (err) {
    console.error('Intake error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/intake/text
 * Submit raw text → Extract metadata → AI-suggest triage criteria → create intake case
 */
router.post('/intake/text', requirePermission('intake', 'create'), async (req, res) => {
  try {
    const { text, title } = req.body;
    if (!text || text.length < 10) {
      return res.status(400).json({ error: 'النص قصير جداً' });
    }

    const sup = getSupabase();
    const criteriaDefs = await getActiveCriteriaDefs(sup);
    const metadata = extractMetadata(text);
    const intakeCriteria = await classifyIntakeText(text, criteriaDefs);
    const caseTitle = title || text.substring(0, 80).trim();

    const { data: created, error: caseErr } = await sup.from('cases').insert({
      uuid: require('uuid').v4(),
      title: caseTitle,
      description: text.substring(0, 2000),
      status: 'open', priority: metadata.priority || 'medium',
      created_by: req.user?.id,
      in_intake_review: true, intake_source: 'link', intake_criteria: intakeCriteria,
    }).select().single();
    if (caseErr) throw caseErr;
    const caseId = created.id;

    for (const agency of metadata.agencies.slice(0, 5)) {
      await sup.from('requests').insert({
        case_id: caseId, notes: `جهة: ${agency}`, status: 'pending', sent_date: new Date().toISOString().split('T')[0],
      });
    }

    res.json({ success: true, case_id: caseId, metadata, intake_criteria: intakeCriteria });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/intake/manual
 * Manual entry path -- same fields Cases.jsx's own creation form collects,
 * for a submission the reviewer wants to enter by hand rather than paste/
 * upload a source document. Still lands in the intake queue (not
 * immediately "ready to work") so it goes through the same triage/promote
 * flow as any other submission.
 */
router.post('/intake/manual', requirePermission('intake', 'create'), async (req, res) => {
  try {
    const { title, defendant_name, source_agency_name, story_hook, case_summary, agencies } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'عنوان القضية مطلوب' });

    const sup = getSupabase();
    const criteriaDefs = await getActiveCriteriaDefs(sup);
    // Only worth an AI pass if there's actual free text to read -- a bare
    // title with no summary gives the classifier nothing to work from.
    const textForClassification = [story_hook, case_summary].filter(Boolean).join('\n\n');
    const intakeCriteria = textForClassification.trim()
      ? await classifyIntakeText(textForClassification, criteriaDefs)
      : blankAnswers(criteriaDefs);

    const { data: created, error: caseErr } = await sup.from('cases').insert({
      uuid: require('uuid').v4(),
      title: title.trim(),
      description: case_summary || story_hook || '',
      status: 'open', priority: 'medium',
      created_by: req.user?.id,
      defendant_name: defendant_name || null, source_agency_name: source_agency_name || null,
      story_hook: story_hook || null, case_summary: case_summary || null,
      in_intake_review: true, intake_source: 'manual', intake_criteria: intakeCriteria,
    }).select().single();
    if (caseErr) throw caseErr;
    const caseId = created.id;

    if (Array.isArray(agencies)) {
      for (const a of agencies.slice(0, 20)) {
        const agencyId = a?.agency_id || a;
        if (!agencyId) continue;
        await sup.from('requests').insert({ case_id: caseId, agency_id: agencyId, status: 'pending' });
      }
    }

    res.json({ success: true, case_id: caseId, intake_criteria: intakeCriteria });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/intake/queue -- the triage table: every case still sitting in
 * intake review, sorted by completeness by default. Criteria/date/search
 * filtering happens in JS after a single fetch rather than as JSONB path
 * queries -- the queue is expected to stay a small working set (unlike the
 * full case list, which is why Cases.jsx paginates server-side), and this
 * keeps the JSON-shaped intake_criteria filtering simple and safe.
 */
router.get('/intake/queue', requireIntakeVisible, async (req, res) => {
  try {
    const sup = getSupabase();
    const { search, date_from, date_to, sort } = req.query;
    const criteriaDefs = await getActiveCriteriaDefs(sup);

    let query = sup.from('cases').select('*').eq('in_intake_review', true).order('created_at', { ascending: false });
    if (date_from) query = query.gte('created_at', date_from);
    if (date_to) query = query.lt('created_at', `${date_to}T23:59:59.999`);

    const { data: cases, error } = await query;
    if (error) return res.status(400).json({ error: /does not exist/i.test(error.message) ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (in_intake_review)' : error.message });

    let rows = cases || [];
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(c => (c.title || '').toLowerCase().includes(s) || (c.description || '').toLowerCase().includes(s));
    }
    // Per-criterion filter: ?criteria_<key>=true|false|unanswered
    for (const [qKey, qVal] of Object.entries(req.query)) {
      if (!qKey.startsWith('criteria_')) continue;
      const critKey = qKey.slice('criteria_'.length);
      if (!criteriaDefs.some(c => c.key === critKey)) continue;
      rows = rows.filter(c => {
        const answer = (c.intake_criteria || {})[critKey];
        const value = answer ? answer.value : null;
        if (qVal === 'unanswered') return value === null || value === undefined;
        if (qVal === 'true') return value === true;
        if (qVal === 'false') return value === false;
        return true;
      });
    }

    const caseIds = rows.map(c => c.id);
    const [{ data: reqRows }, { data: docRows }] = caseIds.length
      ? await Promise.all([
          sup.from('requests').select('case_id, agency_id').in('case_id', caseIds),
          sup.from('case_documents').select('case_id').in('case_id', caseIds),
        ])
      : [{ data: [] }, { data: [] }];
    const agencyCounts = {}; const docCounts = {};
    for (const r of reqRows || []) if (r.agency_id) agencyCounts[r.case_id] = (agencyCounts[r.case_id] || 0) + 1;
    for (const d of docRows || []) docCounts[d.case_id] = (docCounts[d.case_id] || 0) + 1;

    const withScores = rows.map(c => ({
      ...c,
      agency_count: agencyCounts[c.id] || 0,
      document_count: docCounts[c.id] || 0,
      completeness: computeCompleteness(c, criteriaDefs, agencyCounts[c.id] || 0, docCounts[c.id] || 0),
    }));

    withScores.sort(sort === 'date'
      ? (a, b) => new Date(b.created_at) - new Date(a.created_at)
      : (a, b) => b.completeness - a.completeness);

    res.json({ success: true, data: withScores, criteria: criteriaDefs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/intake/criteria-definitions -- just requireAuth, no intake
 * permission needed: this is reference data (criterion labels), not
 * sensitive, and needs to be readable by ANY case viewer to render the
 * persistent "نتيجة الفرز" card on a promoted case -- most staff working a
 * case will never have the intake permission at all (different role, per
 * the user's design), so gating labels behind it would break that card for
 * almost everyone. Only a role with `manage_criteria` sees inactive
 * criteria too (needed to re-enable one from the admin panel); everyone
 * else gets active-only.
 */
router.get('/intake/criteria-definitions', async (req, res) => {
  try {
    const sup = getSupabase();
    const canManage = await hasPermission(sup, req.user, 'intake', 'manage_criteria');
    let query = sup.from('intake_criteria_definitions').select('*').order('sort_order', { ascending: true });
    if (!canManage) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: /does not exist|could not find the table/i.test(error.message) ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (intake_criteria_definitions)' : error.message });
    res.json({ success: true, data: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST/PUT/DELETE criteria-definitions -- admin-style CRUD for the triage
// checklist itself, so the criteria list can grow/change without a code
// deploy (the user's explicit ask: "قابلية لتعديل معايير الفرز").
router.post('/intake/criteria-definitions', requirePermission('intake', 'manage_criteria'), async (req, res) => {
  try {
    const { key, label_ar, sort_order } = req.body;
    if (!key || !label_ar) return res.status(400).json({ error: 'key و label_ar مطلوبان' });
    const sup = getSupabase();
    const { data: maxRow } = await sup.from('intake_criteria_definitions').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await sup.from('intake_criteria_definitions').insert({
      key: key.trim(), label_ar: label_ar.trim(), sort_order: sort_order ?? ((maxRow?.sort_order || 0) + 1),
    }).select().single();
    if (error) return res.status(400).json({ error: error.message.includes('duplicate') ? 'هذا المفتاح مستخدم بالفعل' : error.message });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/intake/criteria-definitions/:id', requirePermission('intake', 'manage_criteria'), async (req, res) => {
  try {
    const { label_ar, sort_order, is_active } = req.body;
    const updates = {};
    if (label_ar !== undefined) updates.label_ar = label_ar;
    if (sort_order !== undefined) updates.sort_order = sort_order;
    if (is_active !== undefined) updates.is_active = is_active;
    const sup = getSupabase();
    const { error } = await sup.from('intake_criteria_definitions').update(updates).eq('id', parseInt(req.params.id));
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/intake/criteria-definitions/:id', requirePermission('intake', 'manage_criteria'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { error } = await sup.from('intake_criteria_definitions').delete().eq('id', parseInt(req.params.id));
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * PUT /api/intake/:caseId/criteria -- human review/override of one or more
 * triage answers. Gate depends on lifecycle stage: still in the intake
 * queue -> the dedicated intake permission; already promoted -> the same
 * case-access check every other case-field edit uses, so the answers stay
 * editable from the case itself forever without needing intake permissions
 * after promotion (this is what the user explicitly asked for).
 */
router.put('/intake/cases/:caseId/criteria', async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.caseId);
    const { criteria } = req.body;
    if (!criteria || typeof criteria !== 'object') return res.status(400).json({ error: 'criteria object مطلوب' });

    const { data: caseRow } = await sup.from('cases').select('id, intake_criteria, in_intake_review').eq('id', caseId).maybeSingle();
    if (!caseRow) return res.status(404).json({ error: 'Case not found' });

    if (caseRow.in_intake_review) {
      if (!(await hasPermission(sup, req.user, 'intake', 'edit'))) {
        return res.status(403).json({ error: 'Forbidden — insufficient permissions' });
      }
    } else if (!(await canAccessCase(sup, req.user, caseId))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }

    const criteriaDefs = await getActiveCriteriaDefs(sup);
    const validKeys = new Set(criteriaDefs.map(c => c.key));
    const merged = { ...(caseRow.intake_criteria || {}) };
    for (const [key, value] of Object.entries(criteria)) {
      if (!validKeys.has(key)) continue;
      merged[key] = { value: value === null ? null : !!value, source: 'human', reason: merged[key]?.reason || null };
    }

    const { error } = await sup.from('cases').update({ intake_criteria: merged }).eq('id', caseId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, intake_criteria: merged });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/intake/:caseId/promote -- moves a case out of the triage queue
 * into the normal, "ready to work" القضايا list. Same row, just flips the
 * one stage flag (see GET /cases's in_intake_review exclusion) -- the
 * triage answers travel with it unchanged and stay editable afterward via
 * the route above.
 */
router.post('/intake/:caseId/promote', requirePermission('intake', 'promote'), async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.caseId);
    const { data: caseRow } = await sup.from('cases').select('id').eq('id', caseId).maybeSingle();
    if (!caseRow) return res.status(404).json({ error: 'Case not found' });

    const { error } = await sup.from('cases').update({ in_intake_review: false }).eq('id', caseId);
    if (error) return res.status(400).json({ error: error.message });

    try {
      await sup.from('activity_logs').insert({
        user_id: req.user?.id, user_name: req.user?.name,
        action_type: 'intake_promoted', target_type: 'case', target_id: caseId,
        target_title: '✅ تم اعتماد القضية ونقلها من الاستقبال الذكي إلى القضايا الجاهزة للعمل',
      });
    } catch (e) { console.error('[intake] promote activity_logs insert failed:', e.message); }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
