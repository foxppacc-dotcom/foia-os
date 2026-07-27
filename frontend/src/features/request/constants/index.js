export const REQUEST_STATUS_LABELS = {
  draft: { ar: '\u0645\u0633\u0648\u062f\u0629', en: 'Draft', color: '#6B7280' },
  pending: { ar: '\u0645\u0639\u0644\u0642', en: 'Pending', color: '#F59E0B' },
  sent: { ar: '\u0645\u0631\u0633\u0644', en: 'Sent', color: '#3B82F6' },
  follow_up: { ar: '\u0645\u062a\u0627\u0628\u0639\u0629', en: 'Follow-up', color: '#8B5CF6' },
  responded: { ar: '\u062a\u0645 \u0627\u0644\u0631\u062f', en: 'Responded', color: '#10B981' },
  closed: { ar: '\u0645\u063a\u0644\u0642', en: 'Closed', color: '#6B7280' },
};

export const AGENCY_CLASSIFICATION_OPTIONS = [
  { value: 'investigation', ar: '\u062c\u0647\u0629 \u062a\u062d\u0642\u064a\u0642', en: 'Investigation Agency' },
  { value: 'arrest', ar: '\u062c\u0647\u0629 \u0642\u0628\u0636', en: 'Arrest Agency' },
  { value: 'both', ar: '\u062a\u062d\u0642\u064a\u0642 \u0648\u0642\u0628\u0636', en: 'Both' },
  { value: 'other', ar: '\u0623\u062e\u0631\u0649', en: 'Other' },
];

export const STATUS_BADGE_MAP = {
  sent: { variant: 'info', label: '\u0645\u0631\u0633\u0644' },
  responded: { variant: 'success', label: '\u062a\u0645 \u0627\u0644\u0631\u062f' },
  default: { variant: 'warning', label: '\u0645\u0639\u0644\u0642' },
};
