/**
 * CaseAggregate — Canonical shape for the case dashboard response.
 *
 * Defines the contract between backend and frontend for what a "full case"
 * includes. Used by useCaseData to type-check and normalize responses.
 */

const CaseAggregateShape = {
  case: null,          // Case object
  team: [],            // TeamMember[]
  requests: [],        // Request[]
  checklist: [],       // ChecklistItem[]
  documents: [],       // Document[]
  timeline: [],        // TimelineEvent[]
  records_progress: { total: 7, received: 0 },
};

/**
 * Validate that a dashboard response has the expected shape.
 * Returns the data as-is (no mutation), just warns on missing keys.
 */
export function validateCaseAggregate(data) {
  if (!data) return null;
  const required = ['case', 'team', 'requests', 'checklist', 'documents', 'timeline'];
  for (const key of required) {
    if (!(key in data)) {
      console.warn(`[CaseAggregate] Missing key "${key}" in dashboard response`);
    }
  }
  return data;
}

/**
 * Normalize records_progress with defaults.
 */
export function normalizeRecordsProgress(records_progress) {
  return {
    total: records_progress?.total || 7,
    received: records_progress?.received || 0,
  };
}

/**
 * Create an empty aggregate (for loading/error states).
 */
export function emptyAggregate() {
  return {
    case: null,
    team: [],
    requests: [],
    checklist: [],
    documents: [],
    timeline: [],
    records_progress: { total: 7, received: 0 },
  };
}

export default CaseAggregateShape;
