export default function AppStack({ gap='16px', children, className='' }) {
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap }}>
      {children}
    </div>
  );
}
