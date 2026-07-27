export default function AppGrid({ cols=3, gap='16px', children, className='' }) {
  return (
    <div className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${cols === 1 ? '100%' : cols === 2 ? '300px' : cols === 3 ? '240px' : cols === 4 ? '200px' : '240px'}, 1fr))`,
        gap,
      }}>
      {children}
    </div>
  );
}
