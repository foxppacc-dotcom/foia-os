// FOIA OS v2 — Knowledge Notes
// Captures investigative knowledge within existing architecture.
// No new engines. Uses InformationRequirementEngine + existing fields.

export const KNOWLEDGE_TYPES = {
  finding: { ar: 'اكتشاف', en: 'Finding', icon: '💡' },
  observation: { ar: 'ملاحظة', en: 'Observation', icon: '👁️' },
  contradiction: { ar: 'تناقض', en: 'Contradiction', icon: '⚡' },
  quote: { ar: 'اقتباس', en: 'Quote', icon: '💬' },
  unresolved: { ar: 'سؤال مفتوح', en: 'Unresolved Question', icon: '❓' },
  verified: { ar: 'مؤكد', en: 'Verified', icon: '✅' },
};

export function createKnowledgeNote(type, content, context = {}) {
  return {
    id: `kn_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    type,
    content,
    source: context.source || null,
    documentId: context.documentId || null,
    evidenceItemId: context.evidenceItemId || null,
    investigatorId: context.investigatorId || null,
    investigatorName: context.investigatorName || 'System',
    createdAt: new Date().toISOString(),
    confidence: context.confidence || 'medium',
  };
}

// Structured storage format for IR notes field
// Uses existing `notes` field with JSON structure
export function encodeNotes(knowledgeNotes = [], unstructuredNote = '') {
  const parts = [];
  if (knowledgeNotes.length > 0) parts.push(JSON.stringify({ _knowledge: knowledgeNotes }));
  if (unstructuredNote) parts.push(unstructuredNote);
  return parts.join('\n\n---\n\n');
}

export function decodeNotes(notes = '') {
  if (!notes) return { knowledgeNotes: [], unstructured: '' };
  const match = notes.match(/^(\{.*?_knowledge:.*?\})\n\n---\n\n(.*)$/s);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      return { knowledgeNotes: parsed._knowledge || [], unstructured: match[2] || '' };
    } catch { /* fall through */ }
  }
  return { knowledgeNotes: [], unstructured: notes };
}

// Cross-reference computation from existing data
export function computeCrossReferences(requirements = [], documents = [], evidence = [], communications = []) {
  // Documents per IR
  const docsPerIR = {};
  (documents || []).forEach(doc => {
    if (doc.evidence_item_id) {
      const ir = (evidence || []).find(e => e.id === doc.evidence_item_id);
      if (ir) {
        const key = `ir_${ir.record_type}`;
        if (!docsPerIR[key]) docsPerIR[key] = [];
        docsPerIR[key].push(doc);
      }
    }
  });

  // Sources per IR
  const sourcesPerIR = {};
  (requirements || []).forEach(ir => {
    if (ir.sourceName) {
      if (!sourcesPerIR[ir.sourceName]) sourcesPerIR[ir.sourceName] = [];
      sourcesPerIR[ir.sourceName].push(ir);
    }
  });

  // Duplicate sources (same source, multiple IRs)
  const duplicateSources = Object.entries(sourcesPerIR)
    .filter(([, irs]) => irs.length > 1)
    .map(([source, irs]) => ({ source, requirementCount: irs.length, requirements: irs.map(i => i.question || i.record_type) }));

  // Documents supporting multiple IRs
  const crossDocs = Object.entries(docsPerIR)
    .filter(([, docs]) => docs.length > 1)
    .map(([irKey, docs]) => ({ irKey, docCount: docs.length }));

  return { docsPerIR, sourcesPerIR, duplicateSources, crossDocs };
}

// Knowledge Timeline from activity logs
export function buildKnowledgeTimeline(activities = []) {
  return activities
    .filter(a => a.type === 'evidence_stage_changed' || a.type === 'document_uploaded' || a.type === 'document_verified' || a.type === 'communication_received')
    .map(a => ({
      date: a.timestamp || a.created_at,
      type: a.type === 'evidence_stage_changed' ? 'knowledge' : 'activity',
      title: a.title || a.target_title,
      description: `${a.user_name || 'System'} · ${new Date(a.timestamp || a.created_at).toLocaleDateString('ar-SA')}`,
      source: a,
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}
