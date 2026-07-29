const express = require('express');
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
router.use(requireAuth);
const { getSupabase } = require('../supabase');

/**
 * AI Assistant Service
 * Provides intelligent responses about cases without external AI APIs
 * Uses rule-based logic, keyword analysis, and data aggregation
 */

// POST /api/ai/ask - Ask AI about a case
router.post('/ai/ask', async (req, res) => {
  try {
    const { case_id, question } = req.body;
    if (!case_id || !question) return res.status(400).json({ error: 'case_id and question required' });

    const sup = getSupabase();
    const { data: c } = await sup.from('cases').select('*').eq('id', case_id).maybeSingle();
    if (!c) return res.status(404).json({ error: 'Case not found' });

    const q = question.toLowerCase();
    const answer = await generateAnswer(q, c, sup, case_id);

    res.json({ success: true, answer, case_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Generate AI response based on question type
 */
async function generateAnswer(question, caseData, sup, caseId) {
  const [{ data: requests }, { data: comms }, { data: docs }, { data: tasks }, { data: comments }] = await Promise.all([
    sup.from('requests').select('*').eq('case_id', caseId),
    sup.from('communications').select('*').eq('case_id', caseId).order('created_at', { ascending: false }),
    sup.from('case_documents').select('*').eq('case_id', caseId),
    sup.from('case_tasks').select('*').eq('case_id', caseId),
    sup.from('activity_logs').select('*').eq('target_type', 'case').eq('target_id', caseId).order('created_at', { ascending: false }),
  ]);
  const reqs = requests || [], communications = comms || [], documents = docs || [], caseTasks = tasks || [], activity = comments || [];

  // === 1. Summarize the case ===
  if (/لخص\s*(القضية|هذه|الموضوع)|summarize|summary|ملخص/.test(question)) {
    const pendingReqs = reqs.filter(r => r.status === 'pending').length;
    const respondedReqs = reqs.filter(r => r.status === 'responded').length;
    const overdueTasks = caseTasks.filter(t => t.due_date && new Date(t.due_date) < new Date()).length;

    return `📋 **ملخص القضية #${caseData.id}**

**العنوان:** ${caseData.title}
**الحالة:** ${caseData.status === 'open' ? '🟦 مفتوحة' : caseData.status === 'in_progress' ? '🟡 قيد التنفيذ' : '🟢 مغلقة'}
**الأولوية:** ${caseData.priority === 'high' ? '🔴 عاجلة' : caseData.priority === 'medium' ? '🟡 متوسطة' : '🟢 منخفضة'}
**العميل:** ${caseData.client_name || 'غير محدد'}
**التاريخ:** ${caseData.created_at || '—'}

📊 **إحصائيات:**
• ${reqs.length} طلب (${pendingReqs} pending، ${respondedReqs} تم الرد)
• ${communications.length} مراسلة
• ${documents.length} مستند
• ${caseTasks.length} مهمة
• ${overdueTasks > 0 ? `⚠️ ${overdueTasks} مهمة متأخرة` : '✅ لا توجد مهام متأخرة'}
${caseData.deadline ? `\n📅 **الموعد النهائي:** ${caseData.deadline}` : ''}`;
  }

  // === 2. What am I waiting for? ===
  if (/ناقص|محتاج|متبقي|بانتظار|waiting|pending|missing/i.test(question)) {
    const pending = reqs.filter(r => r.status === 'pending');
    if (pending.length === 0 && caseTasks.filter(t => t.status !== 'done').length === 0) {
      return '✅ **لا يوجد شيء ناقص.** كل الطلبات تم الرد عليها وكل المهام مكتملة.';
    }

    let response = '⏳ **بانتظار:**\n';
    if (pending.length > 0) {
      response += `\n📨 **طلبات بانتظار الرد (${pending.length}):**`;
      for (const r of pending) {
        const agency = r.agency_id ? (await sup.from('agencies').select('name_ar').eq('id', r.agency_id).maybeSingle()).data : null;
        response += `\n• ${agency ? agency.name_ar : 'جهة غير محددة'} — أُرسل: ${r.sent_date || '—'}`;
      }
    }
    const activeTasks = caseTasks.filter(t => t.status !== 'done');
    if (activeTasks.length > 0) {
      response += `\n\n📋 **مهام نشطة (${activeTasks.length}):**`;
      activeTasks.forEach(t => response += `\n• ${t.title}${t.due_date ? ` (تاريخ: ${t.due_date})` : ''}`);
    }
    return response;
  }

  // === 3. Draft a follow-up / reply ===
  const draftRegex = /(اكتب|صغ|draft|write)\s*(متابعة|follow.up|رد|reply|إيميل|email)/i;
  if (draftRegex.test(question)) {
    const pendingAgencies = reqs.filter(r => r.status === 'pending');
    if (pendingAgencies.length === 0) {
      return '✅ **لا تحتاج متابعة.** كل الجهات ردت.';
    }

    const agency = pendingAgencies[0];
    const agencyRow = agency.agency_id
      ? (await sup.from('agencies').select('name_ar').eq('id', agency.agency_id).maybeSingle()).data
      : null;
    const agencyName = agencyRow?.name_ar || 'الجهة المعنية';

    return `📧 **صيغة متابعة مقترحة:**

**إلى:** ${agencyName}
**الموضوع:** متابعة طلب السجلات — ${caseData.title}

نص الإيميل:

---

السادة/${agencyName}،

تحية طيبة وبعد،

نرفع لكم طلب متابعة بخصوص طلبنا السابق بخصوص الحصول على السجلات والمستندات المتعلقة بالقضية رقم ${caseData.uuid?.slice(0, 8)}.

نأمل من سيادتكم التفضل بالإفادة عن حالة الطلب، وتزويدنا بأي مستندات أو سجلات متاحة.

وتفضلوا بقبول فائق الاحترام،

**فريق FOIA OS**

---

💡 يمكنك نسخ النص وإرساله من صفحة المراسلات.`;
  }

  // === 4. Next actions ===
  const actionRegex = /(الإجراء|next|action|تالي|القادم|what.*next|ماذا.*بعد|خطوة)/i;
  if (actionRegex.test(question)) {
    let actions = [];

    const pendingReqs = reqs.filter(r => r.status === 'pending');
    if (pendingReqs.length > 0) {
      actions.push(`📨 **متابعة ${pendingReqs.length} طلب(بات)** لم يتم الرد عليها بعد`);
    }

    const overdueTasks = caseTasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done');
    if (overdueTasks.length > 0) {
      actions.push(`⚠️ **${overdueTasks.length} مهمة متأخرة** تحتاج إعادة جدولة`);
    }

    const activeTasks = caseTasks.filter(t => t.status !== 'done' && (!t.due_date || new Date(t.due_date) >= new Date()));
    if (activeTasks.length > 0) {
      actions.push(`📋 **${activeTasks.length} مهمة نشطة** قيد التنفيذ`);
    }

    if (documents.length === 0) {
      actions.push('📄 **رفع المستندات** المتعلقة بالقضية');
    }

    if (caseData.status === 'open') {
      actions.push('🔄 **تحديث حالة القضية** إلى "قيد التنفيذ"');
    }

    if (actions.length === 0) {
      return '✅ **لا توجد إجراءات مطلوبة.** كل شيء مكتمل. القضية جاهزة للإغلاق.';
    }

    return `🎯 **الإجراءات التالية المقترحة (مرتبة حسب الأولوية):**

${actions.map((a, i) => `${i + 1}. ${a}`).join('\n')}`;
  }

  // === 5. Show documents / evidence ===
  const docRegex = /(مستندات|وثائق|ملفات|documents|files|evidence|أدلة)/i;
  if (docRegex.test(question)) {
    if (documents.length === 0) return '📄 **لا توجد مستندات** مرفوعة لهذه القضية بعد.';

    let response = `📁 **المستندات (${documents.length}):**\n`;
    documents.forEach(d => {
      response += `\n• ${d.original_name} (${(d.size / 1024).toFixed(1)} KB) — ${d.created_at}`;
    });
    return response;
  }

  // === 6. Similar cases / duplicates ===
  const similarRegex = /(مشابه|مكرر|similar|duplicate|آخر|same)/i;
  if (similarRegex.test(question)) {
    const titlePrefix = caseData.title.substring(0, 20);
    const { data: similar } = await sup.from('cases')
      .select('id, title, status, created_at')
      .neq('id', caseId)
      .or(`description.ilike.%${titlePrefix}%,title.ilike.%${titlePrefix}%`)
      .order('created_at', { ascending: false }).limit(5);

    if (!similar || similar.length === 0) return '🔍 **لا توجد قضايا مشابهة.**';

    let response = `🔍 **قضايا مشابهة (${similar.length}):**\n`;
    similar.forEach(s => {
      response += `\n• [#${s.id}] ${s.title} — ${s.status === 'open' ? '🟦 مفتوحة' : s.status === 'in_progress' ? '🟡 قيد التنفيذ' : '🟢 مغلقة'}`;
    });
    return response;
  }

  // === 7. Timeline / Activity ===
  const tlRegex = /(timeline|activity|نشاط|أحداث|سجل|تاريخ|متى)/i;
  if (tlRegex.test(question)) {
    let response = `📅 **نشاط القضية:**\n\n**الإنشاء:** ${caseData.created_at || '—'}`;
    if (communications.length > 0) {
      response += `\n\n**آخر المراسلات:**`;
      communications.slice(0, 5).forEach(c => {
        const icon = c.direction === 'outbound' ? '📤' : '📥';
        response += `\n${icon} ${c.subject || 'بدون موضوع'} — ${c.created_at}`;
      });
    }
    if (activity.length > 0) {
      response += `\n\n**آخر الأنشطة:**`;
      activity.slice(0, 3).forEach(a => response += `\n💬 ${a.target_title?.substring(0, 100)} — ${a.created_at}`);
    }
    return response;
  }

  // === 8. Generate response / reply to specific agency ===
  const replyRegex = /(generate|رد|respond|answer|إجابة)/i;
  if (replyRegex.test(question)) {
    const agencyIds = [...new Set(reqs.map(r => r.agency_id).filter(Boolean))];
    const { data: agencies } = agencyIds.length
      ? await sup.from('agencies').select('name_ar, email').in('id', agencyIds)
      : { data: [] };

    if (!agencies || agencies.length === 0) return '📧 **لم يتم تحديد جهات** لهذه القضية.';

    let response = `✍️ **صيغ الرد المقترحة:**\n`;
    agencies.forEach(a => {
      response += `\n📨 **${a.name_ar}**`;
      response += `\nنشكركم على تعاونكم. نرجو التفضل بتزويدنا بالسجلات المطلوبة بخصوص القضية رقم ${caseData.uuid?.slice(0, 8)}.`;
      response += `\n`;
    });
    return response;
  }

  // === Default: I don't understand ===
  return `🤖 **مرحباً! أنا مساعد FOIA OS الذكي.**

يمكنني مساعدتك في:
• 📋 **لخص القضية** — ملخص كامل
• ⏳ **إيش ناقصني؟** — الطلبات المعلقة
• 📧 **اكتب متابعة** — صيغة إيميل متابعة
• 🎯 **الإجراء التالي** — الخطوات القادمة
• 📁 **المستندات** — الملفات المرفوعة
• 🔍 **قضايا مشابهة**
• 📅 **النشاط** — سجل القضية
• ✍️ **رد** — صيغة رد للجهات

⚠️ لم أتعرف على طلبك بشكل محدد. اختر أحد الأمثلة أعلاه 👆`;
}

module.exports = router;
