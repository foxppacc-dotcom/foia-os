/**
 * Anthropic adapter -- translates the normalized chat() shape (see
 * ../aiProviders/index.js) into the Messages API's tool-use format and back.
 * Same lazy-require + fresh-client-per-call convention as aiClassifier.js.
 */
async function chat({ apiKey, model, systemPrompt, messages, tools, maxTokens }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  // Anthropic requires strict user/assistant alternation. A single round of
  // the chat loop can produce several tool calls at once, each arriving here
  // as its own separate 'tool_result' entry -- mapping each to its own
  // {role:'user'} message produced back-to-back user turns and a 400 from
  // the API. Consecutive tool_result entries are merged into ONE user
  // message's content array instead, matching how Anthropic expects a
  // multi-tool round's results to be reported back.
  const anthropicMessages = [];
  for (const m of messages) {
    if (m.role === 'user') { anthropicMessages.push({ role: 'user', content: m.content }); continue; }
    if (m.role === 'assistant') {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls || []) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      anthropicMessages.push({ role: 'assistant', content: blocks });
      continue;
    }
    // tool_result
    const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
    const last = anthropicMessages[anthropicMessages.length - 1];
    if (last?.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') {
      last.content.push(block);
    } else {
      anthropicMessages.push({ role: 'user', content: [block] });
    }
  }

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
