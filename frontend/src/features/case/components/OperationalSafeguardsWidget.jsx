import { useMemo } from 'react';
import { useCaseContext } from '../context/CaseContext';
import { OperationalDecisionEngine } from '../../domain/engines/OperationalDecisionEngine';
import { EvidenceEngine } from '../../domain/engines/EvidenceEngine';
import { AgencyRequestEngine } from '../../domain/engines/AgencyRequestEngine';
import AppBadge from '../../../components/ds/AppBadge';
import AppButton from '../../../components/ds/AppButton';
import { Eye, Phone, Send, CheckCircle, XCircle, FileText, ArrowUpCircle, Clock, AlertTriangle, User, AlertCircle } from 'lucide-react';

const INVESTIGATION_V2 = import.meta.env.VITE_INVESTIGATION_V2 === 'true' || localStorage.getItem('INVESTIGATION_V2') === 'true';

function checkBeforeClose(requirements) {
  const critical = requirements.filter(r => r.priority === 'critical' && r.status !== 'satisfied');
  return critical.length > 0 ? { allowed: false, count: critical.length, items: critical.map(r => r.question) } : { allowed: true };
}

function checkBeforePackage(requirements) {
  const unverified = requirements.filter(r => r.status === 'evidence_received' || r.status === 'verifying');
  return unverified.length > 0 ? { allowed: false, count: unverified.length } : { allowed: true };
}

function checkOwnership(requirements) {
  const unowned = requirements.filter(r => r.status !== 'satisfied' && !r.assignedTo);
  return unowned.length > 0 ? { hasUnowned: true, count: unowned.length } : { hasUnowned: false };
}

export default function OperationalSafeguardsWidget() {
  const { c, checklist, requests } = useCaseContext();

  const safeguards = useMemo(() => {
    if (!INVESTIGATION_V2 || !checklist) return null;

    const items = checklist.map(item => ({
      id: `ir_${item.record_type}`,
      record_type: item.record_type,
      question: `الحصول على ${item.recordMeta?.label || item.record_type}`,
      priority: 'medium',
      status: item.evidence_stage === 'verified' ? 'satisfied'
            : item.evidence_stage === 'received' ? 'evidence_received'
            : item.evidence_stage === 'rejected' ? 'blocked'
            : item.evidence_stage || 'defined',
      assignedTo: item.assigned_to,
    }));

    return {
      beforeClose: checkBeforeClose(items),
      beforePackage: checkBeforePackage(items),
      ownership: checkOwnership(items),
      followUp: AgencyRequestEngine.calculateDaysWaiting(requests?.[0]?.created_at || new Date().toISOString()) > 14 ? { hasOverdue: true } : { hasOverdue: false },
    };
  }, [checklist, requests]);

  if (!INVESTIGATION_V2 || !safeguards) return null;

  const warnings = [];
  if (!safeguards.beforeClose.allowed) warnings.push({ icon: XCircle, text: `لا يمكن إغلاق التحقيق — ${safeguards.beforeClose.count} متطلبات حرجة`, color: '#ef4444' });
  if (!safeguards.beforePackage.allowed) warnings.push({ icon: AlertTriangle, text: `${safeguards.beforePackage.count} أدلة غير موثقة قبل الحزمة`, color: '#eab308' });
  if (safeguards.ownership.hasUnowned) warnings.push({ icon: User, text: `${safeguards.ownership.count} متطلبات بدون مالك`, color: '#3b82f6' });
  if (safeguards.followUp.hasOverdue) warnings.push({ icon: Clock, text: 'متابعة متأخرة — يحتاج انتباه', color: '#ef4444' });

  if (warnings.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {warnings.map((w, i) => (
        <div key={i} className="rounded-lg p-2.5 flex items-start gap-2" style={{ background: `${w.color}10`, border: `1px solid ${w.color}30` }}>
          <w.icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: w.color }} />
          <span className="text-[11px]" style={{ color: w.color }}>{w.text}</span>
        </div>
      ))}
    </div>
  );
}
