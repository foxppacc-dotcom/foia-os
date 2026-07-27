import IconChip from '../../../components/ui/IconChip';

export default function SectionCard({ title, icon: Icon, iconColor = 'var(--ds-accent)', actions, children }) {
  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--ds-bg-secondary)', borderColor: 'var(--ds-border)', boxShadow: 'var(--ds-shadow-sm)' }}>
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-2.5">
          {Icon && <IconChip icon={Icon} color={iconColor} size="sm" />}
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>{title}</h3>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
