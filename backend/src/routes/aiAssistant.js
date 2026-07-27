const express = require('express');
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
router.use(requireAuth);
router.use(requireAuth);
const { getDatabase } = require('../database');

/**
 * AI Assistant Service
 * Provides intelligent responses about cases without external AI APIs
 * Uses rule-based logic, keyword analysis, and data aggregation
 */

// POST /api/ai/ask - Ask AI about a case
router.post('/ai/ask', (req, res) => {
  const { case_id, question } = req.body;
  if (!case_id || !question) return res.status(400).json({ error: 'case_id and question required' });

  const db = getDatabase();
  const c = db.prepare('SELECT * FROM cases WHERE id = ?').get(case_id);
  if (!c) return res.status(404).json({ error: 'Case not found' });

  const q = question.toLowerCase();
  const answer = generateAnswer(q, c, db, case_id);

  res.json({ success: true, answer, case_id });
});

/**
 * Generate AI response based on question type
 */
function generateAnswer(question, caseData, db, caseId) {
  const requests = db.prepare('SELECT * FROM requests WHERE case_id = ?').all(caseId);
  const comms = db.prepare('SELECT * FROM communications WHERE case_id = ? ORDER BY created_at DESC').all(caseId);
  const docs = db.prepare('SELECT * FROM case_documents WHERE case_id = ?').all(caseId);
  const tasks = db.prepare('SELECT * FROM case_tasks WHERE case_id = ?').all(caseId);
  const comments = db.prepare('SELECT * FROM case_comments WHERE case_id = ? ORDER BY created_at DESC').all(caseId);

  // === 1. Summarize the case ===
  if (/لخص\s*(القضية|هذه|الموضوع)|summarize|summary|ملخص/.test(question)) {
    const pendingReqs = requests.filter(r => r.status === 'pending').length;
    const respondedReqs = requests.filter(r => r.status === 'responded').length;
    const overdueTasks = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date()).length;

    return `📋 **ملخص القضية #${caseData.id}**

**العنوان:** ${caseData.title}
**الحالة:** ${caseData.status === 'open' ? '🟦 مفتوحة' : caseData.status === 'in_progress' ? '🟡 قيد التنفيذ' : '🟢 مغلقة'}
**الأولوية:** ${caseData.priority === 'high' ? '🔴 عاجلة' : caseData.priority === 'medium' ? '🟡 متوسطة' : '🟢 منخفضة'}
**العميل:** ${caseData.client_name || 'غير محدد'}
**التاريخ:** ${caseData.created_at || '—'}

📊 **إحصائيات:**
• ${requests.length} طلب (${pendingReqs} pending، ${respondedReqs} تم الرد)
• ${comms.length} مراسلة
• ${docs.length} مستند
• ${tasks.length} مهمة
• ${overdueTasks > 0 ? `⚠️ ${overdueTasks} مهمة متأخرة` : '✅ لا توجد مهام متأخرة'}
${caseData.deadline ? `\n📅 **الموعد النهائي:** ${caseData.deadline}` : ''}`;
  }

  // === 2. What am I waiting for? ===
  if (/ناقص|محتاج|متبقي|بانتظار|waiting|pending|missing/i.test(question)) {
    const pending = requests.filter(r => r.status === 'pending');
    if (pending.length === 0 && tasks.filter(t => t.status !== 'done').length === 0) {
      return '✅ **لا يوجد شيء ناقص.** كل الطلبات تم الرد عليها وكل المهام مكتملة.';
    }

    let response = '⏳ **بانتظار:**\n';
    if (pending.length > 0) {
      response += `\n📨 **طلبات بانتظار الرد (${pending.length}):**`;
      pending.forEach(r => {
        const agency = r.agency_id ? db.prepare('SELECT name_ar FROM agencies WHERE id = ?').get(r.agency_id) : null;
        response += `\n• ${agency ? agency.name_ar : 'جهة غير محددة'} — أُرسل: ${r.sent_date || '—'}`;
      });
    }
    const activeTasks = tasks.filter(t => t.status !== 'done');
    if (activeTasks.length > 0) {
      response += `\n\n📋 **مهام نشطة (${activeTasks.length}):**`;
      activeTasks.forEach(t => response += `\n• ${t.title}${t.due_date ? ` (تاريخ: ${t.due_date})` : ''}`);
    }
    return response;
  }

  // === 3. Draft a follow-up / reply ===
  const draftRegex = /(اكتب|صغ|draft|write)\s*(متابعة|follow.up|رد|reply|إيميل|email)/i;
  if (draftRegex.test(question)) {
    const pendingAgencies = requests.filter(r => r.status === 'pending');
    if (pendingAgencies.length === 0) {
      return '✅ **لا تحتاج متابعة.** كل الجهات ردت.';
    }

    const agency = pendingAgencies[0];
    const agencyName = agency.agency_id 
      ? (db.prepare('SELECT name_ar FROM agencies WHERE id = ?').get(agency.agency_id)?.name_ar || 'الجهة المعنية')
      : 'الجهة المعنية';

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

    const pendingReqs = requests.filter(r => r.status === 'pending');
    if (pendingReqs.length > 0) {
      actions.push(`📨 **متابعة ${pendingReqs.length} طلب(بات)** لم يتم الرد عليها بعد`);
    }

    const overdueTasks = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done');
    if (overdueTasks.length > 0) {
      actions.push(`⚠️ **${overdueTasks.length} مهمة متأخرة** تحتاج إعادة جدولة`);
    }

    const activeTasks = tasks.filter(t => t.status !== 'done' && (!t.due_date || new Date(t.due_date) >= new Date()));
    if (activeTasks.length > 0) {
      actions.push(`📋 **${activeTasks.length} مهمة نشطة** قيد التنفيذ`);
    }

    const noDocs = docs.length === 0;
    if (noDocs) {
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
    if (docs.length === 0) return '📄 **لا توجد مستندات** مرفوعة لهذه القضية بعد.';

    let response = `📁 **المستندات (${docs.length}):**\n`;
    docs.forEach(d => {
      response += `\n• ${d.original_name} (${(d.size / 1024).toFixed(1)} KB) — ${d.created_at}`;
    });
    return response;
  }

  // === 6. Similar cases / duplicates ===
  const similarRegex = /(مشابه|مكرر|similar|duplicate|آخر|same)/i;
  if (similarRegex.test(question)) {
    const similar = db.prepare(`
      SELECT id, title, status, created_at FROM cases 
      WHERE id != ? AND (description LIKE ? OR title LIKE ?)
      ORDER BY created_at DESC LIMIT 5
    `).all(caseId, `%${caseData.title.substring(0, 20)}%`, `%${caseData.title.substring(0, 20)}%`);

    if (similar.length === 0) return '🔍 **لا توجد قضايا مشابهة.**';

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
    if (comms.length > 0) {
      response += `\n\n**آخر المراسلات:**`;
      comms.slice(0, 5).forEach(c => {
        const icon = c.direction === 'outbound' ? '📤' : '📥';
        response += `\n${icon} ${c.subject || 'بدون موضوع'} — ${c.created_at}`;
      });
    }
    if (comments.length > 0) {
      response += `\n\n**آخر التعليقات:**`;
      comments.slice(0, 3).forEach(c => response += `\n💬 ${c.content?.substring(0, 100)} — ${c.created_at}`);
    }
    return response;
  }

  // === 8. Generate response / reply to specific agency ===
  const replyRegex = /(generate|رد|respond|answer|إجابة)/i;
  if (replyRegex.test(question)) {
    const agencies = db.prepare(`
      SELECT DISTINCT a.name_ar, a.email FROM agencies a
      JOIN requests r ON r.agency_id = a.id
      WHERE r.case_id = ?
    `).all(caseId);

    if (agencies.length === 0) return '📧 **لم يتم تحديد جهات** لهذه القضية.';
    
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
