const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDatabase } = require('../database');
const { processDocument, extractText, extractMetadata } = require('../services/aiIntake');

// Configure multer for AI intake uploads
const INTAKE_DIR = path.join(__dirname, '..', '..', 'uploads', 'intake');
if (!fs.existsSync(INTAKE_DIR)) {
  fs.mkdirSync(INTAKE_DIR, { recursive: true });
}

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

/**
 * POST /api/intake/upload
 * Upload a document → OCR → Extract metadata → Auto-create case
 */
router.post('/intake/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

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
    const db = getDatabase();
    const duplicates = detectDuplicates(text, db);

    // Step 3: Auto-create a draft case from the extracted data
    const caseTitle = title || originalName.replace(/\.[^/.]+$/, '').substring(0, 100);
    
    const caseResult = db.prepare(`
      INSERT INTO cases (uuid, title, description, status, priority, created_at, updated_at)
      VALUES (?, ?, ?, 'open', 'medium', datetime('now'), datetime('now'))
    `).run(
      require('uuid').v4(),
      title,
      metadata.summary.substring(0, 1000)
    );

    const caseId = caseResult.lastInsertRowid;

    // Add a note about AI extraction
    db.prepare(`
      INSERT INTO case_comments (case_id, content, created_at)
      VALUES (?, ?, datetime('now'))
    `).run(caseId, `🤖 تم استخراج تلقائي من الملف: ${originalName}`);

    // If agencies were detected, create requests
    for (const agency of metadata.agencies.slice(0, 5)) {
      db.prepare(`
        INSERT INTO requests (case_id, notes, status, sent_date)
        VALUES (?, ?, 'pending', datetime('now'))
      `).run(caseId, `جهة تم اكتشافها: ${agency}`);
    }

    // Save the OCR text and AI summary to the case_metadata
    db.prepare(`
      UPDATE cases SET description = ? WHERE id = ?
    `).run(
      `[AI Summary]\n${metadata.summary}\n\n[Detected Agencies]\n${metadata.agencies.join(', ')}\n\n[Detected Dates]\n${metadata.dates.join(', ')}\n\n[Case Numbers]\n${metadata.case_numbers.join(', ')}\n\n[Evidence]\n${metadata.evidence_mentions.join(', ')}`,
      caseId
    );

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
    const db = getDatabase();
    const caseTitle = title || text.substring(0, 80).trim();

    const caseResult = db.prepare(`
      INSERT INTO cases (uuid, title, description, status, priority, created_at, updated_at)
      VALUES (?, ?, ?, 'open', 'medium', datetime('now'), datetime('now'))
    `).run(require('uuid').v4(), caseTitle, text.substring(0, 2000));

    const caseId = caseResult.lastInsertRowid;

    for (const agency of metadata.agencies.slice(0, 5)) {
      db.prepare(`
        INSERT INTO requests (case_id, notes, status, sent_date)
        VALUES (?, ?, 'pending', datetime('now'))
      `).run(caseId, `جهة: ${agency}`);
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
