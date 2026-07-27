const fs = require('fs');
const path = require('path');
const { getDatabase } = require('../database');

/**
 * AI Intake Service
 * Extracts text from uploaded documents using OCR and pymupdf
 * Then extracts structured data using regex patterns
 */

const PYTHON_EXTRACT_SCRIPT = path.join(__dirname, 'extract_document.py');

/**
 * Extract text from a document file
 * Supports: PDF, DOCX, images (png, jpg, jpeg, tiff, bmp)
 */
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  // Try python-based extraction for PDF and images
  if (['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.bmp'].includes(ext)) {
    return extractViaPython(filePath);
  }
  
  // For docx, try python-docx
  if (ext === '.docx') {
    return extractViaPython(filePath);
  }
  
  // For text files
  if (ext === '.txt') {
    return fs.readFileSync(filePath, 'utf-8');
  }
  
  return '';
}

async function extractViaPython(filePath) {
  const { execSync } = require('child_process');
  try {
    const result = execSync(
      `python "${PYTHON_EXTRACT_SCRIPT}" "${filePath}"`,
      { timeout: 30000, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    return result.trim();
  } catch (err) {
    console.error('Python extraction error:', err.message);
    return '';
  }
}

/**
 * Extract structured data from raw text
 * Returns: { summary, agencies, dates, case_numbers, names, evidence_mentions, classification, priority }
 */
function extractMetadata(text) {
  if (!text || text.length < 10) {
    return { summary: '', agencies: [], dates: [], case_numbers: [], names: [], evidence_mentions: [], classification: 'other', priority: 'medium' };
  }

  const data = {
    summary: text.substring(0, 500).trim(),
    agencies: [],
    dates: [],
    case_numbers: [],
    names: [],
    evidence_mentions: [],
    classification: 'other',
    priority: 'medium',
  };

  // Extract dates (various formats)
  const datePatterns = [
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi,
    /\b\d{1,2}\s+(?:يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)\s+\d{4}\b/g,
  ];
  
  for (const pattern of datePatterns) {
    const matches = text.match(pattern);
    if (matches) {
      data.dates.push(...matches);
    }
  }
  data.dates = [...new Set(data.dates)];

  // Extract US agency names
  const agencyPatterns = [
    /\b(Police\s+Department)\b/gi,
    /\b(Sheriff'?s?\s+Office)\b/gi,
    /\b(Highway\s+Patrol)\b/gi,
    /\b(Department\s+of\s+(?:Justice|Corrections|Public\s+Safety|Homeland\s+Security))\b/gi,
    /\b(FBI|DEA|ATF|ICE|CBP|TSA|USMS|NCIS)\b/g,
    /\b(شرطة|مكتب\s+الشريف|إدارة\s+الشرطة)\b/g,
  ];

  for (const pattern of agencyPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      data.agencies.push(...matches);
    }
  }
  data.agencies = [...new Set(data.agencies)];

  // Extract case/incident numbers
  const casePatterns = [
    /\b(?:Case|Incident|Report|File|Docket)\s*[#:]?\s*[A-Z0-9-]+\b/gi,
    /\b\d{2,3}[-]\d{2,6}[-]\d{2,6}\b/g,
  ];

  for (const pattern of casePatterns) {
    const matches = text.match(pattern);
    if (matches) {
      data.case_numbers.push(...matches);
    }
  }
  data.case_numbers = [...new Set(data.case_numbers)];

  // Extract names (capitalized words that might be names)
  const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
  const matches = text.match(namePattern);
  if (matches) {
    data.names = [...new Set(matches)].filter(n => 
      !['The', 'This', 'That', 'With', 'From', 'When', 'What', 'Which'].includes(n.split(' ')[0])
    ).slice(0, 20);
  }

  // Evidence mentions
  const evidencePatterns = [
    /\b(body[- ]?cam|dash[- ]?cam|video|footage|recording|photograph|cctv)\b/gi,
    /\b(report|document|statement|affidavit|witness)\b/gi,
  ];

  const evidenceSet = new Set();
  for (const pattern of evidencePatterns) {
    const m = text.match(pattern);
    if (m) m.forEach(e => evidenceSet.add(e.toLowerCase()));
  }
  data.evidence_mentions = [...evidenceSet];

  // === AI Classification ===
  // Determine case type based on keywords
  const lower = text.toLowerCase();
  
  if (/\bshooting|gunshot|firearm|gun|homicide|murder|قتل|إطلاق\s+نار|رصاص\b/.test(lower)) {
    data.classification = 'shooting';
    data.priority = 'high';
  } else if (/\bbody[- ]?cam|bodycam|dash[- ]?cam|dashcam|footage|فيديو|تسجيل|كاميرا\b/.test(lower)) {
    data.classification = 'bodycam';
    data.priority = 'high';
  } else if (/\bexcessive\s*force|brutality|police\s*brutality|عنف|تعذيب|ضرب\b/.test(lower)) {
    data.classification = 'police_misconduct';
    data.priority = 'high';
  } else if (/\barrest|detention|booking|jail|prison|اعتقال|حبس|سجن\b/.test(lower)) {
    data.classification = 'arrest';
    data.priority = 'medium';
  } else if (/\btraffic|accident|crash|car\s*crash|حادث|مرور|تصادم\b/.test(lower)) {
    data.classification = 'traffic';
    data.priority = 'medium';
  } else if (/\bmissing\s*person|kidnap|abduction|مفقود|اختطاف\b/.test(lower)) {
    data.classification = 'missing_person';
    data.priority = 'high';
  } else if (/\bproperty|theft|burglary|robbery|سرقة|سطو\b/.test(lower)) {
    data.classification = 'property_crime';
    data.priority = 'medium';
  } else if (/\bcourt|lawsuit|litigation|محكمة|دعوى|قضية\b/.test(lower)) {
    data.classification = 'court';
    data.priority = 'medium';
  }

  return data;
}

/**
 * Detect duplicate cases by comparing agency, case numbers, and names
 */
function detectDuplicates(text, db) {
  if (!text || text.length < 10) return [];

  const lower = text.toLowerCase();
  const results = [];

  // Get all existing cases with their descriptions
  const cases = db.prepare('SELECT id, title, description FROM cases ORDER BY created_at DESC LIMIT 50').all();

  for (const c of cases) {
    if (!c.description) continue;
    const desc = c.description.toLowerCase();
    let score = 0;

    // Check for shared case numbers
    const caseNumPattern = /\b(?:Case|Incident|Report|File|Docket)\s*[#:]?\s*[A-Z0-9-]+\b/gi;
    const incomingNums = text.match(caseNumPattern) || [];
    const existingNums = c.description.match(caseNumPattern) || [];
    
    for (const num of incomingNums) {
      for (const en of existingNums) {
        if (num.toLowerCase() === en.toLowerCase() || num.split('#')[1]?.trim() === en.split('#')[1]?.trim()) {
          score += 30;
        }
      }
    }

    // Check for shared agency names
    const agencyNames = ['police department', 'sheriff', 'highway patrol', 'police'];
    for (const agency of agencyNames) {
      if (lower.includes(agency) && desc.includes(agency)) {
        score += 10;
      }
    }

    // Check for shared dates
    const datePattern = /\b\d{4}-\d{2}-\d{2}\b/g;
    const incomingDates = text.match(datePattern) || [];
    const existingDates = c.description.match(datePattern) || [];
    for (const d of incomingDates) {
      if (existingDates.includes(d)) score += 15;
    }

    if (score >= 25) {
      results.push({
        caseId: c.id,
        title: c.title,
        score,
        matchReason: score >= 40 ? 'high' : score >= 25 ? 'medium' : 'low'
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 3);
}

/**
 * Process an uploaded document: extract text, extract metadata, update DB
 */
async function processDocument(documentId) {
  const db = getDatabase();
  const doc = db.prepare('SELECT * FROM case_documents WHERE id = ?').get(documentId);
  if (!doc) throw new Error('Document not found');

  const absolutePath = path.join(__dirname, '..', '..', doc.file_path);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    return null;
  }

  // Extract text
  const text = await extractText(absolutePath);
  
  // Extract metadata
  const metadata = extractMetadata(text);
  
  // Update document in DB
  db.prepare(`
    UPDATE case_documents 
    SET ocr_text = ?, ai_summary = ?
    WHERE id = ?
  `).run(text.substring(0, 50000), metadata.summary, documentId);

  return { text: text.substring(0, 1000), ...metadata };
}

module.exports = { extractText, extractMetadata, processDocument };
