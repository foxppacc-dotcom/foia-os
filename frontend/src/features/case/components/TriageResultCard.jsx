import { useState, useEffect } from 'react';
import { useCaseContext } from '../context/CaseContext';
import { Sparkles, CheckCircle2, XCircle, HelpCircle, Bot } from 'lucide-react';
import { api } from '../../../api';

// Persistent "نتيجة الفرز" card -- the triage answers survive promotion out
// of استقبال ذكي and stay editable from the case itself forever (the
// user's explicit ask), reusing the same PUT endpoint the intake review
// screen uses. Only renders once the case actually HAS triage data --
// cases created directly (never went through intake) show nothing here.
export default function TriageResultCard() {
  const { id: caseId, c, refetch } = useCaseContext();
  const [criteria, setCriteria] = useState([]);
  const [answers, setAnswers] = useState(c?.intake_criteria || {});

  useEffect(() => { setAnswers(c?.intake_criteria || {}); }, [c?.intake_criteria]);
  useEffect(() => {
    api.get('/intake/criteria-definitions').then(d => setCriteria(d.data || [])).catch(() => {});
  }, []);

  const hasData = c?.intake_criteria && Object.keys(c.intake_criteria).length > 0;
  if (!hasData || !criteria.length) return null;

  const updateCriterion = async (key, value) => {
    const prev = answers;
    setAnswers(a => ({ ...a, [key]: { ...(a[key] || {}), value, source: 'human' } }));
    try {
      await api.put(`/intake/cases/${caseId}/criteria`, { criteria: { [key]: value } });
      refetch?.(true);
    } catch (e) {
      setAnswers(prev);
      alert('❌ ' + e.message);
    }
  };

  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--ds-bg-secondary)', borderColor: 'var(--ds-border)', boxShadow: 'var(--ds-shadow-sm)' }}>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4" style={{ color: 'var(--ds-accent)' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>نتيجة الفرز (استقبال ذكي)</h3>
      </div>
      <div className="space-y-1.5">
        {criteria.map(cr => {
          const a = answers[cr.key];
          const value = a?.value;
          const Icon = value === true ? CheckCircle2 : value === false ? XCircle : HelpCircle;
          const color = value === true ? 'var(--ds-success)' : value === false ? 'var(--ds-danger)' : 'var(--ds-text-muted)';
          return (
            <div key={cr.key} className="flex items-center justify-between gap-2 py-1.5" style={{ borderBottom: '1px solid var(--ds-border)' }}>
              <div className="flex items-center gap-1.5 min-w-0">
                <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
                <span className="text-xs truncate" style={{ color: 'var(--ds-text-secondary)' }}>{cr.label_ar}</span>
                {a?.source === 'ai' && <Bot className="w-3 h-3 shrink-0" style={{ color: 'var(--ds-accent)' }} title="اقتراح آلي" />}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {[{ v: true, l: 'نعم' }, { v: false, l: 'لا' }, { v: null, l: '؟' }].map(opt => (
                  <button key={String(opt.v)} onClick={() => updateCriterion(cr.key, opt.v)}
                    className="px-2 py-0.5 rounded-md text-[10px] font-medium"
                    style={{ background: value === opt.v ? 'var(--ds-accent)' : 'var(--ds-bg-tertiary)', color: value === opt.v ? 'white' : 'var(--ds-text-muted)' }}>
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
