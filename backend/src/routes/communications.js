const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
router.use(requireAuth);
const { getSupabase } = require('../supabase');

// GET /api/cases/:caseId/communications - list comms for investigation
router.get('/cases/:caseId/communications', async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.caseId);
    const { data: communications, error } = await sup
      .from('communications')
      .select('*')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const parsed = (communications || []).map(c => ({
      ...c,
      file_paths: c.file_paths ? (typeof c.file_paths === 'string' ? JSON.parse(c.file_paths) : c.file_paths) : [],
      metadata: c.metadata ? (typeof c.metadata === 'string' ? JSON.parse(c.metadata) : c.metadata) : {}
    }));
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cases/:caseId/communications - create comm record
router.post('/cases/:caseId/communications', async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.caseId);
    const { data: caseRow, error: caseError } = await sup.from('cases').select('id').eq('id', caseId).maybeSingle();
    if (caseError || !caseRow) {
      return res.status(404).json({ error: 'Case not found' });
    }
    const { type, direction, subject, body, sender, recipient, file_paths, metadata } = req.body;
    if (!type || !direction) {
      return res.status(400).json({ error: 'type and direction are required' });
    }
    const validTypes = ['email', 'phone', 'mail', 'portal', 'sms'];
    const validDirections = ['inbound', 'outbound'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    }
    if (!validDirections.includes(direction)) {
      return res.status(400).json({ error: `Invalid direction. Must be one of: ${validDirections.join(', ')}` });
    }
    const { data: insertResult, error: insertError } = await sup
      .from('communications')
      .insert({
        case_id: caseId, type, direction,
        subject: subject || null, body: body || null,
        sender: sender || null, recipient: recipient || null,
        file_paths: file_paths ? JSON.stringify(file_paths) : null,
        metadata: metadata ? JSON.stringify(metadata) : null
      })
      .select('*')
      .maybeSingle();
    if (insertError) return res.status(500).json({ error: insertError.message });
    const newComm = insertResult;
    res.status(201).json({
      ...newComm,
      file_paths: newComm.file_paths ? (typeof newComm.file_paths === 'string' ? JSON.parse(newComm.file_paths) : newComm.file_paths) : [],
      metadata: newComm.metadata ? (typeof newComm.metadata === 'string' ? JSON.parse(newComm.metadata) : newComm.metadata) : {}
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cases/:caseId/threads - alias for case communications (frontend expects this)
router.get('/cases/:caseId/threads', async (req, res) => {
  const sup = getSupabase();
  const { data, error } = await sup.from('communications').select('*').eq('case_id', parseInt(req.params.caseId)).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ threads: data || [] });
});

module.exports = router;
