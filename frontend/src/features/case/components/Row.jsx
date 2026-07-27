export default function Row({ children }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl mb-2 flex-wrap" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
      {children}
    </div>
  );
}
