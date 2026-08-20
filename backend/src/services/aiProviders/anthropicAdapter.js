/**
 * Anthropic adapter -- translates the normalized chat() shape (see
 * ../aiProviders/index.js) into the Messages API's tool-use format and back.
 * Same lazy-require + fresh-client-per-call convention as aiClassifier.js.
 */
async function chat({ apiKey, model, systemPrompt, messages, tools, maxTokens }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const anthropicMessages = messages.map(m => {
    if (m.role === 'user') return { role: 'user', content: m.content };
    if (m.role === 'assistant') {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls || []) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      return { role: 'assistant', content: blocks };
    }
    // tool_result
    return { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }] };
  });

  const anthropicTools = (tools || []).map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }));

  const message = await client.messages.create({
    model, max_tokens: maxTokens || 2048,
    system: systemPrompt,
    ...(anthropicTools.length ? { tools: anthropicTools } : {}),
    messages: anthropicMessages,
  });

  const textBlocks = (message.content || []).filter(c => c.type === 'text').map(c => c.text);
  const toolCalls = (message.content || []).filter(c => c.type === 'tool_use').map(c => ({ id: c.id, name: c.name, input: c.input }));

  return {
    text: textBlocks.join('\n') || null,
    toolCalls,
    stopReason: message.stop_reason === 'tool_use' ? 'tool_use' : 'end',
  };
}

module.exports = { chat };
