const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSupabase } = require('../supabase');

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
      bestMatch = rule.list_id;
    }
  }

  // Only classify if there's meaningful signal
  return bestScore >= 2 ? bestMatch : null;
}

/**
 * Auto-classify an incoming communication
 */
async function autoClassifyCommunication(sup, commId) {
  const { data: comm } = await sup.from('communications').select('*').eq('id', commId).maybeSingle();
  if (!comm) return null;

  const text = `${comm.subject || ''} ${comm.body || ''}`;
  const listId = classifyText(text);

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

      const { data: list } = await sup.from('pipeline_lists').select('name_ar').eq('id', listId).maybeSingle();
      try {
        await sup.from('activity_logs').insert({
          action_type: 'auto_classify', target_type: 'case', target_id: comm.case_id,
          target_title: `🤖 تم تصنيف الرد تلقائياً: ${list?.name_ar || 'تصنيف ' + listId}`,
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

  const listId = classifyText(text);
  const sup = getSupabase();
  const { data: list } = listId
    ? await sup.from('pipeline_lists').select('id, name_ar, name_en, color').eq('id', listId).maybeSingle()
    : { data: null };

  res.json({
    success: true,
    classification: list || null,
    matches: list ? CLASSIFICATION_RULES[listId - 1].keywords.filter(kw =>
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

  let classified = 0;
  let unclassified = 0;

  for (const comm of communications || []) {
    const result = await autoClassifyCommunication(sup, comm.id);
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
    const newMessages = await mailPoller.pollAll();

    const { data: communications, error } = await sup.from('communications')
      .select('id, case_id').eq('direction', 'inbound').eq('type', 'email')
      .not('case_id', 'is', null).order('created_at', { ascending: false }).limit(newMessages || 50);
    if (error) return res.status(500).json({ error: error.message });

    let totalClassified = 0;
    for (const comm of communications || []) {
      const result = await autoClassifyCommunication(sup, comm.id);
      if (result) totalClassified++;
    }

    res.json({
      success: true,
      new_messages_polled: newMessages,
      total_classified: totalClassified,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
