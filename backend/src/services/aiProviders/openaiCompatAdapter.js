/**
 * OpenAI-compatible adapter -- covers BOTH OpenAI and DeepSeek, since
 * DeepSeek's API is a drop-in match for OpenAI's Chat Completions shape;
 * only the baseURL and model string differ (set by the caller).
 */
async function chat({ apiKey, model, systemPrompt, messages, tools, maxTokens, baseURL }) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });

  const openaiMessages = [{ role: 'system', content: systemPrompt }];
  for (const m of messages) {
    if (m.role === 'user') { openaiMessages.push({ role: 'user', content: m.content }); continue; }
    if (m.role === 'assistant') {
      openaiMessages.push({
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.input) } })) } : {}),
      });
      continue;
    }
    // tool_result
    openaiMessages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
  }

  const openaiTools = (tools || []).map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));

  const completion = await client.chat.completions.create({
    model, max_tokens: maxTokens || 2048,
    messages: openaiMessages,
    ...(openaiTools.length ? { tools: openaiTools, tool_choice: 'auto' } : {}),
  });

  const choice = completion.choices?.[0];
  const rawToolCalls = choice?.message?.tool_calls || [];
  const toolCalls = rawToolCalls.map(tc => {
    let input = {};
    try { input = JSON.parse(tc.function.arguments || '{}'); } catch { input = {}; }
    return { id: tc.id, name: tc.function.name, input };
  });

  return {
    text: choice?.message?.content || null,
    toolCalls,
    stopReason: toolCalls.length ? 'tool_use' : 'end',
  };
}

module.exports = { chat };
