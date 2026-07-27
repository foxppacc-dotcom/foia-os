export function getStatusBadge(status) {
  if (status === 'sent') return { variant: 'info', text: '\u0645\u0631\u0633\u0644' };
  if (status === 'responded') return { variant: 'success', text: '\u062a\u0645 \u0627\u0644\u0631\u062f' };
  return { variant: 'warning', text: '\u0645\u0639\u0644\u0642' };
}

export function filterUnusedAgencies(allAgencies, requests) {
  return allAgencies.filter(a => !requests?.find(r => r.agency_id === a.id));
}

export function formatAgencyLocation(agency) {
  return [agency?.city, agency?.state].filter(Boolean).join(', ');
}
