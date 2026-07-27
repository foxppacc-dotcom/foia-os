const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDatabase } = require('../database');

// Configure multer storage
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads', 'documents');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Create a subfolder for each case
    const caseId = req.params.caseId;
    const caseDir = path.join(UPLOADS_DIR, `case_${caseId}`);
    if (!fs.existsSync(caseDir)) {
      fs.mkdirSync(caseDir, { recursive: true });
    }
    cb(null, caseDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// POST /api/cases/:caseId/documents/upload
router.post('/cases/:caseId/documents/upload', upload.single('file'), (req, res) => {
  try {
    const db = getDatabase();
    const caseId = parseInt(req.params.caseId);

    // Verify case exists
    const caseRow = db.prepare('SELECT id FROM cases WHERE id = ?').get(caseId);
    if (!caseRow) {
      return res.status(404).json({ error: 'Case not found' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { filename, originalname, mimetype, size, path: filePath } = req.file;
    const uploaded_by = req.body.uploaded_by ? parseInt(req.body.uploaded_by) : null;

    // Store relative path
    const relativePath = path.relative(path.join(__dirname, '..', '..'), filePath);

    const result = db.prepare(`
      INSERT INTO case_documents (case_id, filename, original_name, mime_type, size, file_path, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(caseId, filename, originalname, mimetype, size, relativePath, uploaded_by);

    const doc = db.prepare(`
      SELECT cd.*, u.name AS uploaded_by_name
      FROM case_documents cd
      LEFT JOIN users u ON cd.uploaded_by = u.id
      WHERE cd.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(doc);
  } catch (err) {
    console.error('Error uploading document:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cases/:caseId/documents
router.get('/cases/:caseId/documents', (req, res) => {
  try {
    const db = getDatabase();
    const caseId = parseInt(req.params.caseId);

    const documents = db.prepare(`
      SELECT cd.*, u.name AS uploaded_by_name
      FROM case_documents cd
      LEFT JOIN users u ON cd.uploaded_by = u.id
      WHERE cd.case_id = ?
      ORDER BY cd.created_at DESC
    `).all(caseId);

    res.json(documents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/:id/download
router.get('/documents/:id/download', (req, res) => {
  try {
    const db = getDatabase();
    const docId = parseInt(req.params.id);

    const doc = db.prepare('SELECT * FROM case_documents WHERE id = ?').get(docId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const absolutePath = path.resolve(path.join(__dirname, '..', '..', doc.file_path));
    
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    res.download(absolutePath, doc.original_name);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
