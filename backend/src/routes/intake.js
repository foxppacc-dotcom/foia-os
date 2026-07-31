const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { getSupabase } = require('../supabase');
const { processDocument, extractText, extractMetadata, detectDuplicates } = require('../services/aiIntake');
const caseFileStorage = require('../services/caseFileStorage');
const { requireAuth } = require("../middleware/auth");
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

router.use(requireAuth);
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

/**
 * POST /api/intake/upload
 * Upload a document → OCR → Extract metadata → Auto-create case
 */
router.post('/intake/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { title } = req.body;
    const filePath = req.file.path;
    const originalName = req.file.originalname;

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

    // Step 3: Auto-create a draft case from the extracted data
    const sup = getSupabase();
    const caseTitle = title || originalName.replace(/\.[^/.]+$/, '').substring(0, 100);

    const { data: created, error: caseErr } = await sup.from('cases').insert({
      uuid: require('uuid').v4(),
      title: caseTitle,
      description: metadata.summary.substring(0, 1000),
      status: 'open', priority: metadata.priority || 'medium',
      created_by: req.user?.id,
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
      message: '✅ تم استخراج البيانات وإنشاء قضية',
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
 * Submit raw text → Extract metadata → Auto-create case
 */
router.post('/intake/text', async (req, res) => {
  try {
    const { text, title } = req.body;
    if (!text || text.length < 10) {
      return res.status(400).json({ error: 'النص قصير جداً' });
    }

    const metadata = extractMetadata(text);
    const sup = getSupabase();
    const caseTitle = title || text.substring(0, 80).trim();

    const { data: created, error: caseErr } = await sup.from('cases').insert({
      uuid: require('uuid').v4(),
      title: caseTitle,
      description: text.substring(0, 2000),
      status: 'open', priority: metadata.priority || 'medium',
      created_by: req.user?.id,
    }).select().single();
    if (caseErr) throw caseErr;
    const caseId = created.id;

    for (const agency of metadata.agencies.slice(0, 5)) {
      await sup.from('requests').insert({
        case_id: caseId, notes: `جهة: ${agency}`, status: 'pending', sent_date: new Date().toISOString().split('T')[0],
      });
    }

    res.json({
      success: true,
      case_id: caseId,
      metadata
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
