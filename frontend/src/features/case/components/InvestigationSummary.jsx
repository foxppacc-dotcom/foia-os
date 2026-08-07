import { useState } from 'react';
import { User, Building2, Lightbulb, Link2, FileText as SummaryIcon, FileText, Users, Activity, Pencil, Check, X } from 'lucide-react';
import { useCaseContext } from '../context/CaseContext';
import { api } from '../../../api';
import AppStack from '../../../components/ds/AppStack';

function EditableField({ icon: Icon, label, value, onSave, placeholder, multiline, isLink }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [saving, setSaving] = useState(false);

  const startEdit = () => { setDraft(value || ''); setEditing(true); };
  const cancel = () => setEditing(false);
  const save = async () => {
    setSaving(true);
    try { await onSave(draft); setEditing(false); }
    catch (e) { alert('❌ ' + e.message); }
    setSaving(false);
  };

  if (editing) {
    const Field = multiline ? 'textarea' : 'input';
    return (
      <div className="flex items-start gap-2 text-xs">
        <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--ds-accent)' }} />
        <span className="font-medium shrink-0" style={{ color: 'var(--ds-text-muted)' }}>{label}:</span>
        <Field
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={placeholder}
          rows={multiline ? 3 : undefined}
          className="flex-1 px-2 py-1 rounded-lg text-xs resize-none"
          style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
          onKeyDown={e => { if (e.key === 'Enter' && !multiline) save(); if (e.key === 'Escape') cancel(); }}
        />
        <button onClick={save} disabled={saving} className="shrink-0" style={{ color: 'var(--ds-success)' }}><Check className="w-3.5 h-3.5" /></button>
        <button onClick={cancel} disabled={saving} className="shrink-0" style={{ color: 'var(--ds-text-muted)' }}><X className="w-3.5 h-3.5" /></button>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 text-xs group">
      <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--ds-accent)' }} />
      <span className="font-medium shrink-0" style={{ color: 'var(--ds-text-muted)' }}>{label}:</span>
      {value ? (
        isLink ? (
          <a href={value} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate" style={{ color: '#3b82f6' }}>{value}</a>
        ) : (
          <span className="flex-1 min-w-0" style={{ color: 'var(--ds-text-primary)', whiteSpace: multiline ? 'pre-wrap' : 'nowrap' }}>{value}</span>
        )
      ) : (
        <span className="flex-1" style={{ color: 'var(--ds-text-muted)' }}>—</span>
      )}
      <button onClick={startEdit} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--ds-text-muted)' }}>
        <Pencil className="w-3 h-3" />
      </button>
    </div>
  );
}

import { memo } from 'react';
export default memo(function InvestigationSummary() {
  const { id, c, team, documents, requests, checklist, timeline, refetch } = useCaseContext();
  const received = checklist?.filter(i => i.receipt_status === 'received' || i.status === 'received').length || 0;
  const pendingReqs = (requests || []).filter(r => r.status === 'sent' || !r.status).length;

  const saveField = (field) => async (value) => {
    await api.put(`/cases/${id}`, { [field]: value });
    refetch?.(true);
  };

  return (
    <div className="p-4 rounded-xl" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
      <div className="flex items-center gap-2 mb-3">
        <SummaryIcon className="w-4 h-4" style={{ color: 'var(--ds-accent)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>معلومات القضية</span>
      </div>
      <AppStack gap="8px">
        <p className="text-xs font-semibold" style={{ color: 'var(--ds-text-muted)' }}>معلومات تسجيل القضية</p>
        <EditableField icon={User} label="اسم المتهم" value={c.defendant_name} placeholder="اسم المتهم" onSave={saveField('defendant_name')} />
        <EditableField icon={Building2} label="اسم الوكالة" value={c.source_agency_name} placeholder="اسم الوكالة" onSave={saveField('source_agency_name')} />
        <EditableField icon={Lightbulb} label="الهوك" value={c.story_hook} placeholder="الهوك" onSave={saveField('story_hook')} />
        <EditableField icon={Link2} label="رابط المقال" value={c.article_url} placeholder="رابط المقال" isLink onSave={saveField('article_url')} />
        <EditableField icon={FileText} label="ملخص القضية" value={c.case_summary} placeholder="اكتب ملخص القضية هنا..." multiline onSave={saveField('case_summary')} />

        <div className="flex items-center gap-3 text-[11px] pt-1 flex-wrap">
          <span className="flex items-center gap-1"><FileText className="w-3 h-3" style={{ color: 'var(--ds-success)' }} />{(documents?.length||0)} ملف</span>
          <span className="flex items-center gap-1"><Building2 className="w-3 h-3" style={{ color: 'var(--ds-accent)' }} />{(requests?.length||0)} جهة</span>
          <span className="flex items-center gap-1"><Users className="w-3 h-3" style={{ color: 'var(--ds-info)' }} />{(team?.length||0)} فريق</span>
          <span className="flex items-center gap-1"><Activity className="w-3 h-3" style={{ color: 'var(--ds-warning)' }} />{(timeline?.length||0)} نشاط</span>
        </div>
        {received > 0 && <div className="text-xs" style={{ color: 'var(--ds-success)' }}>{received} سجل مكتمل</div>}
        {pendingReqs > 0 && <div className="text-xs" style={{ color: 'var(--ds-warning)' }}>{pendingReqs} جهة بانتظار الرد</div>}
      </AppStack>
    </div>
  )});
