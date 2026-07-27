const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getDatabase } = require('../database');
const emailService = require('../services/emailService');

/**
 * Email Auto-Classifier Service
 *
 * Automatically classifies incoming emails against the 7 FOIA pipeline lists:
 * 1. Records Received — bodycam footage/materials obtained
 * 2. Payment Required — fees/copy costs demanded
 * 3. No Records Available — agency says no matching records
 * 4. Denied by Law — legal exemption / official denial
 * 5. Case Pending in Court — criminal case still active
 * 6. Agency Has No Bodycams — agency doesn't use body cameras
 * 7. Citizenship Verification Needed — ID/Residency proof required
 */

const CLASSIFICATION_RULES = [
  {
    list_id: 1,
    label: 'تم استلام السجلات',
    keywords: [
      'records', 'enclosed', 'attached', 'herewith', 'hereby provide', 'hereby furnish',
      'تم توفير', 'مرفق', 'السجلات المطلوبة', 'نسخة من', 'تسليم', 'استلام',
      'found', 'available', 'locate', 'retrieve', 'provide you', 'copies of',
      'responsive', 'discovery', 'produce', 'produced', 'attached please find'
    ]
  },
  {
    list_id: 2,
    label: 'مطلوب دفع',
    keywords: [
      'fee', 'payment', 'pay', 'cost', 'charge', 'invoice', 'deposit',
      'رسوم', 'دفع', 'مبلغ', 'تكلفة', 'فاتورة', 'تحويل', 'حساب',
      'prepayment', 'processing fee', 'duplication fee', 'labor cost',
      'payment required', 'payable', 'due amount'
    ]
  },
  {
    list_id: 3,
    label: 'مفيش سجلات متوفرة',
    keywords: [
      'no records', 'no footage', 'no video', 'not found', 'unable to locate',
      'does not exist', 'no responsive', 'cannot be located', 'no documentation',
      'مفيش', 'لا توجد', 'غير متوفرة', 'غير موجودة', 'لا يوجد تسجيلات',
      'not in possession', 'no such records', 'cannot identify', 'destroyed'
    ]
  },
  {
    list_id: 4,
    label: 'تم الرفض بموجب القانون',
    keywords: [
      'denied', 'refused', 'exempt', 'exemption', 'privilege', 'confidential',
      'protected', 'withhold', 'withheld', 'redact', 'redacted',
      'رفض', 'مرفوض', 'بموجب القانون', 'امتياز', 'سرية', 'محمي',
      'FOIA exemption', 'privacy', 'investigatory', 'deliberative process',
      'attorney-client', 'trade secret', 'national security'
    ]
  },
  {
    list_id: 5,
    label: 'القضية مفتوحة في المحكمة',
    keywords: [
      'pending', 'litigation', 'court', 'trial', 'ongoing', 'investigation ongoing',
      'open investigation', 'active case', 'sub judice', 'under review',
      'محكمة', 'قضية', 'منظورة', 'تحقيق', 'قيد النظر', 'مازالت مفتوحة',
      'criminal proceeding', 'prosecution', 'grand jury', 'discovery phase'
    ]
  },
  {
    list_id: 6,
    label: 'الوكالة لا تستخدم البودي كام',
    keywords: [
      'no body camera', 'no bodycam', 'do not use', 'does not utilize',
      'not equipped', 'no camera system', 'no such equipment',
      'لا تستخدم', 'لا يوجد كاميرات', 'غير مجهزة', 'ليس لدينا',
      'no body-worn', 'no BWC', 'body-worn camera program not implemented'
    ]
  },
  {
    list_id: 7,
    label: 'محتاج تأكيد مواطنة',
    keywords: [
      'citizenship', 'proof of identity', 'residency', 'identification required',
      'photo id', 'driver license', 'state id', 'notarized',
      'إثبات هوية', 'مواطنة', 'إقامة', 'هوية', 'بطاقة', 'جواز سفر',
      'verification of identity', 'proof of residency', 'affidavit',
      'please provide ID', 'residency requirement', 'jurisdiction'
    ]
  }
];

/**
 * Classify a text against the 7 FOIA lists
 * Returns the best-matching list_id or null
 */
function classifyText(text) {
  if (!text) return null;

  const lower = text.toLowerCase();
  const arabic = /[\u0600-\u06FF]/.test(text);
  let bestMatch = null;
  let bestScore = 0;

  for (const rule of CLASSIFICATION_RULES) {
    let score = 0;
    const textToSearch = arabic ? text : lower;

    for (const kw of rule.keywords) {
      // Higher weight for phrase matches vs single words
      const kwLower = kw.toLowerCase();
      const count = (textToSearch.match(new RegExp(kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
      if (count > 0) {
        score += count * (kw.includes(' ') ? 3 : 1); // phrases weighted more
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = rule.list_id;
    }
  }

  // Only classify if there's meaningful signal
  return bestScore >= 2 ? bestMatch : null;
}

/**
 * Auto-classify an incoming communication
 */
function autoClassifyCommunication(commId) {
  const db = getDatabase();
  const comm = db.prepare('SELECT * FROM communications WHERE id = ?').get(commId);
  if (!comm) return null;

  const text = `${comm.subject || ''} ${comm.body || ''}`;
  const listId = classifyText(text);

  if (listId && comm.case_id) {
    // Update the most recent pending request for this case
    const request = db.prepare(`
      SELECT id FROM requests WHERE case_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1
    `).get(comm.case_id);

    if (request) {
      db.prepare(`UPDATE requests SET classification_id = ?, status = 'classified', response_date = date('now') WHERE id = ?`)
        .run(listId, request.id);

      const list = db.prepare('SELECT name_ar FROM pipeline_lists WHERE id = ?').get(listId);
      db.prepare("INSERT INTO case_comments (case_id, content, created_at) VALUES (?, ?, datetime('now'))")
        .run(comm.case_id, `🤖 تم تصنيف الرد تلقائياً: ${list?.name_ar || 'تصنيف ' + listId}`);
    }

    return listId;
  }

  return null;
}

// ============ API ROUTES ============

// POST /api/classifier/analyze — classify a text without saving
router.post('/classifier/analyze', requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text مطلوب' });

  const listId = classifyText(text);
  const list = listId
    ? getDatabase().prepare('SELECT id, name_ar, name_en, color FROM pipeline_lists WHERE id = ?').get(listId)
    : null;

  res.json({
    success: true,
    classification: list || null,
    matches: list ? CLASSIFICATION_RULES[listId - 1].keywords.filter(kw =>
      (text.toLowerCase().includes(kw.toLowerCase()))
    ) : []
  });
});

// POST /api/classifier/auto-classify — run on inbox
router.post('/classifier/auto-classify', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const db = getDatabase();
  const { case_id } = req.body;

  let communications;
  if (case_id) {
    communications = db.prepare(`
      SELECT id, case_id, subject, body FROM communications
      WHERE case_id = ? AND direction = 'inbound' AND type = 'email'
      ORDER BY created_at DESC
    `).all(parseInt(case_id));
  } else {
    communications = db.prepare(`
      SELECT id, case_id, subject, body FROM communications
      WHERE direction = 'inbound' AND type = 'email' AND case_id IS NOT NULL
      ORDER BY created_at DESC
    `).all();
  }

  let classified = 0;
  let unclassified = 0;

  for (const comm of communications) {
    const result = autoClassifyCommunication(comm.id);
    if (result) classified++;
    else unclassified++;
  }

  res.json({
    success: true,
    total_checked: communications.length,
    classified,
    unclassified,
    message: classified > 0
      ? `✅ تم تصنيف ${classified} رد من ${communications.length}`
      : 'ℹ️ لم يتم العثور على ردود قابلة للتصنيف'
  });
});

// POST /api/classifier/auto-fetch-and-classify — fetch IMAP then classify
router.post('/classifier/auto-fetch-and-classify', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const db = getDatabase();
    const accounts = db.prepare('SELECT id FROM email_accounts WHERE is_active = 1 AND imap_host IS NOT NULL').all();

    let totalFetched = 0;
    let totalClassified = 0;
    const results = [];

    for (const account of accounts) {
      try {
        const fetchResult = await emailService.fetchInbox(account.id, 10);

        // Store each fetched email
        for (const email of fetchResult) {
          // Try to match to a case
          const caseMatch = email.subject?.match(/\[FOIA\s*[#:]\s*(\d+)\]/i);
          const targetCaseId = caseMatch ? parseInt(caseMatch[1]) : null;

          const db = getDatabase();
          const result = db.prepare(`
            INSERT INTO communications (case_id, type, direction, subject, body, sender, recipient, metadata, created_at)
            VALUES (?, 'email', 'inbound', ?, ?, ?, ?, ?, ?)
          `).run(
            targetCaseId,
            email.subject?.substring(0, 255) || '',
            email.text?.substring(0, 5000) || '',
            email.from || '',
            email.to || '',
            JSON.stringify({ messageId: email.messageId }),
            email.date?.toISOString() || new Date().toISOString()
          );

          totalFetched++;

          // Auto-classify
          const classResult = autoClassifyCommunication(result.lastInsertRowid);
          if (classResult) totalClassified++;
        }

        results.push({ account_id: account.id, fetched: fetchResult.length });
      } catch (e) {
        results.push({ account_id: account.id, error: e.message });
      }
    }

    res.json({
      success: true,
      accounts_checked: accounts.length,
      total_fetched: totalFetched,
      total_classified: totalClassified,
      details: results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
