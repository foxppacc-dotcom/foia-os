/**
 * AI-assisted triage classification for استقبال ذكي (Smart Intake).
 *
 * Sends the extracted/pasted case text to Claude and asks it to answer each
 * configured triage criterion (published on YouTube? witnesses? victims?...)
 * with true/false/null + a one-line reason, using forced tool-use so the
 * response is always valid structured JSON rather than free text we'd have
 * to parse and hope for the best.
 *
 * Deliberately never throws into the caller: an intake submission must
 * still succeed (case created, criteria left unanswered) if the API key
 * isn't configured yet, the API call fails, or Claude's response is
 * malformed -- the AI pass is an enhancement, not a requirement, matching
 * this codebase's existing "optional step never blocks the core action"
 * convention (e.g. Drive upload failures elsewhere never abort a case
 * creation).
 */
const MODEL = 'claude-haiku-4-5-20251001';

function blankAnswers(criteriaDefs) {
  return Object.fromEntries(criteriaDefs.map(c => [c.key, { value: null, source: null, reason: null }]));
}

async function classifyIntakeText(text, criteriaDefs) {
  const blank = blankAnswers(criteriaDefs);
  if (!text || !text.trim() || !criteriaDefs.length) return blank;
  if (!process.env.ANTHROPIC_API_KEY) return blank;

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const tool = {
      name: 'classify_case',
      description: 'Answer each triage criterion about this case submission based only on the text provided.',
      input_schema: {
        type: 'object',
        properties: {
          answers: {
            type: 'object',
            properties: Object.fromEntries(criteriaDefs.map(c => [c.key, {
              type: 'object',
              properties: {
                value: { type: ['boolean', 'null'], description: 'true, false, or null if the text genuinely gives no basis to decide' },
                reason: { type: 'string', description: 'One short sentence (Arabic) justifying the answer, quoting the relevant part of the text if possible' },
              },
              required: ['value', 'reason'],
            }])),
            required: criteriaDefs.map(c => c.key),
          },
        },
        required: ['answers'],
      },
    };

    const criteriaList = criteriaDefs.map(c => `- ${c.key}: ${c.label_ar}`).join('\n');
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'classify_case' },
      messages: [{
        role: 'user',
        content: `فيما يلي نص قضية/بلاغ وارد لنظام إدارة طلبات حرية المعلومات. أجب عن كل معيار من معايير الفرز التالية بناءً على النص فقط -- لا تخمّن إذا لم يوجد أساس واضح في النص، استخدم null بدلاً من ذلك.\n\nمعايير الفرز:\n${criteriaList}\n\nنص القضية:\n"""\n${text.slice(0, 8000)}\n"""`,
      }],
    });

    const toolUse = message.content.find(c => c.type === 'tool_use' && c.name === 'classify_case');
    if (!toolUse?.input?.answers) return blank;

    const result = { ...blank };
    for (const c of criteriaDefs) {
      const a = toolUse.input.answers[c.key];
      if (a && typeof a === 'object' && (typeof a.value === 'boolean' || a.value === null)) {
        result[c.key] = { value: a.value, source: a.value === null ? null : 'ai', reason: a.reason || null };
      }
    }
    return result;
  } catch (e) {
    console.error('[aiClassifier] classification failed, leaving criteria unanswered:', e.message);
    return blank;
  }
}

module.exports = { classifyIntakeText, blankAnswers };
