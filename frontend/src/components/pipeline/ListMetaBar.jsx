import { LabelChip, MilestonePill } from './chips';

// Filter bar shown at the top of every list: label chips (multi-select, OR),
// milestone chips (single-select, plus "no milestone") and -- for roles with
// pipeline:manage_labels -- the button that opens the per-list manager.
export default function ListMetaBar({ labels, milestones, requests, filters, onFiltersChange, canManage, onManage }) {
  const labelCount = (id) => requests.filter(r => (r.labels || []).some(l => l.id === id)).length;
  const milestoneCount = (id) => requests.filter(r => r.milestone?.id === id).length;
  const noMilestoneCount = requests.filter(r => !r.milestone).length;
  const active = filters.labelIds.size > 0 || filters.milestone !== null;

  const toggleLabel = (id) => {
    const next = new Set(filters.labelIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onFiltersChange({ ...filters, labelIds: next });
  };
  const pickMilestone = (value) => onFiltersChange({ ...filters, milestone: filters.milestone === value ? null : value });

  const empty = labels.length === 0 && milestones.length === 0;

  return (
    <div className="rounded-xl border p-3 space-y-2.5" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>🏷️ Labels وMilestones</p>
        <div className="flex items-center gap-2">
          {active && (
            <button type="button" onClick={() => onFiltersChange({ labelIds: new Set(), milestone: null })}
              className="px-2.5 py-1 rounded-lg text-xs font-medium" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
              ✕ مسح الفلتر
            </button>
          )}
          {canManage && (
            <button type="button" onClick={onManage}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: 'var(--accent)', color: 'var(--text-inverse)' }}>
              ⚙️ إدارة Labels وMilestones
            </button>
          )}
        </div>
      </div>

      {empty ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {canManage ? 'لا توجد Labels أو Milestone لهذه القائمة بعد — اضغط "إدارة Labels وMilestones" لإنشائها.' : 'لا توجد Labels أو Milestone لهذه القائمة بعد.'}
        </p>
      ) : (
        <div className="space-y-2">
          {labels.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs w-14 shrink-0" style={{ color: 'var(--text-muted)' }}>Labels</span>
              {labels.map(l => (
                <LabelChip key={l.id} label={l} active={filters.labelIds.has(l.id)} count={labelCount(l.id)} onClick={() => toggleLabel(l.id)} />
              ))}
            </div>
          )}
          {milestones.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs w-14 shrink-0" style={{ color: 'var(--text-muted)' }}>Milestones</span>
              {milestones.map(m => (
                <MilestonePill key={m.id} milestone={m} active={filters.milestone === m.id} count={milestoneCount(m.id)} onClick={() => pickMilestone(m.id)} />
              ))}
              <button type="button" onClick={() => pickMilestone('none')}
                className="px-2.5 py-1 rounded-md text-xs font-semibold border"
                style={{
                  background: filters.milestone === 'none' ? 'var(--text-secondary)' : 'transparent',
                  color: filters.milestone === 'none' ? 'var(--bg-primary)' : 'var(--text-muted)',
                  borderColor: 'var(--border-strong, var(--border))',
                }}>
                بدون Milestone <span className="opacity-70 font-bold">{noMilestoneCount}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
