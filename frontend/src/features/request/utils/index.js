export function getStatusBadge(status) {
  if (status === 'sent') return { variant: 'info', text: '\u0645\u0631\u0633\u0644' };
  if (status === 'responded') return { variant: 'success', text: '\u062a\u0645 \u0627\u0644\u0631\u062f' };
  return { variant: 'warning', text: '\u0645\u0639\u0644\u0642' };
}

// Per-request OUTCOME (what the agency actually did), distinct from
// getStatusBadge above (workflow: did we send it / did anything come back).
export const REPLY_OUTCOME_OPTIONS = [
  { value: 'pending', label: '\u0628\u0627\u0646\u062a\u0638\u0627\u0631 \u0627\u0644\u0631\u062f' },
  { value: 'records_received', label: '\u0633\u062c\u0644\u0627\u062a \u0648\u0627\u0631\u062f\u0629' },
  { value: 'no_records', label: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0633\u062c\u0644\u0627\u062a' },
  { value: 'rejected', label: '\u0645\u0631\u0641\u0648\u0636' },
  { value: 'payment_requested', label: '\u0637\u064f\u0644\u0628 \u062f\u0641\u0639' },
];

export function getReplyOutcomeBadge(outcome) {
  if (outcome === 'records_received') return { variant: 'success', text: '\u0633\u062c\u0644\u0627\u062a \u0648\u0627\u0631\u062f\u0629' };
  if (outcome === 'no_records') return { variant: 'neutral', text: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0633\u062c\u0644\u0627\u062a' };
  if (outcome === 'rejected') return { variant: 'danger', text: '\u0645\u0631\u0641\u0648\u0636' };
  if (outcome === 'payment_requested') return { variant: 'warning', text: '\u0637\u064f\u0644\u0628 \u062f\u0641\u0639' };
  return { variant: 'warning', text: '\u0628\u0627\u0646\u062a\u0638\u0627\u0631 \u0627\u0644\u0631\u062f' };
}

export function filterUnusedAgencies(allAgencies, requests) {
  return allAgencies.filter(a => !requests?.find(r => r.agency_id === a.id));
}

export function formatAgencyLocation(agency) {
  return [agency?.city, agency?.state].filter(Boolean).join(', ');
}
