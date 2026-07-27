import { useState, useMemo } from 'react';
import { useCaseContext } from '../context/CaseContext';
import { EvidenceStageBadge } from './EvidenceStageBadge';
import { KNOWLEDGE_TYPES, createKnowledgeNote, decodeNotes, computeCrossReferences, buildKnowledgeTimeline } from '../../domain/knowledge/knowledgeNotes';
import AppBadge from '../../../components/ds/AppBadge';
import AppButton from '../../../components/ds/AppButton';
import { Lightbulb, Eye, AlertTriangle, MessageSquare, HelpCircle, CheckCircle, FileText, Building2, Link2, Clock, TrendingUp } from 'lucide-react';

const INVESTIGATION_V2 = import.meta.env.VITE_INVESTIGATION_V2 === 'true' || localStorage.getItem('INVESTIGATION_V2') === 'true';

const TYPE_ICONS = {
  finding: Lightbulb,
  observation: Eye,
  contradiction: AlertTriangle,
  quote: MessageSquare,
  unresolved: HelpCircle,
  verified: CheckCircle,
};

const TYPE_COLORS = {
  finding: { bg: 'rgba(59,130,246,0.08)', border: '#3b82f6', text: '#3b82f6' },
  observation: { bg: 'rgba(139,92,246,0.08)', border: '#8b5cf6', text: '#8b5cf6' },
  contradiction: { bg: 'rgba(239,68,68,0.08)', border: '#ef4444', text: '#ef4444' },
  quote: { bg: 'rgba(34,197,94,0.08)', border: '#22c55e', text: '#22c55e' },
  unresolved: { bg: 'rgba(234,179,8,0.08)', border: '#eab308', text: '#eab308' },
  verified: { bg: 'rgba(34,197,94,0.08)', border: '#22c55e', text: '#22c55e' },
};

export default function KnowledgeWorkspace() {
  const { c, checklist, documents, timeline } = useCaseContext();
  const [activeTab, setActiveTab] = useState('notes');
  const [newNoteType, setNewNoteType] = useState('finding');
  const [newNoteContent, setNewNoteContent] = useState('');

  const knowledge = useMemo(() => {
    if (!INVESTIGATION_V2 || !checklist) return null;

    const items = (checklist || []).map(item => {
      const { knowledgeNotes, unstructured } = decodeNotes(item.notes || '');
      return { ...item, _knowledge: knowledgeNotes, _unstructured: unstructured };
    });

    const crossRef = computeCrossReferences(
      items,
      documents || [],
      checklist || [],
      []
    );

    const kTimeline = buildKnowledgeTimeline(timeline || []);

    return { items, crossRef, kTimeline };
  }, [checklist, documents, timeline]);

  if (!INVESTIGATION_V2 || !knowledge) {
    return <div className="p-4 text-center text-sm" style={{ color: 'var(--ds-text-muted)' }}>فعّل INVESTIGATION_V2 لاستخدام مساحة المعرفة</div>;
  }

  const allNotes = knowledge.items.flatMap(i => (i._knowledge || []).map(n => ({ ...n, recordType: i.record_type })));

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-2 border-b pb-2" style={{ borderColor: 'var(--ds-border)' }}>
        {[
          { key: 'notes', label: 'ملاحظات المعرفة', count: allNotes.length },
          { key: 'facts', label: 'الحقائق', count: knowledge.items.filter(i => i._knowledge?.length).length },
          { key: 'crossref', label: 'مراجع متقاطعة', count: knowledge.crossRef.duplicateSources.length },
          { key: 'timeline', label: 'خط زمني معرفي', count: knowledge.kTimeline.length },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className="text-[11px] px-3 py-1.5 rounded-lg font-medium ds-transition-colors"
            style={{ background: activeTab === t.key ? 'var(--ds-accent)' : 'transparent', color: activeTab === t.key ? 'white' : 'var(--ds-text-muted)' }}>
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {/* ── Knowledge Notes Tab ── */}
      {activeTab === 'notes' && (
        <div className="space-y-3">
          {/* Add note */}
          <div className="rounded-lg p-3" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
            <div className="flex items-center gap-2 mb-2">
              <select className="text-[11px] px-2 py-1 rounded" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
                value={newNoteType} onChange={e => setNewNoteType(e.target.value)}>
                {Object.entries(KNOWLEDGE_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>{v.icon} {v.ar}</option>
                ))}
              </select>
              <select className="text-[11px] px-2 py-1 rounded" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}>
                {knowledge.items.map(i => (
                  <option key={i.record_type} value={i.record_type}>{i.recordMeta?.label || i.record_type}</option>
                ))}
              </select>
            </div>
            <textarea className="w-full rounded-lg p-2 text-sm" rows={2} style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
              placeholder="أضف ملاحظة معرفية..."
              value={newNoteContent} onChange={e => setNewNoteContent(e.target.value)} />
            <div className="flex justify-end mt-1">
              <AppButton variant="primary" size="sm" onClick={() => { setNewNoteContent(''); }}>حفظ</AppButton>
            </div>
          </div>

          {/* Notes list */}
          {allNotes.length === 0 && (
            <div className="text-center py-8 text-sm" style={{ color: 'var(--ds-text-muted)' }}>
              <Lightbulb className="w-8 h-8 mx-auto mb-2" />
              لا توجد ملاحظات معرفية بعد. أضف ملاحظة لتوثيق ما تعلمته.
            </div>
          )}
          {allNotes.map((note, i) => {
            const info = KNOWLEDGE_TYPES[note.type] || KNOWLEDGE_TYPES.finding;
            const colors = TYPE_COLORS[note.type] || TYPE_COLORS.finding;
            const Icon = TYPE_ICONS[note.type] || Lightbulb;
            return (
              <div key={i} className="rounded-lg p-3 flex items-start gap-3" style={{ background: colors.bg, border: '1px solid var(--ds-border)', borderLeft: `3px solid ${colors.border}` }}>
                <Icon className="w-5 h-5 shrink-0 mt-0.5" style={{ color: colors.text }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: colors.border + '20', color: colors.text }}>{info.ar}</span>
                    <span className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>{note.recordType}</span>
                    {note.source && <span className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>{note.source}</span>}
                  </div>
                  <div className="text-sm" style={{ color: 'var(--ds-text-primary)' }}>{note.content}</div>
                  <div className="text-[10px] mt-1" style={{ color: 'var(--ds-text-muted)' }}>{note.investigatorName} · {new Date(note.createdAt).toLocaleDateString('ar-SA')}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Cross Reference Tab ── */}
      {activeTab === 'crossref' && (
        <div className="space-y-3">
          <div className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>المصادر المكررة</div>
          {knowledge.crossRef.duplicateSources.length === 0 ? (
            <div className="text-sm" style={{ color: 'var(--ds-text-muted)' }}>لا توجد مصادر مكررة</div>
          ) : (
            knowledge.crossRef.duplicateSources.map((ds, i) => (
              <div key={i} className="rounded-lg p-3 flex items-start gap-2" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
                <Building2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#eab308' }} />
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--ds-text-primary)' }}>{ds.source}</div>
                  <div className="text-[11px]" style={{ color: 'var(--ds-text-muted)' }}>{ds.requirementCount} متطلبات تشارك هذا المصدر</div>
                  <div className="text-[10px] mt-1" style={{ color: 'var(--ds-text-muted)' }}>{ds.requirements.join('، ')}</div>
                </div>
              </div>
            ))
          )}

          <div className="text-sm font-semibold mt-4" style={{ color: 'var(--ds-text-primary)' }}>المستندات الداعمة</div>
          {(documents || []).length === 0 ? (
            <div className="text-sm" style={{ color: 'var(--ds-text-muted)' }}>لا توجد مستندات</div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {(documents || []).slice(0, 6).map(doc => (
                <div key={doc.id} className="rounded-lg p-2 text-[11px]" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
                  <FileText className="w-4 h-4 mb-1" style={{ color: 'var(--ds-accent)' }} />
                  <div style={{ color: 'var(--ds-text-primary)' }}>{doc.file_name || doc.name || 'مستند'}</div>
                  {doc.evidence_item_id && <div className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>مرتبط بدليل</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Knowledge Timeline Tab ── */}
      {activeTab === 'timeline' && (
        <div className="space-y-2">
          {knowledge.kTimeline.length === 0 ? (
            <div className="text-center py-8 text-sm" style={{ color: 'var(--ds-text-muted)' }}>
              <Clock className="w-8 h-8 mx-auto mb-2" />
              لا توجد أحداث معرفية بعد
            </div>
          ) : (
            knowledge.kTimeline.slice(0, 20).map((event, i) => (
              <div key={i} className="rounded-lg p-2.5 flex items-start gap-2" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
                <TrendingUp className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--ds-accent)' }} />
                <div>
                  <div className="text-[11px]" style={{ color: 'var(--ds-text-primary)' }}>{event.title}</div>
                  <div className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>{event.description}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
