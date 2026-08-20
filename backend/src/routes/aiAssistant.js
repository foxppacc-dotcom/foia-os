const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const os = require('os');
const fs = require('fs');
const { requireAuth, requireRole, hasPermission } = require("../middleware/auth");
router.use(requireAuth);
const { getSupabase } = require('../supabase');
const { canAccessCase, canViewAllCases, getVisibleCaseIds } = require('../services/caseAccess');
const { encrypt, decrypt } = require('../services/crypto');
const aiProviders = require('../services/aiProviders');
const { TOOL_DEFS } = require('../services/aiTools');
const { extractText } = require('../services/aiIntake');

// Same disk-storage-to-tmpdir convention as intake.js's upload -- OCR/text
// extraction shells out to a script that needs a real file path, and
// os.tmpdir() is the one writable directory on Vercel's serverless filesystem.
const chatUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}_${file.originalname}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

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
    if (!(await canAccessCase(sup, req.user, case_id))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }
    const { data: c } = await sup.from('cases').select('*').eq('id', case_id).maybeSingle();
    if (!c) return res.status(404).json({ error: 'Case not found' });

    const q = question.toLowerCase();
    const answer = await generateAnswer(q, c, sup, case_id, req.user);

    res.json({ success: true, answer, case_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Generate AI response based on question type
 */
async function generateAnswer(question, caseData, sup, caseId, user) {
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
    // Case titles are often "Lastname, Firstname" -- a raw comma there would
    // break .or()'s filter grammar (its own separator) and 500 the whole
    // query instead of just not matching, same class of bug as the Cases/
    // Inbox/Agencies search filters.
    const titlePrefix = caseData.title.substring(0, 20).replace(/[,()]/g, m => '\\' + m);
    let similarQuery = sup.from('cases')
      .select('id, title, status, created_at')
      .neq('id', caseId)
      .or(`description.ilike.%${titlePrefix}%,title.ilike.%${titlePrefix}%`)
      .order('created_at', { ascending: false }).limit(5);
    // The route already confirmed the user can access THIS case, but that
    // says nothing about the OTHER cases this query surfaces titles/status
    // for -- without the same cases.view_all scoping GET /cases applies, a
    // restricted role could learn about cases it has no access to just by
    // asking the assistant "similar cases?" on one it IS allowed to see.
    if (user && !(await canViewAllCases(sup, user.role))) {
      const visibleCaseIds = await getVisibleCaseIds(sup, user.id);
      similarQuery = similarQuery.in('id', visibleCaseIds.length ? visibleCaseIds : [-1]);
    }
    const { data: similar } = await similarQuery;

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

// ============================================================
// AI ASSISTANT (real LLM, tool-calling) -- الاستقبال الذكي → الربط الذكي
// ============================================================

// ---- Provider configuration (admin-only; keys stored encrypted, never in
// a Vercel env var -- the whole point is switching/adding providers from
// inside the app itself). ----

// GET /api/ai/providers -- list configs, NEVER the decrypted key.
router.get('/ai/providers', requireRole('admin'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { data, error } = await sup.from('ai_provider_configs')
      .select('id, provider, model, is_active, daily_request_count, created_at').order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: /does not exist|could not find the table/i.test(error.message) ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (ai_provider_configs)' : error.message });
    res.json({ success: true, data: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/ai/providers -- add a new provider config. Runs one cheap test
// call before saving so a bad key is caught immediately, not on first real use.
router.post('/ai/providers', requireRole('admin'), async (req, res) => {
  try {
    const { provider, api_key, model } = req.body;
    if (!provider || !api_key || !model) return res.status(400).json({ error: 'provider, api_key, model مطلوبة' });
    if (!['anthropic', 'openai', 'deepseek', 'gemini'].includes(provider)) return res.status(400).json({ error: 'provider غير معروف' });

    try {
      await aiProviders.chat({ provider, apiKey: api_key, model, systemPrompt: 'You are a test.', messages: [{ role: 'user', content: 'ping' }], tools: [], maxTokens: 16 });
    } catch (e) {
      return res.status(400).json({ error: `فشل الاتصال بالمزود: ${e.message}` });
    }

    const sup = getSupabase();
    const { data: created, error } = await sup.from('ai_provider_configs').insert({
      provider, model, api_key_encrypted: encrypt(api_key), is_active: false, created_by: req.user?.id,
    }).select('id, provider, model, is_active, created_at').single();
    if (error) return res.status(400).json({ error: /does not exist|could not find the table/i.test(error.message) ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (ai_provider_configs)' : error.message });
    res.json({ success: true, data: created });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/ai/providers/:id/activate -- exactly one config is ever active at
// a time (the one the chat loop uses); activating a new one deactivates the rest.
router.put('/ai/providers/:id/activate', requireRole('admin'), async (req, res) => {
  try {
    const sup = getSupabase();
    const id = parseInt(req.params.id);
    const { error: deactivateErr } = await sup.from('ai_provider_configs').update({ is_active: false }).neq('id', id);
    if (deactivateErr) return res.status(400).json({ error: deactivateErr.message });
    const { error } = await sup.from('ai_provider_configs').update({ is_active: true }).eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/ai/providers/:id
router.delete('/ai/providers/:id', requireRole('admin'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { error } = await sup.from('ai_provider_configs').delete().eq('id', parseInt(req.params.id));
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- The assistant's OWN capability set -- global, not per-role. See
// permissions.js's ai_assistant resource (which only gates who may open the
// chat at all) vs this table (what the assistant may do once someone does).

// GET /api/ai/capabilities -- {action: allowed} for every real tool
router.get('/ai/capabilities', requireRole('admin'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { data, error } = await sup.from('ai_capabilities').select('action, allowed');
    if (error) return res.status(400).json({ error: /does not exist|could not find the table/i.test(error.message) ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (ai_capabilities)' : error.message });
    const capMap = Object.fromEntries((data || []).map(r => [r.action, r.allowed]));
    res.json({ success: true, data: Object.fromEntries(TOOL_DEFS.map(t => [t.permission, capMap[t.permission] === true])) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/ai/capabilities -- { action, allowed }
router.put('/ai/capabilities', requireRole('admin'), async (req, res) => {
  try {
    const { action, allowed } = req.body;
    if (!action || !TOOL_DEFS.some(t => t.permission === action)) return res.status(400).json({ error: 'action غير معروف' });
    const sup = getSupabase();
    const { error } = await sup.from('ai_capabilities').upsert({ action, allowed: !!allowed, updated_at: new Date().toISOString() }, { onConflict: 'action' });
    if (error) return res.status(400).json({ error: /does not exist|could not find the table/i.test(error.message) ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (ai_capabilities)' : error.message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- Chat ----

// Deliberately loose (this isn't the primary cost control -- the per-provider
// daily counter below is) but stops a stuck client or runaway script from
// hammering a third-party API through this one endpoint.
const chatLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 30,
  keyGenerator: (req) => req.user?.id ? `ai-chat-${req.user.id}` : req.ip,
  message: { error: 'طلبات كثيرة جدًا للمساعد الذكي -- حاول بعد قليل' },
});

const MAX_TOOL_ROUNDS = 4;
const DAILY_REQUEST_CAP = 300; // per provider config, not per user -- a coarse org-wide safety net, not a per-seat quota.

const SYSTEM_PROMPT = `أنت المساعد الذكي داخل نظام FOIA OS لإدارة طلبات حرية المعلومات. لديك مجموعة محددة وثابتة من الأدوات فقط -- لا تملك أي قدرة على تنفيذ كود، أو الوصول لملفات السيرفر، أو تعديل إعدادات النظام أو نشره، ولا توجد أداة كهذه متاحة لك إطلاقًا مهما طُلب منك. أجب دائمًا بالعربية، وباستخدام الأدوات المتاحة لك فقط عندما يحتاج السؤال بيانات حقيقية من النظام -- لا تختلق بيانات لم تصل إليك من أداة.`;

async function getActiveProviderConfig(sup) {
  const { data } = await sup.from('ai_provider_configs').select('*').eq('is_active', true).maybeSingle();
  return data || null;
}

// POST /api/ai/chat -- multipart/form-data: { conversation_id?, message, file? }
// A file is optional; when present its text is extracted (same OCR pipeline
// intake.js uses) and folded into this turn's message as context, not stored
// anywhere -- the assistant reads it once, same as it would read pasted text.
router.post('/ai/chat', chatLimiter, chatUpload.single('file'), async (req, res) => {
  const tmpFilePath = req.file?.path || null;
  try {
    const sup = getSupabase();
    const { message, conversation_id } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'message مطلوبة' });

    // Who may talk to the assistant at all -- a normal per-role permission
    // like everywhere else. What it's allowed to DO once someone does is a
    // completely separate, global toggle set (ai_capabilities below), not
    // tied to the operating user's role at all.
    if (!(await hasPermission(sup, req.user, 'ai_assistant', 'use_chat'))) {
      return res.status(403).json({ error: 'Forbidden — لا تملك صلاحية استخدام المساعد الذكي' });
    }

    let effectiveMessage = message;
    if (req.file) {
      try {
        const fileText = await extractText(req.file.path);
        if (fileText && fileText.trim()) {
          effectiveMessage = `[محتوى الملف المرفق: ${req.file.originalname}]\n"""\n${fileText.slice(0, 12000)}\n"""\n\n[رسالة المستخدم]\n${message}`;
        }
      } catch (e) { console.error('[ai/chat] file text extraction failed:', e.message); }
    }

    const config = await getActiveProviderConfig(sup);
    if (!config) return res.status(400).json({ error: 'لا يوجد مزود ذكاء اصطناعي مُفعّل حاليًا -- فعّل واحدًا من الإعدادات' });

    // Coarse daily cost cap, reset once per calendar day.
    const today = new Date().toISOString().split('T')[0];
    let requestCount = config.daily_request_count || 0;
    if (config.daily_count_reset_at !== today) requestCount = 0;
    if (requestCount >= DAILY_REQUEST_CAP) return res.status(429).json({ error: 'تم الوصول للحد اليومي لطلبات المساعد الذكي -- حاول غدًا' });

    const apiKey = decrypt(config.api_key_encrypted);
    if (!apiKey) return res.status(500).json({ error: 'تعذر فك تشفير مفتاح المزود -- أعد ضبطه من الإعدادات' });

    // The assistant's OWN global capability set -- an admin widens or
    // narrows this from "الربط الذكي" based on how accurate they find its
    // results, independent of which role is currently chatting with it.
    const { data: capRows } = await sup.from('ai_capabilities').select('action, allowed');
    const capMap = Object.fromEntries((capRows || []).map(r => [r.action, r.allowed]));
    const allowedTools = TOOL_DEFS.filter(t => capMap[t.permission] === true);
    const toolSchemas = allowedTools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
    const toolByName = Object.fromEntries(allowedTools.map(t => [t.name, t]));

    // Conversation history
    let conversationId = conversation_id ? parseInt(conversation_id) : null;
    if (conversationId) {
      const { data: conv } = await sup.from('ai_conversations').select('id, user_id').eq('id', conversationId).maybeSingle();
      if (!conv || conv.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    } else {
      const { data: created, error: convErr } = await sup.from('ai_conversations').insert({
        user_id: req.user.id, title: message.slice(0, 60), provider_config_id: config.id,
      }).select('id').single();
      if (convErr) return res.status(400).json({ error: /does not exist|could not find the table/i.test(convErr.message) ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (ai_conversations)' : convErr.message });
      conversationId = created.id;
    }

    const { data: priorRows } = await sup.from('ai_messages').select('role, content, tool_calls').eq('conversation_id', conversationId).order('created_at', { ascending: true });
    const history = (priorRows || []).map(r => r.role === 'assistant'
      ? { role: 'assistant', content: r.content, toolCalls: r.tool_calls || [] }
      : { role: r.role, content: r.content });

    // Stored history keeps the short, human-written message (not the
    // file-content-prefixed version) so a conversation doesn't balloon with
    // repeated file text on every later turn -- the extracted text is only
    // ever injected into THIS turn's actual call to the provider below.
    await sup.from('ai_messages').insert({ conversation_id: conversationId, role: 'user', content: message });
    const messages = [...history, { role: 'user', content: effectiveMessage }];

    let finalText = null;
    let rounds = 0;
    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      let result;
      try {
        result = await aiProviders.chat({
          provider: config.provider, apiKey, model: config.model,
          systemPrompt: SYSTEM_PROMPT, messages, tools: toolSchemas, maxTokens: 2048,
        });
      } catch (e) {
        return res.status(502).json({ error: `فشل الاتصال بمزود الذكاء الاصطناعي: ${e.message}` });
      }

      if (result.stopReason !== 'tool_use' || !result.toolCalls?.length) {
        finalText = result.text || 'لم يتمكن المساعد من إعطاء رد.';
        messages.push({ role: 'assistant', content: finalText, toolCalls: [] });
        await sup.from('ai_messages').insert({ conversation_id: conversationId, role: 'assistant', content: finalText, tool_calls: [] });
        break;
      }

      messages.push({ role: 'assistant', content: result.text || null, toolCalls: result.toolCalls });
      await sup.from('ai_messages').insert({ conversation_id: conversationId, role: 'assistant', content: result.text || null, tool_calls: result.toolCalls });

      for (const call of result.toolCalls) {
        const tool = toolByName[call.name];
        let content;
        if (!tool) {
          // Defense in depth: even though only permitted tools were ever
          // offered to the model, refuse anything not in that exact set.
          content = JSON.stringify({ error: `الأداة "${call.name}" غير متاحة أو غير مصرح بها` });
        } else {
          try {
            const output = await tool.run(sup, call.input || {}, { user: req.user });
            content = JSON.stringify(output);
          } catch (e) {
            content = JSON.stringify({ error: e.message });
          }
        }
        messages.push({ role: 'tool_result', toolCallId: call.id, toolName: call.name, content });
        await sup.from('ai_messages').insert({ conversation_id: conversationId, role: 'tool', content, tool_calls: [{ id: call.id, name: call.name }] });
      }
    }

    if (finalText === null) {
      finalText = 'تعذر إكمال الطلب ضمن عدد محاولات الأدوات المسموح -- حاول تبسيط السؤال أو تقسيمه.';
      await sup.from('ai_messages').insert({ conversation_id: conversationId, role: 'assistant', content: finalText, tool_calls: [] });
    }

    await sup.from('ai_provider_configs').update({ daily_request_count: requestCount + 1, daily_count_reset_at: today }).eq('id', config.id);

    res.json({ success: true, conversation_id: conversationId, answer: finalText });
  } catch (err) { res.status(500).json({ error: err.message }); }
  finally {
    if (tmpFilePath) fs.unlink(tmpFilePath, () => {});
  }
});

// GET /api/ai/conversations -- the current user's own conversation list
router.get('/ai/conversations', async (req, res) => {
  try {
    const sup = getSupabase();
    const { data, error } = await sup.from('ai_conversations').select('id, title, created_at').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(50);
    if (error) return res.status(400).json({ error: /does not exist|could not find the table/i.test(error.message) ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (ai_conversations)' : error.message });
    res.json({ success: true, data: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/ai/conversations/:id -- full message history (own conversation only)
router.get('/ai/conversations/:id', async (req, res) => {
  try {
    const sup = getSupabase();
    const id = parseInt(req.params.id);
    const { data: conv } = await sup.from('ai_conversations').select('id, user_id').eq('id', id).maybeSingle();
    if (!conv || conv.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const { data, error } = await sup.from('ai_messages').select('id, role, content, created_at').eq('conversation_id', id).order('created_at', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, data: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
