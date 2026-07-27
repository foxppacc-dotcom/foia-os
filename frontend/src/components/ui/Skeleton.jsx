export default function Skeleton({ className = 'h-4 w-full', rounded = 'rounded-lg' }) {
  return <div className={`skeleton ${rounded} ${className}`} />;
}
