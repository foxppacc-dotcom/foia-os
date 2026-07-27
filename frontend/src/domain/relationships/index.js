/**
 * Domain Relationships — Metadata about entity relationships.
 *
 * Single source of truth for which entities relate to which,
 * and which modules own them.
 */

export const RELATIONSHIPS = {
  case: {
    owns: ['requests', 'documents', 'checklist', 'tasks', 'communications'],
    belongsTo: ['organization', 'user'],
    related: ['team', 'agencies', 'pipeline'],
  },
  request: {
    owns: [],
    belongsTo: ['case', 'agency', 'pipeline_list'],
    related: ['documents', 'communications'],
  },
  document: {
    owns: [],
    belongsTo: ['case', 'request', 'user'],
    related: ['document_category'],
  },
  user: {
    owns: ['cases', 'comments'],
    belongsTo: ['organization', 'department'],
    related: ['team', 'tasks'],
  },
  agency: {
    owns: ['contacts'],
    belongsTo: ['organization'],
    related: ['requests'],
  },
};

export function getRelatedModules(entityType) {
  const rel = RELATIONSHIPS[entityType];
  if (!rel) return [];
  return [...(rel.owns || []), ...(rel.belongsTo || []), ...(rel.related || [])];
}
