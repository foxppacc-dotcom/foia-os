import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Calendar, MapPin, Shield, Users, FileText, Building2, Activity, CheckCircle, UserPlus, Package, XCircle, ArrowUpCircle, Send, Upload, Eye, Trash2 } from 'lucide-react';
import { useCaseContext } from '../context/CaseContext';
import AppBadge from '../../../components/ds/AppBadge';
import { EvidenceStageBadge } from './EvidenceStageBadge';
import { getApiBase, getCurrentUser } from '../../../api';
const API = getApiBase();
import { memo, useState } from 'react';
import Button from '../../../components/ui/Button';
import Tabs from '../../../components/ui/Tabs';
const tok = () => localStorage.getItem('foia_token');
const hdrs = () => ({ 'Authorization': `Bearer ${tok()}`, 'Content-Type': 'application/json' });

const INVESTIGATION_V2 = import.meta.env.VITE_INVESTIGATION_V2 === 'true' || localStorage.getItem('INVESTIGATION_V2') === 'true';

const STAGE_LABELS = {
  planning: { label: 'تخطيط', variant: 'neutral' },
  research: { label: 'بحث أولي', variant: 'info' },
  requests: { label: 'إرسال الطلبات', variant: 'info' },
  waiting: { label: 'بانتظار الردود', variant: 'warning' },
  collection: { label: 'جمع الأدلة', variant: 'accent' },
  verification: { label: 'مراجعة الأدلة', variant: 'accent' },
  ready: { label: 'جاهز للإنتاج', variant: 'success' },
  archived: { label: 'مؤرشف', variant: 'neutral' },
};

export default memo(function CaseHeader() {
  const { id: caseId, c, requests, team, documents, checklist, refetch } = useCaseContext();
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const canDelete = currentUser?.role === 'admin' || currentUser?.role === 'manager';
  const pBadge = c.priority === 'high' ? 'warning' : c.priority === 'urgent' ? 'danger' : 'success';
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferTo, setTransferTo] = useState('');
  const [deleting, setDeleting] = useState(false);

  const stageInfo = INVESTIGATION_V2 && c.investigation_stage
    ? STAGE_LABELS[c.investigation_stage] || { label: c.investigation_stage, variant: 'neutral' }
    : { label: c.status === 'open' ? 'جمع المعلومات' : c.status === 'in_progress' ? 'تحليل الأدلة' : 'إكتمل', variant: 'neutral' };

  const received = checklist?.filter(i => i.receipt_status === 'received' || i.status === 'received').length || 0;
  const total = checklist?.length || 0;
  const pendingReqs = (requests || []).filter(r => r.status === 'sent' || !r.status).length;
  const docCount = documents?.length || 0;
  const teamCount = team?.length || 0;
  const blockedIRs = checklist?.filter(i => i.evidence_stage === 'blocked' || i.status === 'blocked').length || 0;
  const verificationsPending = checklist?.filter(i => i.evidence_stage === 'received' || i.evidence_stage === 'evidence_received').length || 0;

  const handleTransfer = async () => {
    if (!transferTo) return;
    await fetch(`${API}/cases/${caseId}/transfer`, { method: 'PUT', headers: hdrs(), body: JSON.stringify({ owner_id: parseInt(transferTo) }) });
    setTransferTo('');
    setShowTransfer(false);
    refetch?.();
  };

  const handleClose = async () => {
    if (!window.confirm(`هل تريد إغلاق القضية "${c.title}"؟`)) return;
    await fetch(`${API}/cases/${caseId}`, { method: 'PUT', headers: hdrs(), body: JSON.stringify({ status: 'closed' }) });
    refetch?.();
  };

  const handleDelete = async () => {
    if (!window.confirm(`⚠️ حذف نهائي — هل أنت متأكد من حذف القضية "${c.title}" بكل بياناتها (المستندات، المراسلات، الفريق)؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
    setDeleting(true);
    try {
      const r = await fetch(`${API}/cases/${caseId}`, { method: 'DELETE', headers: hdrs() });
      const d = await r.json();
      if (d.success !== false) navigate('/cases');
      else alert('❌ فشل حذف القضية: ' + (d.error || ''));
    } catch (e) {
      alert('❌ فشل حذف القضية: ' + e.message);
    }
    setDeleting(false);
  };

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
      {/* Top row: breadcrumb + actions */}
      <div className="flex items-center justify-between mb-3">
        <Link to="/cases" className="flex items-center gap-1 text-xs ds-transition-colors" style={{ color: 'var(--ds-text-muted)' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--ds-text-primary)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--ds-text-muted)'}>
          ← العودة للقضايا
        </Link>
        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" title="تعيين فريق"><UserPlus className="w-3.5 h-3.5" /></Button>
          <Button variant="ghost" size="sm" title="رفع ملف"><Upload className="w-3.5 h-3.5" /></Button>
          <Button variant="ghost" size="sm" title="توثيق"><Eye className="w-3.5 h-3.5" /></Button>
          <Button variant="ghost" size="sm" title="تجهيز الحزمة"><Package className="w-3.5 h-3.5" /></Button>
          <Button variant="ghost" size="sm" title="نقل الملكية" onClick={() => setShowTransfer(!showTransfer)}><ArrowUpCircle className="w-3.5 h-3.5" /></Button>
          <Button variant="ghost" size="sm" title="إغلاق القضية" onClick={handleClose} disabled={c.status === 'closed'}><XCircle className="w-3.5 h-3.5" style={{ color: '#ef4444' }} /></Button>
          {canDelete && (
            <Button variant="ghost" size="sm" title="حذف القضية نهائيًا" onClick={handleDelete} disabled={deleting}><Trash2 className="w-3.5 h-3.5" style={{ color: '#ef4444' }} /></Button>
          )}
        </div>
      </div>

      {/* Transfer inline */}
      {showTransfer && (
        <div className="flex items-center gap-2 mb-3 p-2 rounded-lg" style={{ background: 'var(--ds-bg-primary)', border: '1px dashed var(--ds-border)' }}>
          <select className="flex-1 px-2 py-1 rounded text-xs" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
            value={transferTo} onChange={e => setTransferTo(e.target.value)}>
            <option value="">نقل إلى...</option>
            {(team || []).filter(t => t.user_id !== c.owner_id).map(t => (
              <option key={t.user_id} value={t.user_id}>{t.user_name || t.name}</option>
            ))}
          </select>
          <Button variant="primary" size="sm" onClick={handleTransfer} disabled={!transferTo}>نقل</Button>
          <Button variant="ghost" size="sm" onClick={() => setShowTransfer(false)}>إلغاء</Button>
        </div>
      )}

      {/* Case info + KPIs */}
      <div className="flex flex-wrap items-start gap-4">
        {/* Title + badges */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-lg font-bold truncate" style={{ color: 'var(--ds-text-primary)' }}>{c.title}</h1>
            <AppBadge variant={stageInfo.variant}>{stageInfo.label}</AppBadge>
            <AppBadge variant={pBadge}>{c.priority === 'urgent' ? 'عاجل جدًا' : c.priority === 'high' ? 'عاجل' : c.priority === 'medium' ? 'متوسط' : 'عادي'}</AppBadge>
          </div>
          <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--ds-text-muted)' }}>
            <span>#{c.id}</span>
            {c.owner_name && <span className="flex items-center gap-1"><Users className="w-3 h-3" />{c.owner_name}</span>}
            <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{teamCount} أعضاء</span>
            <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{docCount} ملف</span>
            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(c.created_at).toLocaleDateString('ar-SA')}</span>
          </div>
        </div>

        {/* KPI row */}
        <div className="flex items-center gap-3 text-center">
          {[
            { label: 'السجلات', value: `${received}/${total}`, color: total > 0 && received === total ? '#22c55e' : '#eab308' },
            { label: 'طلبات', value: pendingReqs, color: pendingReqs > 0 ? '#eab308' : '#22c55e' },
            { label: 'توثيق', value: verificationsPending, color: verificationsPending > 0 ? '#8b5cf6' : '#22c55e' },
            { label: 'مسدود', value: blockedIRs, color: blockedIRs > 0 ? '#ef4444' : '#22c55e' },
          ].map(k => (
            <div key={k.label} className="min-w-[50px]">
              <div className="text-lg font-bold" style={{ color: k.color }}>{k.value}</div>
              <div className="text-[9px]" style={{ color: 'var(--ds-text-muted)' }}>{k.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
