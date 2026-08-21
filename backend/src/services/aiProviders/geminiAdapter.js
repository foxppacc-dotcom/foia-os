/**
 * Gemini adapter -- Google's function-calling shape (functionCall/
 * functionResponse parts inside role 'model'/'user' contents) differs from
 * both Anthropic's and OpenAI's, so it gets its own translation, same
 * normalized in/out shape as the other two adapters.
 */
async function chat({ apiKey, model, systemPrompt, messages, tools, maxTokens }) {
  const { GoogleGenAI } = require('@google/genai');
  const client = new GoogleGenAI({ apiKey });

  // Gemini expects every function response from the SAME model turn grouped
  // into one user-role content entry (multiple functionResponse parts), the
  // same reasoning as Anthropic's tool_result merging below -- a round with
  // several tool calls would otherwise produce back-to-back single-part user
  // entries instead of one multi-part entry.
  const contents = [];
  for (const m of messages) {
    if (m.role === 'user') { contents.push({ role: 'user', parts: [{ text: m.content }] }); continue; }
    if (m.role === 'assistant') {
      const parts = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls || []) parts.push({ functionCall: { name: tc.name, args: tc.input } });
      contents.push({ role: 'model', parts });
      continue;
    }
    // tool_result
    const part = { functionResponse: { name: m.toolName, response: { result: m.content } } };
    const last = contents[contents.length - 1];
    if (last?.role === 'user' && last.parts?.[0]?.functionResponse) {
      last.parts.push(part);
    } else {
      contents.push({ role: 'user', parts: [part] });
    }
  }

  const geminiTools = (tools || []).length
    ? [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.input_schema })) }]
    : undefined;

  const response = await client.models.generateContent({
    model, contents,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: maxTokens || 2048,
      ...(geminiTools ? { tools: geminiTools } : {}),
    },
  });

  const parts = response.candidates?.[0]?.content?.parts || [];
  const textParts = parts.filter(p => p.text).map(p => p.text);
  const toolCalls = parts.filter(p => p.functionCall).map((p, i) => ({
    id: `gemini-call-${Date.now()}-${i}`, // Gemini doesn't assign call ids -- synthesize a stable-enough one for this turn
    name: p.functionCall.name, input: p.functionCall.args || {},
  }));

  return {
    text: textParts.join('\n') || null,
    toolCalls,
    stopReason: toolCalls.length ? 'tool_use' : 'end',
  };
}

module.exports = { chat };
