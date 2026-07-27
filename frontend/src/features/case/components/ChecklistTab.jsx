import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Search, ChevronDown, ChevronUp, CheckCircle, Circle, MinusCircle, Clock, FileText, Building2, Mail, Activity, RotateCw, AlertCircle, Camera, Video, Mic, Phone, Car, Siren, ClipboardList } from 'lucide-react';
import { useCaseContext } from '../context/CaseContext';
import AppCard from '../../../components/ds/AppCard';
import AppBadge from '../../../components/ds/AppBadge';
import AppButton from '../../../components/ds/AppButton';
import AppStack from '../../../components/ds/AppStack';
import AppEmptyState from '../../../components/ds/AppEmptyState';
import { EvidenceStageBadge, EVIDENCE_STAGES, legacyToEvidenceStage, getEvidenceStageInfo } from './EvidenceStageBadge';

const INVESTIGATION_V2 = import.meta.env.VITE_INVESTIGATION_V2 === 'true' || localStorage.getItem('INVESTIGATION_V2') === 'true';

const INVESTIGATION_STATUSES = [
  { value: 'not_started', label: 'لم يبدأ', color: 'var(--ds-text-muted)' },
  { value: 'requested', label: 'تم الطلب', color: 'var(--ds-info)' },
  { value: 'waiting', label: 'بانتظار الرد', color: 'var(--ds-warning)' },
  { value: 'partially_received', label: 'استلمت جزئياً', color: 'var(--ds-accent)' },
  { value: 'completed', label: 'مكتمل', color: 'var(--ds-success)' },
  { value: 'rejected', label: 'مرفوض', color: 'var(--ds-danger)' },
  { value: 'not_applicable', label: 'غير مطبق', color: 'var(--ds-text-muted)' },
];

const recordMeta = {
  '911_calls': { label: 'مكالمات 911', icon: Phone },
  'emergency_calls': { label: 'مكالمات الطوارئ', icon: Siren },
  'cctv': { label: 'كاميرات المراقبة', icon: Camera },
  'body_cam': { label: 'كاميرات الجسد', icon: Video },
  'dash_cam': { label: 'كاميرات السيارات', icon: Car },
  'interrogation_video': { label: 'تسجيلات غرفة التحقيق', icon: Mic },
  'victim_statement': { label: 'التحقيق مع الضحية', icon: ClipboardList },
};

const itemIcons = { Phone, Siren, Camera, Video, Car, Mic, ClipboardList };

function getStatusFromItem(item) {
  if (INVESTIGATION_V2 && item.evidence_stage) {
    const info = getEvidenceStageInfo(item.evidence_stage);
    return { label: info.label, color: info.color, variant: info.value === 'rejected' ? 'danger' : info.value === 'verified' ? 'success' : info.value === 'received' ? 'accent' : info.value === 'waiting_review' ? 'warning' : info.value === 'requested' ? 'info' : 'neutral' };
  }
  if (item.status === 'completed' || item.status === 'received' || item.receipt_status === 'received') return INVESTIGATION_STATUSES[4];
  if (item.status === 'rejected' || item.status === 'will_not_receive' || item.receipt_status === 'will_not_receive' || item.doc_status === 'no_documents') return INVESTIGATION_STATUSES[5];
  if (item.status === 'waiting' || item.status === 'pending' || item.doc_status === 'pending' || item.status === 'awaiting_receipt' || item.receipt_status === 'awaiting_receipt') return INVESTIGATION_STATUSES[2];
  if (item.status === 'not_started' || item.doc_status === 'not_started') return INVESTIGATION_STATUSES[0];
  if (item.status === 'partially_received') return INVESTIGATION_STATUSES[3];
  if (item.status === 'not_applicable') return INVESTIGATION_STATUSES[6];
  if (item.status === 'requested') return INVESTIGATION_STATUSES[1];
  return INVESTIGATION_STATUSES[2];
}

function ChecklistCard({ item, onUpdate, onSaveNote, timeline, requests, expanded, onToggle }) {
  const meta = recordMeta[item.record_type];
  const status = getStatusFromItem(item);
  const Icon = itemIcons[item.record_type] || FileText;
  const [noteText, setNoteText] = useState(item.notes || '');
  const [saveState, setSaveState] = useState('idle');
  const [lastSaved, setLastSaved] = useState(null);
  const debounceRef = useRef(null);
  const textareaRef = useRef(null);
  const onUpdateRef = useRef(onUpdate);
  const onSaveNoteRef = useRef(onSaveNote);
  onUpdateRef.current = onUpdate; onSaveNoteRef.current = onSaveNote;

  const itemTimeline = (timeline || []).filter(t => t.target_type === 'checklist' && t.details?.record_type === item.record_type);

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(Math.max(el.scrollHeight, 40), 200) + 'px'; }
  }, []);

  const handleNoteChange = useCallback((e) => {
    const val = e.target.value; setNoteText(val); setSaveState('saving'); autoGrow();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try { await onSaveNoteRef.current(item.record_type, val); setSaveState('saved'); setLastSaved(new Date()); setTimeout(() => setSaveState('idle'), 2000); }
      catch { setSaveState('failed'); }
    }, 700);
  }, [item.record_type, autoGrow]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const doSave = useCallback(async (field, value) => {
    setSaveState('saving');
    try {
      if (INVESTIGATION_V2 && field === 'status') {
        const stageMap = { 'completed': 'received', 'received': 'received', 'requested': 'requested', 'waiting': 'waiting_review', 'pending': 'waiting_review', 'will_not_receive': 'rejected', 'not_started': 'identified', 'not_applicable': 'rejected', 'partially_received': 'received' };
        const evidenceStage = stageMap[value] || 'identified';
        await onUpdateRef.current(item.record_type, 'evidence_stage', evidenceStage, noteText);
      } else {
        await onUpdateRef.current(item.record_type, field, value, noteText);
      }
      setSaveState('saved'); setLastSaved(new Date()); setTimeout(() => setSaveState('idle'), 1500);
    }
    catch { setSaveState('failed'); }
  }, [item.record_type, noteText]);

  const attachedDocs = []; // No API - placeholder for future
  const relatedRequest = (requests || []).find(r => r.record_type === item.record_type || r.classification === item.record_type);

  return (
    <AppCard padding="14px" className="ds-transition-colors" 
      style={{ borderLeft: `3px solid ${status.color}` }}>
      {/* Collapsed header */}
      <div className="flex items-center gap-2.5 cursor-pointer" onClick={onToggle} role="button" tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && onToggle()} aria-label={meta?.label}>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: status.color + '15' }}>
          <Icon className="w-4 h-4" style={{ color: status.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>{meta?.label || item.record_type}</span>
            <AppBadge variant={status.value === 'completed' ? 'success' : status.value === 'rejected' ? 'danger' : status.value === 'waiting' ? 'warning' : 'neutral'}>
              {status.label}
            </AppBadge>
          </div>
          <div className="flex items-center gap-3 text-[11px] mt-0.5" style={{ color: 'var(--ds-text-muted)' }}>
            {relatedRequest && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{relatedRequest.agencies?.name_en || 'جهة'}</span>}
            {attachedDocs.length > 0 && <span>{attachedDocs.length} ملف</span>}
            {itemTimeline.length > 0 && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{item.updated_at?.substring(0, 10) || item.created_at?.substring(0, 10) || ''}</span>}
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 shrink-0" style={{ color: 'var(--ds-text-muted)' }} /> 
                 : <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--ds-text-muted)' }} />}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-3 pt-3 space-y-3" style={{ borderTop: '1px solid var(--ds-border)' }}>

          {/* Status panel */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-2 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)' }}>
              <p className="text-[10px] font-medium" style={{ color: 'var(--ds-text-muted)' }}>الحالة</p>
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-2 h-2 rounded-full" style={{ background: status.color }} />
                <span className="text-xs font-semibold" style={{ color: status.color }}>{status.label}</span>
              </div>
            </div>
            <div className="p-2 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)' }}>
              <p className="text-[10px] font-medium" style={{ color: 'var(--ds-text-muted)' }}>آخر تحديث</p>
              <p className="text-xs mt-1">{item.updated_at?.substring(0, 10) || '—'}</p>
            </div>
            <div className="p-2 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)' }}>
              <p className="text-[10px] font-medium" style={{ color: 'var(--ds-text-muted)' }}>الملفات</p>
              <p className="text-xs mt-1">{attachedDocs.length || '—'}</p>
            </div>
            <div className="p-2 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)' }}>
              <p className="text-[10px] font-medium" style={{ color: 'var(--ds-text-muted)' }}>النشاطات</p>
              <p className="text-xs mt-1">{itemTimeline.length}</p>
            </div>
          </div>

          {/* Unified status selector */}
          <div>
            <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--ds-text-muted)' }}>حالة التحقيق</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {INVESTIGATION_STATUSES.map(s => (
                <button key={s.value} onClick={() => doSave('status', s.value)}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ds-transition-colors ds-focus-ring"
                  style={{
                    background: item.status === s.value || item.receipt_status === s.value ? s.color + '20' : 'var(--ds-bg-tertiary)',
                    color: item.status === s.value || item.receipt_status === s.value ? s.color : 'var(--ds-text-muted)',
                    border: `1px solid ${item.status === s.value || item.receipt_status === s.value ? s.color : 'var(--ds-border)'}`,
                  }}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-medium" style={{ color: 'var(--ds-text-muted)' }}>ملاحظات التحقيق</p>
              <div className="flex items-center gap-2">
                {saveState === 'saving' && <span className="text-[10px]" style={{ color: 'var(--ds-accent)' }}>جاري الحفظ...</span>}
                {saveState === 'saved' && <span className="text-[10px]" style={{ color: 'var(--ds-success)' }}>تم الحفظ ✓</span>}
                {saveState === 'failed' && (
                  <button onClick={() => handleNoteChange({ target: { value: noteText } })} className="text-[10px] flex items-center gap-1" style={{ color: 'var(--ds-danger)' }}>
                    <RotateCw className="w-3 h-3" /> إعادة
                  </button>
                )}
                {lastSaved && <span className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>{lastSaved.toLocaleTimeString('ar-SA')}</span>}
                <span className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>{noteText.length}</span>
              </div>
            </div>
            <textarea ref={textareaRef} value={noteText} onChange={handleNoteChange} placeholder="أضف ملاحظات التحقيق هنا..." rows={2}
              className="w-full text-sm rounded-lg border resize-none overflow-hidden ds-focus-ring"
              style={{ background: 'var(--ds-bg-secondary)', borderColor: 'var(--ds-border-strong)', color: 'var(--ds-text-primary)', padding: '8px 10px', minHeight: '40px', lineHeight: '1.6' }}
              onInput={autoGrow} aria-label={`ملاحظات ${meta?.label}`} />
          </div>

          {/* Related agency */}
          {relatedRequest && (
            <div className="p-2.5 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)' }}>
              <div className="flex items-center gap-2">
                <Building2 className="w-3.5 h-3.5" style={{ color: 'var(--ds-accent)' }} />
                <span className="text-xs font-medium" style={{ color: 'var(--ds-text-primary)' }}>{relatedRequest.agencies?.name_en || 'جهة'}</span>
                <AppBadge variant={relatedRequest.status === 'sent' ? 'warning' : 'success'}>
                  {relatedRequest.status === 'sent' ? 'بانتظار الرد' : relatedRequest.status || '—'}
                </AppBadge>
              </div>
            </div>
          )}

          {/* Mini timeline */}
          {itemTimeline.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--ds-text-muted)' }}>النشاطات ({itemTimeline.length})</p>
              <div className="space-y-0.5 mr-2 border-r-2" style={{ borderColor: 'var(--ds-border)' }}>
                {itemTimeline.slice(0, 5).map(log => (
                  <div key={log.id} className="flex items-start gap-2 pr-3 pb-1.5 pt-0.5">
                    <div className="w-1.5 h-1.5 rounded-full mt-1.5 -mr-[4px] shrink-0" style={{ background: log.action_type === 'create' ? 'var(--ds-success)' : log.action_type === 'delete' ? 'var(--ds-danger)' : 'var(--ds-accent)' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px]" style={{ color: 'var(--ds-text-secondary)' }}>{log.action_type === 'create' ? 'تم الإنشاء' : log.action_type === 'update' ? 'تم التحديث' : log.action_type}</p>
                      <p className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>
                        {log.user_name || 'System'} · {log.created_at?.substring(5, 16) || ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            <AppButton size="sm" variant="secondary" icon={<FileText className="w-3 h-3" />}>ملاحظة</AppButton>
            <AppButton size="sm" variant="secondary" icon={<Mail className="w-3 h-3" />}>إعادة الطلب</AppButton>
            <AppButton size="sm" variant="secondary" icon={<Activity className="w-3 h-3" />}>الخط الزمني</AppButton>
          </div>
        </div>
      )}
    </AppCard>
  );
}

export default function ChecklistTab() {
  const { checklist, requests, timeline, updateChecklist, debouncedSaveNote } = useCaseContext();
  const [expandedItems, setExpandedItems] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('priority');

  const total = checklist?.length || 0;
  const completed = checklist?.filter(i => i.status === 'completed' || i.status === 'received' || i.receipt_status === 'received').length || 0;
  const waiting = checklist?.filter(i => !i.status || i.status === 'pending' || i.status === 'awaiting_receipt' || i.status === 'waiting' || i.receipt_status === 'awaiting_receipt' || i.status === 'not_started' || i.status === 'requested' || i.status === 'partially_received').length || 0;
  const rejected = checklist?.filter(i => i.status === 'rejected' || i.status === 'will_not_receive' || i.receipt_status === 'will_not_receive' || i.doc_status === 'no_documents' || i.status === 'not_applicable').length || 0;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const toggleItem = useCallback((id) => {
    setExpandedItems(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const filtered = useMemo(() => {
    let items = [...(checklist || [])];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i => {
        const meta = recordMeta[i.record_type];
        return (meta?.label || i.record_type).toLowerCase().includes(q) || (i.notes || '').toLowerCase().includes(q);
      });
    }
    if (statusFilter === 'completed') items = items.filter(i => i.status === 'completed' || i.status === 'received' || i.receipt_status === 'received');
    else if (statusFilter === 'waiting') items = items.filter(i => !i.status || i.status === 'pending' || i.status === 'awaiting_receipt' || i.status === 'waiting' || i.status === 'not_started' || i.status === 'requested' || i.status === 'partially_received');
    else if (statusFilter === 'missing') items = items.filter(i => i.status === 'rejected' || i.status === 'will_not_receive' || i.receipt_status === 'will_not_receive' || i.doc_status === 'no_documents');
    else if (statusFilter === 'high_priority') items = items.filter(i => i.priority === 'high' || i.priority === 'urgent');
    
    if (sortBy === 'priority') {
      const order = { completed: 0, not_applicable: 1, partially_received: 2, waiting: 3, pending: 4, not_started: 5 };
      items.sort((a, b) => (order[b.status || 'not_started'] || 5) - (order[a.status || 'not_started'] || 5));
    } else if (sortBy === 'alphabetical') {
      items.sort((a, b) => (recordMeta[a.record_type]?.label || '').localeCompare(recordMeta[b.record_type]?.label || ''));
    } else if (sortBy === 'recently_updated') {
      items.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    }
    return items;
  }, [checklist, searchQuery, statusFilter, sortBy]);

  const expandAll = useCallback(() => {
    const all = {};
    (checklist || []).forEach(i => { all[i.id] = true; });
    setExpandedItems(all);
  }, [checklist]);

  const collapseAll = useCallback(() => setExpandedItems({}), []);

  return (
    <div className="space-y-4 ds-animate-fadeIn">

      {/* Progress Dashboard */}
      <div className="p-4 rounded-xl" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4" style={{ color: 'var(--ds-accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>تقدم التحقيق</span>
          </div>
          <span className="text-xs font-bold" style={{ color: progressPct >= 80 ? 'var(--ds-success)' : progressPct >= 50 ? 'var(--ds-accent)' : 'var(--ds-warning)' }}>{progressPct}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden mb-3" style={{ background: 'var(--ds-bg-elevated)' }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: progressPct + '%', background: progressPct >= 80 ? 'var(--ds-success)' : progressPct >= 50 ? 'var(--ds-accent)' : 'var(--ds-warning)' }} />
        </div>
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3" style={{ color: 'var(--ds-success)' }} />{completed} مكتمل</span>
          <span className="flex items-center gap-1"><Circle className="w-3 h-3" style={{ color: 'var(--ds-warning)' }} />{waiting} بانتظار</span>
          <span className="flex items-center gap-1"><AlertCircle className="w-3 h-3" style={{ color: 'var(--ds-danger)' }} />{rejected} مرفوض</span>
        </div>
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
            <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ds-text-muted)' }} />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="بحث في السجلات..."
              className="w-full text-xs bg-transparent border-0 outline-none ds-focus-ring" style={{ color: 'var(--ds-text-primary)' }}
              aria-label="بحث في قائمة التدقيق" />
          </div>
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="p-2 rounded-lg border text-xs ds-focus-ring" style={{ background: 'var(--ds-bg-secondary)', borderColor: 'var(--ds-border-strong)', color: 'var(--ds-text-primary)' }}
          aria-label="تصفية حسب الحالة">
          <option value="all">جميع السجلات</option>
          <option value="completed">مكتمل</option>
          <option value="waiting">بانتظار</option>
          <option value="missing">مفقود</option>
          <option value="high_priority">أولوية عالية</option>
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          className="p-2 rounded-lg border text-xs ds-focus-ring" style={{ background: 'var(--ds-bg-secondary)', borderColor: 'var(--ds-border-strong)', color: 'var(--ds-text-primary)' }}
          aria-label="ترتيب حسب">
          <option value="priority">الأولوية</option>
          <option value="alphabetical">ترتيب أبجدي</option>
          <option value="recently_updated">آخر تحديث</option>
        </select>
        <AppButton size="sm" variant="secondary" onClick={expandAll}>فتح الكل</AppButton>
        <AppButton size="sm" variant="secondary" onClick={collapseAll}>إغلاق الكل</AppButton>
      </div>

      {/* Checklist Cards */}
      {filtered.length > 0 ? (
        <AppStack gap="8px">
          {filtered.map(item => (
            <ChecklistCard key={item.id} item={item} onUpdate={updateChecklist} onSaveNote={debouncedSaveNote}
              timeline={timeline} requests={requests} expanded={!!expandedItems[item.id]}
              onToggle={() => toggleItem(item.id)} />
          ))}
        </AppStack>
      ) : (
        <AppEmptyState icon={ClipboardList} title={searchQuery || statusFilter !== 'all' ? 'لا توجد نتائج للبحث' : 'لم يتم إعداد قائمة التدقيق'}
          description={searchQuery || statusFilter !== 'all' ? 'حاول تغيير معايير البحث أو التصفية' : 'أضف سجلات من لوحة الإعدادات'} />
      )}
    </div>
  );
}
