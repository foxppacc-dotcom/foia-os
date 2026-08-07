const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth");
router.use(requireAuth);
const { getSupabase } = require('../supabase');
const { logActivity } = require('../services/activityLogger');
const { scopeCasesQuery, canAccessCase } = require('../services/caseAccess');

// GET /api/cases — list all cases
router.get('/cases', requirePermission('cases', 'view'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { status, priority, search, assigned_to, limit, offset } = req.query;

    let query = sup
      .from('cases')
      .select('*');

    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (search) {
      query = query.or(`title.ilike.%${search}%,client_name.ilike.%${search}%,uuid.ilike.%${search}%`);
    }
    if (assigned_to) query = query.eq('assigned_to', assigned_to);
    if (limit) query = query.limit(limit);
    if (offset) query = query.range(offset, offset + (limit || 10) - 1);
    query = query.order('created_at', { ascending: false });

    // Case visibility scope: a role without cases.view_all only sees cases
    // it's assigned to / created, not the whole organization's caseload.
    query = await scopeCasesQuery(sup, query, req.user);
    if (!query) return res.json([]);

    const { data: cases, error } = await query;
    if (error) throw error;

    // request_count/classified_count per case in ONE extra round trip instead
    // of 2 sequential count queries per case (was 2N+1 total; PostgREST calls
    // are HTTP round trips, so that scaled linearly with the caseload — a
    // few hundred cases meant 1000+ sequential requests just to list them).
    const caseIds = (cases || []).map(c => c.id);
    const countsByCase = {};
    if (caseIds.length) {
      const { data: requestRows } = await sup.from('requests').select('case_id, classification_id').in('case_id', caseIds);
      for (const r of requestRows || []) {
        if (!countsByCase[r.case_id]) countsByCase[r.case_id] = { request_count: 0, classified_count: 0 };
        countsByCase[r.case_id].request_count++;
        if (r.classification_id != null) countsByCase[r.case_id].classified_count++;
      }
    }

    const result = (cases || []).map(c => ({
      ...c,
      assigned_user_name: c.users_cases_assigned_to_fkey?.name || null,
      created_by_name: c.users_cases_created_by_fkey?.name || null,
      request_count: countsByCase[c.id]?.request_count || 0,
      classified_count: countsByCase[c.id]?.classified_count || 0,
      users_cases_assigned_to_fkey: undefined,
      users_cases_created_by_fkey: undefined
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cases/:id — full case detail
router.get('/cases/:id', requirePermission('cases', 'view'), async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    if (isNaN(caseId)) return res.status(400).json({ error: 'Invalid case ID' });

    if (!(await canAccessCase(sup, req.user, caseId))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }

    const { data: caseRow, error } = await sup
      .from('cases')
      .select(`*`)
      .eq('id', caseId)
      .maybeSingle();

    if (error) throw error;
    if (!caseRow) return res.status(404).json({ error: 'Case not found' });

    const { data: requests } = await sup
      .from('requests')
      .select(`*, agencies!left(name_ar, name_en, state, email, phone), pipeline_lists!left(name_ar, name_en, color, list_number), email_accounts!left(email, name)`)
      .eq('case_id', caseId)
      .order('created_at', { ascending: false });

    const requestsMapped = (requests || []).map(r => ({
      ...r,
      agency_name_ar: r.agencies?.name_ar || null,
      agency_name_en: r.agencies?.name_en || null,
      agency_state: r.agencies?.state || null,
      agency_email: r.agencies?.email || null,
      agency_phone: r.agencies?.phone || null,
      classification_name_ar: r.pipeline_lists?.name_ar || null,
      classification_name_en: r.pipeline_lists?.name_en || null,
      classification_color: r.pipeline_lists?.color || null,
      list_number: r.pipeline_lists?.list_number || null,
      account_email: r.email_accounts?.email || null,
      account_name: r.email_accounts?.name || null,
      agencies: undefined,
      pipeline_lists: undefined,
      email_accounts: undefined
    }));

    const { data: communications } = await sup
      .from('communications')
      .select(`*, requests!left(agencies!inner(name_en))`)
      .eq('case_id', caseId)
      .order('created_at', { ascending: false });

    const communicationsMapped = (communications || []).map(c => ({
      ...c,
      agency_name: c.requests?.agencies?.name_en || null,
      requests: undefined
    }));

    const { data: documents } = await sup
      .from('case_documents')
      .select(`*, users!left(name)`)
      .eq('case_id', caseId)
      .order('created_at', { ascending: false });

    const documentsMapped = (documents || []).map(d => ({
      ...d,
      uploaded_by_name: d.users?.name || null,
      users: undefined
    }));

    const { data: comments } = await sup
      .from('case_comments')
      .select(`*, users!left(name)`)
      .eq('case_id', caseId)
      .order('created_at', { ascending: false });

    const commentsMapped = (comments || []).map(c => ({
      ...c,
      user_name: c.users?.name || null,
      users: undefined
    }));

    const { data: phoneLogs } = await sup
      .from('phone_logs')
      .select('*')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false });

    const { data: mailLogs } = await sup
      .from('mail_logs')
      .select('*')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false });

    res.json({
      ...caseRow,
      assigned_user_name: caseRow.users_cases_assigned_to_fkey?.name || null,
      created_by_name: caseRow.users_cases_created_by_fkey?.name || null,
      users_cases_assigned_to_fkey: undefined,
      users_cases_created_by_fkey: undefined,
      requests: requestsMapped,
      communications: communicationsMapped,
      documents: documentsMapped,
      comments: commentsMapped,
      phoneLogs: phoneLogs || [],
      mailLogs: mailLogs || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cases — create a case with agencies
router.post('/cases', requirePermission('cases', 'create'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { title, description, priority, client_name, assigned_to, deadline, agencies,
      defendant_name, source_agency_name, story_hook, article_url, case_summary } = req.body;

    if (!title) return res.status(400).json({ error: 'عنوان القضية مطلوب' });

    const { v4: uuidv4 } = require('uuid');
    const uuid = uuidv4();
    const now = new Date().toISOString();

    // 1. Create the case
    const { data: caseRow, error: caseError } = await sup
      .from('cases')
      .insert({
        uuid,
        title,
        description: description || '',
        status: 'open',
        priority: priority || 'medium',
        client_name: client_name || null,
        created_by: req.user?.id || null,
        assigned_to: assigned_to || null,
        deadline: deadline || null,
        defendant_name: defendant_name || null,
        source_agency_name: source_agency_name || null,
        story_hook: story_hook || null,
        article_url: article_url || null,
        case_summary: case_summary || null,
        created_at: now,
        updated_at: now
      })
      .select()
      .single();

    if (caseError) throw caseError;
    const caseId = caseRow.id;

    // 2. Create requests for each agency
    if (agencies && Array.isArray(agencies) && agencies.length > 0) {
      for (const agency of agencies) {
        await sup
          .from('requests')
          .insert({
            case_id: caseId,
            agency_id: agency.agency_id || agency.id || null,
            status: 'pending',
            channel_method: 'email',
            sent_date: agency.sent_date || null,
            notes: agency.notes || null,
            created_at: now
          });
      }

      // Add comment about agencies
      await sup
        .from('case_comments')
        .insert({
          case_id: caseId,
          user_id: req.user?.id || null,
          content: `📋 تم إنشاء القضية وإضافة ${agencies.length} جهة`,
          created_at: now
        });
    } else {
      await sup
        .from('case_comments')
        .insert({
          case_id: caseId,
          user_id: req.user?.id || null,
          content: '📋 تم إنشاء القضية',
          created_at: now
        });
    }

    // 3. Activity log
    logActivity({
      user_id: req.user?.id,
      user_name: req.user?.name,
      action_type: 'create',
      target_type: 'case',
      target_id: caseId,
      target_title: title,
      details: `تم إنشاء القضية مع ${agencies?.length || 0} جهة`
    });

    // 4. Return full case
    const { data: newCase } = await sup
      .from('cases')
      .select('*')
      .eq('id', caseId)
      .single();

    const { data: newRequests } = await sup
      .from('requests')
      .select(`*, agencies!left(name_ar, name_en)`)
      .eq('case_id', caseId);

    const newRequestsMapped = (newRequests || []).map(r => ({
      ...r,
      agency_name_ar: r.agencies?.name_ar || null,
      agency_name_en: r.agencies?.name_en || null,
      agencies: undefined
    }));

    if (newCase) {
      newCase.assigned_user_name = newCase.users_cases_assigned_to_fkey?.name || null;
      delete newCase.users_cases_assigned_to_fkey;
    }

    res.status(201).json({ ...newCase, requests: newRequestsMapped });
  } catch (err) {
    console.error('Error creating case:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/cases/:id
router.put('/cases/:id', requirePermission('cases', 'edit'), async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);

    const { data: existing } = await sup.from('cases').select('*').eq('id', caseId).single();
    if (!existing) return res.status(404).json({ error: 'Case not found' });

    const { title, description, status, priority, client_name, assigned_to, deadline,
      defendant_name, source_agency_name, story_hook, article_url, case_summary } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (priority !== undefined) updates.priority = priority;
    if (client_name !== undefined) updates.client_name = client_name;
    if (assigned_to !== undefined) updates.assigned_to = assigned_to;
    if (deadline !== undefined) updates.deadline = deadline;
    if (defendant_name !== undefined) updates.defendant_name = defendant_name;
    if (source_agency_name !== undefined) updates.source_agency_name = source_agency_name;
    if (story_hook !== undefined) updates.story_hook = story_hook;
    if (article_url !== undefined) updates.article_url = article_url;
    if (case_summary !== undefined) updates.case_summary = case_summary;
    updates.updated_at = new Date().toISOString();

    // supabase-js resolves {data, error} rather than throwing -- an ignored
    // error here would silently report success on a rejected update, same
    // class of bug just fixed in users.js's PUT /users/:id.
    const { error: updateError } = await sup.from('cases').update(updates).eq('id', caseId);
    if (updateError) return res.status(400).json({ error: updateError.message });

    const { data: updated } = await sup.from('cases').select('*').eq('id', caseId).single();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cases/:id
router.delete('/cases/:id', requirePermission('cases', 'delete'), async (req, res) => {
  const sup = getSupabase();
  const id = parseInt(req.params.id);

  const { data: c } = await sup.from('cases').select('id, title').eq('id', id).single();
  if (!c) return res.status(404).json({ error: 'Case not found' });

  const { error } = await sup.from('cases').delete().eq('id', id);
  if (error) return res.status(500).json({ success: false, error: error.message });

  logActivity({
    user_id: req.user?.id,
    user_name: req.user?.name,
    action_type: 'delete',
    target_type: 'case',
    target_id: id,
    target_title: c.title,
    details: 'تم حذف القضية'
  });

  res.json({ success: true, message: '✅ تم حذف القضية' });
});

// POST /api/cases/:id/comments — add comment
router.post('/cases/:id/comments', async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content مطلوب' });

    const now = new Date().toISOString();

    const { data: comment, error } = await sup
      .from('case_comments')
      .insert({ case_id: caseId, user_id: req.user?.id || null, content, created_at: now })
      .select(`*, users!left(name)`)
      .single();

    if (error) throw error;

    comment.user_name = comment.users?.name || null;
    delete comment.users;

    res.status(201).json(comment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/requests/:id/classification — move request to different pipeline list
router.put('/requests/:id/classification', async (req, res) => {
  try {
    const sup = getSupabase();
    const requestId = parseInt(req.params.id);
    const { classification_id } = req.body;

    if (!classification_id) return res.status(400).json({ error: 'classification_id مطلوب' });

    const { data: existing } = await sup.from('requests').select('*').eq('id', requestId).single();
    if (!existing) return res.status(404).json({ error: 'Request not found' });

    const { data: list } = await sup.from('pipeline_lists').select('id').eq('id', classification_id).single();
    if (!list) return res.status(400).json({ error: 'Invalid classification_id' });

    const { error: classifyErr } = await sup
      .from('requests')
      .update({ classification_id, status: 'classified' })
      .eq('id', requestId);
    if (classifyErr) return res.status(400).json({ error: classifyErr.message });

    // Add timeline entry
    const { data: listName } = await sup.from('pipeline_lists').select('name_ar').eq('id', classification_id).single();
    const classificationLabel = listName?.name_ar || 'تصنيف ' + classification_id;
    await sup
      .from('case_comments')
      .insert({
        case_id: existing.case_id,
        content: `📌 تم تصنيف الرد: "${classificationLabel}"`,
        created_at: new Date().toISOString()
      });

    // Activity log
    const { data: agency } = await sup.from('agencies').select('name_en').eq('id', existing.agency_id).single();
    logActivity({
      user_id: req.user?.id,
      user_name: req.user?.name,
      action_type: 'classify',
      target_type: 'request',
      target_id: requestId,
      target_title: `طلب #${requestId} ← ${classificationLabel}`,
      details: agency ? `الجهة: ${agency.name_en}` : ''
    });

    const { data: updated } = await sup
      .from('requests')
      .select(`*, agencies!left(name_ar, name_en), pipeline_lists!left(name_ar, name_en, color, list_number)`)
      .eq('id', requestId)
      .single();

    if (updated) {
      updated.agency_name_ar = updated.agencies?.name_ar || null;
      updated.agency_name_en = updated.agencies?.name_en || null;
      updated.classification_name_ar = updated.pipeline_lists?.name_ar || null;
      updated.classification_name_en = updated.pipeline_lists?.name_en || null;
      updated.classification_color = updated.pipeline_lists?.color || null;
      updated.list_number = updated.pipeline_lists?.list_number || null;
      delete updated.agencies;
      delete updated.pipeline_lists;
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== EXCEL UPLOAD — BULK CASES ====================
const multer2 = require('multer');
const XLSX2 = require('xlsx');
const path2 = require('path');

// xlsx can parse straight from the in-memory buffer (XLSX.read, not
// XLSX.readFile) -- no disk write needed at all, so this sidesteps Vercel's
// read-only filesystem entirely instead of silently failing to persist
// anything under the deployed bundle's uploads/ dir like it used to.
const uploadCases = multer2({
  storage: multer2.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path2.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) cb(null, true);
    else cb(new Error('يرجى رفع ملف Excel'));
  }
});

// POST /api/cases/upload — رفع Excel بقضايا
router.post('/cases/upload', requireAuth, uploadCases.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });

    const workbook = XLSX2.read(req.file.buffer, { type: 'buffer' });
    const data = XLSX2.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });

    if (data.length === 0) return res.json({ success: true, imported: 0, message: 'الملف فارغ' });

    const sup = getSupabase();
    const { v4: uuidv4 } = require('uuid');
    const now = new Date().toISOString();

    // Detect columns
    const colMap = {};
    const sample = data[0];
    for (const key of Object.keys(sample)) {
      const k = key.toLowerCase().trim();
      if (k === 'title' || k === 'عنوان' || k === 'case' || k === 'case title' || k === 'العنوان') colMap.title = key;
      else if (k === 'description' || k === 'وصف' || k === 'details' || k === 'تفاصيل') colMap.description = key;
      else if (k === 'priority' || k === 'أولوية' || k === 'priority') colMap.priority = key;
      else if (k === 'client_name' || k === 'client' || k === 'عميل' || k === 'العميل' || k === 'اسم العميل') colMap.client_name = key;
      else if (k === 'agencies' || k === 'جهات' || k === 'agencies list' || k === 'الجهات' || k === 'agency') colMap.agencies = key;
      else if (k === 'notes' || k === 'ملاحظات' || k === 'notes') colMap.notes = key;
    }

    if (!colMap.title) {
      return res.status(400).json({ error: 'لم يتم العثور على عمود عنوان القضية (title)' });
    }

    // Process all rows
    let imported = 0;
    for (const row of data) {
      const title = String(row[colMap.title] || '').trim();
      if (!title) continue;

      const uuid = uuidv4();
      const priority = row[colMap.priority]
        ? (String(row[colMap.priority]).toLowerCase().includes('high') || String(row[colMap.priority]).includes('عاجل')
          ? 'high'
          : String(row[colMap.priority]).toLowerCase().includes('low') || String(row[colMap.priority]).includes('منخفض')
            ? 'low'
            : 'medium')
        : 'medium';

      const { data: caseResult, error: caseErr } = await sup
        .from('cases')
        .insert({
          uuid,
          title,
          description: String(row[colMap.description] || '').trim(),
          status: 'open',
          priority,
          client_name: row[colMap.client_name] ? String(row[colMap.client_name]).trim() : null,
          created_by: req.user?.id || null,
          created_at: now,
          updated_at: now
        })
        .select()
        .single();

      if (caseErr) throw caseErr;
      const caseId = caseResult.id;

      // Parse agencies column (semicolon separated)
      const agenciesStr = row[colMap.agencies] ? String(row[colMap.agencies]) : '';
      const agencyNames = agenciesStr.split(';').map(s => s.trim()).filter(Boolean);
      let agencyCount = 0;

      for (const name of agencyNames) {
        // Try to match by name_en (fuzzy)
        const { data: agenciesEn } = await sup
          .from('agencies')
          .select('id')
          .ilike('name_en', `%${name}%`)
          .limit(1);

        if (agenciesEn && agenciesEn.length > 0) {
          await sup.from('requests').insert({
            case_id: caseId,
            agency_id: agenciesEn[0].id,
            status: 'pending',
            notes: String(row[colMap.notes] || '').trim(),
            created_at: now
          });
          agencyCount++;
        } else {
          // Try name_ar
          const { data: agenciesAr } = await sup
            .from('agencies')
            .select('id')
            .ilike('name_ar', `%${name}%`)
            .limit(1);

          if (agenciesAr && agenciesAr.length > 0) {
            await sup.from('requests').insert({
              case_id: caseId,
              agency_id: agenciesAr[0].id,
              status: 'pending',
              notes: String(row[colMap.notes] || '').trim(),
              created_at: now
            });
            agencyCount++;
          }
        }
      }

      await sup.from('case_comments').insert({
        case_id: caseId,
        content: `📋 تم استيراد القضية عن طريق Excel — ${agencyCount} جهة`,
        created_at: now
      });
      imported++;
    }

    // Archive the import file itself to Drive for record-keeping (non-blocking)
    try {
      const gdrive = require('../services/googleDriveService');
      const folderId = await gdrive.ensureSystemFolder('Imports');
      await gdrive.uploadBytes(req.file.buffer, req.file.originalname, req.file.mimetype, folderId);
    } catch (uploadErr) {
      console.warn('Case import file Drive archive warning:', uploadErr.message);
    }

    res.json({
      success: true,
      imported,
      total_rows: data.length,
      message: `✅ تم استيراد ${imported} قضية من ${data.length}`
    });
  } catch (err) {
    console.error('Cases upload error:', err);
    res.status(500).json({ error: err.message || 'فشل رفع الملف' });
  }
});

module.exports = router;
