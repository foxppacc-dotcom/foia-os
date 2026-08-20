/**
 * Gemini adapter -- Google's function-calling shape (functionCall/
 * functionResponse parts inside role 'model'/'user' contents) differs from
 * both Anthropic's and OpenAI's, so it gets its own translation, same
 * normalized in/out shape as the other two adapters.
 */
async function chat({ apiKey, model, systemPrompt, messages, tools, maxTokens }) {
  const { GoogleGenAI } = require('@google/genai');
  const client = new GoogleGenAI({ apiKey });

  const contents = messages.map(m => {
    if (m.role === 'user') return { role: 'user', parts: [{ text: m.content }] };
    if (m.role === 'assistant') {
      const parts = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls || []) parts.push({ functionCall: { name: tc.name, args: tc.input } });
      return { role: 'model', parts };
    }
    // tool_result
    return { role: 'user', parts: [{ functionResponse: { name: m.toolName, response: { result: m.content } } }] };
  });

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
