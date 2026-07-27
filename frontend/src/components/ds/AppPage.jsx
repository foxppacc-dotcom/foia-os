export default function AppPage({ children, maxWidth='1200px', className='' }) {
  return (
    <div className={className} style={{ maxWidth, margin: '0 auto' }}>
      {children}
    </div>
  );
}
