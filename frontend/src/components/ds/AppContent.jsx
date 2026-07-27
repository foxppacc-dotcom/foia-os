export default function AppContent({ children, className='' }) {
  return (
    <div className={`space-y-6 ds-animate-fadeIn ${className}`}>
      {children}
    </div>
  );
}
