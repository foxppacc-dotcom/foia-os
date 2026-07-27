import { memo } from 'react';

const EVIDENCE_STAGES = [
  { value: 'identified', label: 'تم التحديد', icon: '🔍', color: 'var(--ds-text-muted)', bgColor: 'var(--ds-bg-secondary)' },
  { value: 'requested', label: 'تم الطلب', icon: '📨', color: 'var(--ds-info)', bgColor: 'rgba(59,130,246,0.12)' },
  { value: 'waiting_review', label: 'بانتظار المراجعة', icon: '⏳', color: 'var(--ds-warning)', bgColor: 'rgba(234,179,8,0.12)' },
  { value: 'received', label: 'تم الاستلام', icon: '📦', color: 'var(--ds-accent)', bgColor: 'rgba(139,92,246,0.12)' },
  { value: 'verified', label: 'موثق', icon: '✅', color: 'var(--ds-success)', bgColor: 'rgba(34,197,94,0.12)' },
  { value: 'rejected', label: 'مرفوض', icon: '❌', color: 'var(--ds-danger)', bgColor: 'rgba(239,68,68,0.12)' },
];

const STAGE_MAP = Object.fromEntries(EVIDENCE_STAGES.map(s => [s.value, s]));

// Map old status → evidence_stage for backward compat
export function legacyToEvidenceStage(item) {
  if (item.evidence_stage) return item.evidence_stage;
  if (item.status === 'completed' || item.status === 'received' || item.receipt_status === 'received') return 'received';
  if (item.status === 'will_not_receive' || item.receipt_status === 'will_not_receive' || item.doc_status === 'no_documents') return 'rejected';
  if (item.status === 'pending' || item.receipt_status === 'awaiting_receipt' || item.status === 'awaiting_receipt') return 'waiting_review';
  if (item.status === 'requested') return 'requested';
  if (item.status === 'not_started') return 'identified';
  return 'identified';
}

export function getEvidenceStageInfo(stage) {
  return STAGE_MAP[stage] || EVIDENCE_STAGES[0];
}

export function EvidenceStageBadge({ stage, size = 'sm' }) {
  const info = getEvidenceStageInfo(stage);
  const padding = size === 'sm' ? '3px 8px' : '5px 12px';
  const fontSize = size === 'sm' ? '10px' : '12px';
  return (
    <span className="inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap ds-transition-colors"
      style={{ padding, fontSize, background: info.bgColor, color: info.color, border: '1px solid ' + info.color + '33' }}>
      <span style={{ fontSize: fontSize }}>{info.icon}</span>
      <span>{info.label}</span>
    </span>
  );
}

export { EVIDENCE_STAGES };
export default memo(EvidenceStageBadge);
