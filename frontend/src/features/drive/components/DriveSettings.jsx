import { useState, useEffect } from 'react';
import { useDrive } from '../hooks/useDrive';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';

export default function DriveSettings() {
  const { connected, loading, error, connect, disconnect } = useDrive();
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    await connect();
    setConnecting(false);
  };

  if (loading) return <Spinner />;

  return (
    <div className="p-5 rounded-2xl border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
      <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Google Drive Integration</h3>
      {error && (
        <div className="p-3 rounded-xl mb-3 text-xs" style={{ background: 'var(--danger-subtle)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-3 h-3 rounded-full" style={{ background: connected ? 'var(--success)' : 'var(--text-muted)' }} />
        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
          {connected ? 'Google Drive متصل' : 'غير متصل بـ Google Drive'}
        </span>
      </div>
      {connected ? (
        <Button variant="danger" onClick={disconnect}>فصل Google Drive</Button>
      ) : (
        <Button onClick={handleConnect} disabled={connecting}>
          {connecting ? 'جاري الاتصال...' : 'الاتصال بـ Google Drive'}
        </Button>
      )}
    </div>
  );
}
