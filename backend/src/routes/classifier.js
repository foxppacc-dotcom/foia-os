const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSupabase } = require('../supabase');

/**
 * Email Auto-Classifier Service
 *
 * Automatically classifies incoming emails against the 7 FOIA pipeline lists:
 * Records Received — bodycam footage/materials obtained
 * Payment Required — fees/copy costs demanded
 * No Records Available — agency says no matching records
 * Denied by Law — legal exemption / official denial
 * Case Pending in Court — criminal case still active
 * Agency Has No Bodycams — agency doesn't use body cameras
 * Citizenship Needed — ID/Residency proof required
 */

// Rules are keyed by name_en (matching pipeline_lists.name_en) rather than a
// hardcoded numeric list_id -- pipeline_lists rows are seeded/inserted, not
// guaranteed to have ids 1-7 in this exact order (this environment's real
// ids start at 15). The previous hardcoded `list_id: 1..7` silently wrote
// classification_id values that pointed at the wrong list (or none at all)
// on every single auto-classification -- the same bug class already fixed
// this session in cases.js/production.js/dashboard.js/pipelineLists.js.
const CLASSIFICATION_RULES = [
  {
    name_en: 'Records Received',
    label: 'تم استلام السجلات',
    keywords: [
      'records', 'enclosed', 'attached', 'herewith', 'hereby provide', 'hereby furnish',
      'تم توفير', 'مرفق', 'السجلات المطلوبة', 'نسخة من', 'تسليم', 'استلام',
      'found', 'available', 'locate', 'retrieve', 'provide you', 'copies of',
      'responsive', 'discovery', 'produce', 'produced', 'attached please find'
    ]
  },
  {
    name_en: 'Payment Required',
    label: 'مطلوب دفع',
    keywords: [
      'fee', 'payment', 'pay', 'cost', 'charge', 'invoice', 'deposit',
      'رسوم', 'دفع', 'مبلغ', 'تكلفة', 'فاتورة', 'تحويل', 'حساب',
      'prepayment', 'processing fee', 'duplication fee', 'labor cost',
      'payment required', 'payable', 'due amount'
    ]
  },
  {
    name_en: 'No Records Available',
    label: 'مفيش سجلات متوفرة',
    keywords: [
      'no records', 'no footage', 'no video', 'not found', 'unable to locate',
      'does not exist', 'no responsive', 'cannot be located', 'no documentation',
      'مفيش', 'لا توجد', 'غير متوفرة', 'غير موجودة', 'لا يوجد تسجيلات',
      'not in possession', 'no such records', 'cannot identify', 'destroyed'
    ]
  },
  {
    name_en: 'Denied by Law',
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
    name_en: 'Case Pending in Court',
    label: 'القضية مفتوحة في المحكمة',
    keywords: [
      'pending', 'litigation', 'court', 'trial', 'ongoing', 'investigation ongoing',
      'open investigation', 'active case', 'sub judice', 'under review',
      'محكمة', 'قضية', 'منظورة', 'تحقيق', 'قيد النظر', 'مازالت مفتوحة',
      'criminal proceeding', 'prosecution', 'grand jury', 'discovery phase'
    ]
  },
  {
    name_en: 'Agency Has No Bodycams',
    label: 'الوكالة لا تستخدم البودي كام',
    keywords: [
      'no body camera', 'no bodycam', 'do not use', 'does not utilize',
      'not equipped', 'no camera system', 'no such equipment',
      'لا تستخدم', 'لا يوجد كاميرات', 'غير مجهزة', 'ليس لدينا',
      'no body-worn', 'no BWC', 'body-worn camera program not implemented'
    ]
  },
  {
    name_en: 'Citizenship Needed',
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

// One query per request handler (not per communication) to resolve
// name_en -> real pipeline_lists.id, reused across every rule match in that
// request.
async function getListIdByName(sup) {
  const { data: lists } = await sup.from('pipeline_lists').select('id, name_en');
  return Object.fromEntries((lists || []).map(l => [l.name_en, l.id]));
}

/**
 * Classify a text against the 7 FOIA lists.
 * Returns the best-matching rule (or null), NOT a raw id.
 */
function classifyRule(text) {
  if (!text) return null;

  const lower = text.toLowerCase();
  const arabic = /[؀-ۿ]/.test(text);
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
      bestMatch = rule;
    }
  }

  // Only classify if there's meaningful signal
  return bestScore >= 2 ? bestMatch : null;
}

/**
 * Auto-classify an incoming communication.
 * `listIdByName` must be resolved once by the caller (see getListIdByName).
 */
async function autoClassifyCommunication(sup, commId, listIdByName) {
  const { data: comm } = await sup.from('communications').select('*').eq('id', commId).maybeSingle();
  if (!comm) return null;

  const text = `${comm.subject || ''} ${comm.body || ''}`;
  const rule = classifyRule(text);
  const listId = rule ? listIdByName[rule.name_en] : null;

  if (listId && comm.case_id) {
    // Update the most recent pending request for this case
    const { data: request } = await sup.from('requests')
      .select('id').eq('case_id', comm.case_id).eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    if (request) {
      await sup.from('requests').update({
        classification_id: listId, status: 'classified',
        response_date: new Date().toISOString().split('T')[0],
      }).eq('id', request.id);

      try {
        await sup.from('activity_logs').insert({
          action_type: 'auto_classify', target_type: 'case', target_id: comm.case_id,
          target_title: `🤖 تم تصنيف الرد تلقائياً: ${rule.label}`,
        });
      } catch (e) { console.error('[classifier] activity_logs insert failed:', e.message); }
    }

    return listId;
  }

  return null;
}

// ============ API ROUTES ============

// POST /api/classifier/analyze — classify a text without saving
router.post('/classifier/analyze', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text مطلوب' });

  const sup = getSupabase();
  const rule = classifyRule(text);
  const listIdByName = rule ? await getListIdByName(sup) : {};
  const listId = rule ? listIdByName[rule.name_en] : null;
  const { data: list } = listId
    ? await sup.from('pipeline_lists').select('id, name_ar, name_en, color').eq('id', listId).maybeSingle()
    : { data: null };

  res.json({
    success: true,
    classification: list || null,
    matches: rule ? rule.keywords.filter(kw =>
      (text.toLowerCase().includes(kw.toLowerCase()))
    ) : []
  });
});

// POST /api/classifier/auto-classify — run on inbox
router.post('/classifier/auto-classify', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const sup = getSupabase();
  const { case_id } = req.body;

  let query = sup.from('communications').select('id, case_id, subject, body')
    .eq('direction', 'inbound').eq('type', 'email').order('created_at', { ascending: false });
  query = case_id ? query.eq('case_id', parseInt(case_id)) : query.not('case_id', 'is', null);

  const { data: communications, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const listIdByName = await getListIdByName(sup);
  let classified = 0;
  let unclassified = 0;

  for (const comm of communications || []) {
    const result = await autoClassifyCommunication(sup, comm.id, listIdByName);
    if (result) classified++;
    else unclassified++;
  }

  res.json({
    success: true,
    total_checked: (communications || []).length,
    classified,
    unclassified,
    message: classified > 0
      ? `✅ تم تصنيف ${classified} رد من ${(communications || []).length}`
      : 'ℹ️ لم يتم العثور على ردود قابلة للتصنيف'
  });
});

// POST /api/classifier/auto-fetch-and-classify — poll IMAP (via the single
// shared mailPoller pipeline — no separate fetch/insert logic here anymore)
// then auto-classify whatever inbound emails matched a case.
router.post('/classifier/auto-fetch-and-classify', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const sup = getSupabase();
    const mailPoller = require('../services/mailPoller');
    const { total: newMessages, errors: pollErrors } = await mailPoller.pollAll();

    const { data: communications, error } = await sup.from('communications')
      .select('id, case_id').eq('direction', 'inbound').eq('type', 'email')
      .not('case_id', 'is', null).order('created_at', { ascending: false }).limit(Math.max(newMessages, 1) + 49);
    if (error) return res.status(500).json({ error: error.message });

    const listIdByName = await getListIdByName(sup);
    let totalClassified = 0;
    for (const comm of communications || []) {
      const result = await autoClassifyCommunication(sup, comm.id, listIdByName);
      if (result) totalClassified++;
    }

    res.json({
      success: true,
      new_messages_polled: newMessages,
      total_classified: totalClassified,
      poll_errors: pollErrors.length ? pollErrors : undefined,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
