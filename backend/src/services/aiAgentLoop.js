// Headless, bounded tool-calling loop for the recurring AI tasks. A separate,
// deliberately small loop on top of aiProviders.chat -- the interactive /ai/chat
// route is NOT touched. No req/res: the caller passes the user the tools act as.
const aiProviders = require('./aiProviders');
const { decrypt } = require('./crypto');
const { getSetting, setSetting, getLimits } = require('./aiTaskCommon');

const DEFAULT_DAILY_BUDGET = 450; // LLM calls per day made by recurring tasks (shared provider cap is 600)

async function getActiveProviderConfig(sup) {
  const { data } = await sup.from('ai_provider_configs').select('*').eq('is_active', true).is('deleted_at', null).maybeSingle();
  return data || null;
}

class BudgetError extends Error {}

// Per-day budget for task-originated calls; also bumps the provider's shared daily
// counter so the interactive chat's cap stays honest.
async function consumeBudget(sup, config) {
  const today = new Date().toISOString().slice(0, 10);
  const b = await getSetting(sup, 'llm_budget', {});
  const limit = (await getLimits(sup)).daily_llm_budget || DEFAULT_DAILY_BUDGET;
  const count = b.date === today ? (b.count || 0) : 0;
  if (count >= limit) throw new BudgetError(`تم استهلاك الميزانية اليومية لمهام المساعد (${limit} طلب)`);
  await setSetting(sup, 'llm_budget', { date: today, count: count + 1, limit });
  try {
    const providerCount = config.daily_count_reset_at === today ? (config.daily_request_count || 0) : 0;
    config.daily_request_count = providerCount + 1; config.daily_count_reset_at = today;
    await sup.from('ai_provider_configs').update({ daily_request_count: providerCount + 1, daily_count_reset_at: today }).eq('id', config.id);
  } catch { /* best effort */ }
}

const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`انتهت مهلة ${label}`)), ms))]);

/**
 * tools: [{ name, description, input_schema, run(sup, input, ctx) }]
 * Returns { finalText, steps:[{tool, input, ok}], llmCalls }
 */
async function runAgent({ sup, user, systemPrompt, userPrompt, tools, maxRounds = 6, callTimeoutMs = 120000 }) {
  const config = await getActiveProviderConfig(sup);
  if (!config) throw new Error('لا يوجد مزود ذكاء اصطناعي مفعّل');
  const apiKey = config.api_key_encrypted ? decrypt(config.api_key_encrypted) : null;
  if (config.provider !== 'ollama' && !apiKey) throw new Error('تعذر فك تشفير مفتاح المزود');

  const toolSchemas = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  const toolByName = Object.fromEntries(tools.map(t => [t.name, t]));
  const messages = [{ role: 'user', content: userPrompt }];
  const steps = [];
  let llmCalls = 0;
  let finalText = '';

  for (let round = 0; round < maxRounds; round++) {
    await consumeBudget(sup, config);
    llmCalls++;
    const result = await withTimeout(aiProviders.chat({
      provider: config.provider, apiKey, model: config.model, baseURL: config.base_url,
      systemPrompt, messages, tools: toolSchemas, maxTokens: 4096,
    }), callTimeoutMs, 'استدعاء النموذج');
    if (result.stopReason !== 'tool_use' || !result.toolCalls?.length) { finalText = result.text || ''; break; }

    messages.push({ role: 'assistant', content: result.text || null, toolCalls: result.toolCalls });
    for (const call of result.toolCalls) {
      const tool = toolByName[call.name];
      let content; let ok = true;
      if (!tool) { content = JSON.stringify({ error: `أداة غير معروفة: ${call.name}` }); ok = false; }
      else {
        try { content = JSON.stringify(await tool.run(sup, call.input || {}, { user })); }
        catch (e) { content = JSON.stringify({ error: e.message }); ok = false; }
      }
      // keep tool results bounded -- they are re-sent to the model every later round
      if (content.length > 12000) content = content.slice(0, 12000) + '…(مقتطع)';
      steps.push({ tool: call.name, input: call.input, ok });
      messages.push({ role: 'tool_result', toolCallId: call.id, toolName: call.name, content });
    }
  }
  return { finalText, steps, llmCalls };
}

module.exports = { runAgent, getActiveProviderConfig, BudgetError };
