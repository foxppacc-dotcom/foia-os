// Case status labels and configurations
export const STATUS_LABELS = {
  open: { ar: '\u0645\u0641\u062a\u0648\u062d\u0629', en: 'Open', color: '#3B82F6' },
  in_progress: { ar: '\u0642\u064a\u062f \u0627\u0644\u062a\u0646\u0641\u064a\u0630', en: 'In Progress', color: '#F59E0B' },
  closed: { ar: '\u0645\u063a\u0644\u0642\u0629', en: 'Closed', color: '#10B981' },
};

export const PRIORITY_MAP = {
  low: { ar: '\u0645\u0646\u062e\u0641\u0636', badge: 'info' },
  medium: { ar: '\u0645\u062a\u0648\u0633\u0637', badge: 'warning' },
  high: { ar: '\u0639\u0627\u0644\u064a\u0629', badge: 'warning' },
  urgent: { ar: '\u0639\u0627\u062c\u0644\u0629', badge: 'danger' },
};

export const STATUS_STYLES = {
  open: { variant: 'info', label: '\u0645\u0641\u062a\u0648\u062d\u0629' },
  in_progress: { variant: 'warning', label: '\u0642\u064a\u062f \u0627\u0644\u062a\u0646\u0641\u064a\u0630' },
  in_production: { variant: 'accent', label: '\u0641\u064a \u0627\u0644\u0625\u0646\u062a\u0627\u062c' },
  closed: { variant: 'success', label: '\u0645\u063a\u0644\u0642\u0629' },
};

export const ROLE_LABELS = {
  'mail_records_officer': '\u0645\u0633\u0624\u0648\u0644 \u0627\u0633\u062a\u0644\u0627\u0645 \u0627\u0644\u0633\u062c\u0644\u0627\u062a \u0628\u0627\u0644\u0628\u0631\u064a\u062f',
  'mail_payment_officer': '\u0645\u0633\u0624\u0648\u0644 \u0627\u0644\u062f\u0641\u0639 \u0628\u0627\u0644\u0628\u0631\u064a\u062f',
  'citizenship_officer': '\u0645\u0633\u0624\u0648\u0644 \u062a\u0623\u0643\u064a\u062f \u0627\u0644\u0645\u0648\u0627\u0637\u0646\u0629',
  'custom': '\u062f\u0648\u0631 \u0645\u062e\u0635\u0635'
};
export const ROLE_TYPES = ['mail_records_officer', 'mail_payment_officer', 'citizenship_officer', 'custom'];

export const RECORD_META = {
  '911_calls': { label: '\u0645\u0643\u0627\u0644\u0645\u0627\u062a 911', icon: 'Phone' },
  'emergency_calls': { label: '\u0645\u0643\u0627\u0644\u0645\u0627\u062a \u0627\u0644\u0637\u0648\u0627\u0631\u0626', icon: 'Siren' },
  'cctv': { label: '\u0643\u0627\u0645\u064a\u0631\u0627\u062a \u0627\u0644\u0645\u0631\u0627\u0642\u0628\u0629', icon: 'Camera' },
  'body_cam': { label: '\u0643\u0627\u0645\u064a\u0631\u0627\u062a \u0627\u0644\u062c\u0633\u062f', icon: 'Video' },
  'dash_cam': { label: '\u0643\u0627\u0645\u064a\u0631\u0627\u062a \u0627\u0644\u0633\u064a\u0627\u0631\u0627\u062a', icon: 'Car' },
  'interrogation_video': { label: '\u062a\u0633\u062c\u064a\u0644\u0627\u062a \u063a\u0631\u0641\u0629 \u0627\u0644\u062a\u062d\u0642\u064a\u0642', icon: 'Mic' },
  'victim_statement': { label: '\u0627\u0644\u062a\u062d\u0642\u064a\u0642 \u0645\u0639 \u0627\u0644\u0636\u062d\u064a\u0629', icon: 'ClipboardList' },
};

export const DOC_STATUS_GROUP = [
  { value: 'pending', label: '\u0642\u064a\u062f \u0627\u0644\u0627\u0646\u062a\u0638\u0627\u0631', color: '#F59E0B' },
  { value: 'documents_exist', label: '\u062a\u0648\u062c\u062f \u0648\u062b\u0627\u0626\u0642', color: '#3B82F6' },
  { value: 'no_documents', label: '\u0639\u062f\u0645 \u0648\u062c\u0648\u062f \u0648\u062b\u0627\u0626\u0642', color: '#EF4444' },
];

export const RECEIPT_STATUS_GROUP = [
  { value: 'awaiting_receipt', label: '\u0646\u0646\u062a\u0638\u0631 \u0627\u0633\u062a\u0644\u0627\u0645 \u0627\u0644\u0648\u062b\u0627\u0626\u0642', color: '#8B5CF6' },
  { value: 'will_not_receive', label: '\u0644\u0646 \u0646\u0633\u062a\u0644\u0645 \u0627\u0644\u0648\u062b\u0627\u0626\u0642', color: '#DC2626' },
  { value: 'received', label: '\u062a\u0645 \u0627\u0633\u062a\u0644\u0627\u0645 \u0627\u0644\u0648\u062b\u0627\u0626\u0642', color: '#10B981' },
];

export const TABS = [
  { key: 'overview', label: '\u0646\u0638\u0631\u0629 \u0639\u0627\u0645\u0629' },
  { key: 'team', label: '\u0627\u0644\u0641\u0631\u064a\u0642' },
  { key: 'agencies', label: '\u0627\u0644\u062c\u0647\u0627\u062a' },
  { key: 'checklist', label: '\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u062a\u062f\u0642\u064a\u0642' },
  { key: 'communications', label: '\u0627\u0644\u0627\u062a\u0635\u0627\u0644\u0627\u062a' },
  { key: 'documents', label: '\u0627\u0644\u0645\u0644\u0641\u0627\u062a' },
  { key: 'timeline', label: '\u0627\u0644\u062e\u0637 \u0627\u0644\u0632\u0645\u0646\u064a' },
];
