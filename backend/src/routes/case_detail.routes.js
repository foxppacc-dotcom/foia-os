const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
router.use(requireAuth);
const { getSupabase } = require('../supabase');

// GET /api/cases/:id/dashboard — combined overview
router.get('/cases/:id/dashboard', async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);

    // Fetch case first (required)
    const caseRow = await sup.from('cases').select('*').eq('id', caseId).single();
    if (caseRow.error) return res.status(404).json({ error: 'Case not found' });

    // Fetch all other data independently — failures are non-fatal
    const [team, requests, checklist, documents, timeline] = await Promise.all([
      sup.from('case_assignees').select('*').eq('case_id', caseId).then(r => {
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
      sup.from('requests').select('*').eq('case_id', caseId).then(async (r) => {
        if (r.error) return [];
        const reqs = r.data || [];
        // Batch fetch agencies separately
        const agencyIds = [...new Set(reqs.map(r => r.agency_id).filter(Boolean))];
        if (!agencyIds.length) return reqs;
        const { data: ags } = await sup.from('agencies').select('*').in('id', agencyIds);
        const agMap = {};
        (ags || []).forEach(a => agMap[a.id] = a);
        return reqs.map(r => ({ ...r, agencies: agMap[r.agency_id] || null }));
      }),
      sup.from('case_records_checklist').select('*').eq('case_id', caseId).order('record_type')
        .then(async (r) => r.error ? generateChecklist(sup, caseId) : (r.data?.length > 0 ? r.data : generateChecklist(sup, caseId)))
        .then(cl => persistChecklist(sup, caseId, cl))
        .then(cl => mergeChecklistWithLogs(sup, caseId, cl)),
      sup.from('case_documents').select('*').eq('case_id', caseId).order('created_at', { ascending: false })
        .then(r => r.error ? [] : (r.data || [])),
      sup.from('activity_logs').select('*')
        .or(`and(target_type.eq.case,target_id.eq.${caseId}),and(target_type.eq.checklist,target_id.eq.${caseId}),and(target_type.eq.document,target_id.eq.${caseId}),and(target_type.eq.request,target_id.eq.${caseId}),and(target_type.eq.team,target_id.eq.${caseId})`)
        .order('created_at', { ascending: false }).limit(50)
        .then(r => r.error ? [] : (r.data || [])),
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
        _virtual: false,
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

// GET /api/cases/:id/team
router.get('/cases/:id/team', async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    const { data, error } = await sup.from('case_assignees').select('*').eq('case_id', caseId);
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
router.post('/cases/:id/team', async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    const { user_id: userIdInput, role: roleType, specialty_id, custom_role_name } = req.body;
    const userId = parseInt(userIdInput) || parseInt(req.body.userId) || parseInt(req.body.user_id);
    if (!userId) return res.status(400).json({ error: 'user_id is required' });
    const user_id = userId;
    const insertData = {
      case_id: caseId, user_id,
      role: roleType || 'member',
      specialty_id: specialty_id || null,
    };
    // Try with custom_role_name first; if column doesn't exist, retry without
    if (custom_role_name) insertData.custom_role_name = custom_role_name;
    let { data, error } = await sup.from('case_assignees').insert(insertData).select().single();
    if (error && error.message.includes('custom_role_name')) {
      delete insertData.custom_role_name;
      const retry = await sup.from('case_assignees').insert(insertData).select().single();
      data = retry.data; error = retry.error;
    }
    if (error) throw error;

    // Log activity
    await sup.from('activity_logs').insert({
      user_id: req.user.id, user_name: req.user.name,
      action_type: 'assign', target_type: 'team', target_id: caseId,
      target_title: `Assigned user #${user_id} as ${roleType || 'member'}`,
    });

    // Create notification (skip if table doesn't exist)
    try {
      await sup.from('notifications').insert({
        user_id, is_read: false, type: 'case_update', title: '📋 تم تعيينك في قضية',
        body: `تم تعيينك ضمن فريق القضية #${caseId}`
      });
    } catch (e) { /* notifications table may not exist */ }

    res.status(201).json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/cases/:id/team/:userId
router.delete('/cases/:id/team/:userId', async (req, res) => {
  try {
    const sup = getSupabase();
    const { error } = await sup.from('case_assignees').delete().eq('case_id', parseInt(req.params.id)).eq('user_id', parseInt(req.params.userId));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/cases/:id/checklist
router.get('/cases/:id/checklist', async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    const { data, error } = await sup.from('case_records_checklist').select('*').eq('case_id', caseId).order('record_type');
    if (error || !data || data.length === 0) {
      // Table doesn't exist or empty — return virtual checklist merged with activity_logs
      const virtual = generateChecklist(sup, caseId).map((item, i) => ({ ...item, id: -(i + 1) }));
      const merged = await mergeChecklistWithLogs(sup, caseId, virtual);
      return res.json({ data: merged });
    }
    res.json({ data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/cases/:id/checklist/:recordType
router.put('/cases/:id/checklist/:recordType', async (req, res) => {
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
router.get('/cases/:id/requests', async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    const { data, error } = await sup.from('requests').select('*').eq('case_id', caseId);
    if (error) throw error;
    if (!data || data.length === 0) return res.json({ data: [] });
    // Batch fetch agencies separately (no FK join)
    const agencyIds = [...new Set(data.map(r => r.agency_id).filter(Boolean))];
    if (!agencyIds.length) return res.json({ data });
    const { data: ags } = await sup.from('agencies').select('*').in('id', agencyIds);
    const agMap = {};
    (ags || []).forEach(a => agMap[a.id] = a);
    const result = data.map(r => ({ ...r, agencies: agMap[r.agency_id] || null }));
    res.json({ data: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/cases/:id/requests/:reqId/classification
router.put('/cases/:id/requests/:reqId/classification', async (req, res) => {
  try {
    const sup = getSupabase();
    const reqId = parseInt(req.params.reqId);
    const { agency_classification } = req.body;
    
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

// POST /api/cases/:id/requests — add agency to case
router.post('/cases/:id/requests', async (req, res) => {
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
router.delete('/cases/:id/requests/:reqId', async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    const reqId = parseInt(req.params.reqId);
    await sup.from('requests').delete().eq('id', reqId).eq('case_id', caseId);
    await sup.from('activity_logs').insert({
      user_id: req.user.id, user_name: req.user.name,
      action_type: 'delete', target_type: 'request', target_id: reqId,
      target_title: `Removed agency from case`,
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/cases/:id/documents
router.get('/cases/:id/documents', async (req, res) => {
  try {
    const sup = getSupabase();
    const { data, error } = await sup.from('case_documents').select('*').eq('case_id', parseInt(req.params.id)).order('created_at', { ascending: false });
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
router.post('/cases/:id/documents', upload.single('file'), async (req, res) => {
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

    res.status(201).json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/cases/:id/documents/:docId
router.delete('/cases/:id/documents/:docId', async (req, res) => {
  try {
    const sup = getSupabase();
    const docId = parseInt(req.params.docId);
    const caseId = parseInt(req.params.id);
    
    // Fetch document first to know where its bytes actually live
    const { data: doc } = await sup.from('case_documents').select('storage_key, storage_provider, drive_file_id').eq('id', docId).eq('case_id', caseId).maybeSingle();

    // Delete from database
    await sup.from('case_documents').delete().eq('id', docId).eq('case_id', caseId);

    // Delete the underlying bytes from wherever they're actually stored
    if (doc?.storage_provider === 'google_drive' && doc?.drive_file_id) {
      await gdrive.deleteFile(doc.drive_file_id).catch(e => console.warn('⚠️ Drive delete failed:', e.message));
    } else if (doc?.storage_key) {
      await storage.deleteByKey(doc.storage_key).catch(e => console.warn('⚠️ Storage delete failed:', e.message));
    }
    
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
router.get('/cases/:id/timeline', async (req, res) => {
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
