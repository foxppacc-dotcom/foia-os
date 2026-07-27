export default function StatCard({ icon: Icon, label, value, color = 'var(--accent)' }) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border p-4 transition-all duration-200 hover:-translate-y-0.5 group"
      style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-sm)' }}
    >
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        style={{ backgroundImage: `linear-gradient(135deg, ${color}12, transparent 60%)` }}
      />
      <div className="relative">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-3" style={{ background: `${color}18` }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
      </div>
    </div>
  );
}
