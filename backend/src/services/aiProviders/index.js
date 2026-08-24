/**
 * Single normalized entry point for every AI provider this feature supports.
 * Nothing outside this directory should ever branch on `provider` -- each
 * adapter is responsible only for translating its own SDK's request/response
 * shape into this one normalized in/out contract:
 *
 *   chat({ provider, apiKey, model, systemPrompt, messages, tools, maxTokens })
 *     -> { text: string|null, toolCalls: [{id, name, input}], stopReason: 'tool_use'|'end' }
 *
 * `messages` (normalized, provider-agnostic):
 *   { role: 'user', content: string }
 *   { role: 'assistant', content: string|null, toolCalls: [{id, name, input}] }
 *   { role: 'tool_result', toolCallId: string, toolName: string, content: string }
 *
 * `tools`: [{ name, description, input_schema: <JSON Schema object> }]
 */
const anthropicAdapter = require('./anthropicAdapter');
const openaiCompatAdapter = require('./openaiCompatAdapter');
const geminiAdapter = require('./geminiAdapter');

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

async function chat({ provider, apiKey, model, systemPrompt, messages, tools, maxTokens }) {
  if (provider === 'anthropic') return anthropicAdapter.chat({ apiKey, model, systemPrompt, messages, tools, maxTokens });
  if (provider === 'openai') return openaiCompatAdapter.chat({ apiKey, model, systemPrompt, messages, tools, maxTokens });
  if (provider === 'deepseek') return openaiCompatAdapter.chat({ apiKey, model, systemPrompt, messages, tools, maxTokens, baseURL: DEEPSEEK_BASE_URL });
  if (provider === 'gemini') return geminiAdapter.chat({ apiKey, model, systemPrompt, messages, tools, maxTokens });
  throw new Error(`Unknown AI provider: ${provider}`);
}

module.exports = { chat };
