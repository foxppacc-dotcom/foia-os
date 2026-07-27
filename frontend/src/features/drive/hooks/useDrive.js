import { useState, useEffect, useCallback } from 'react';
import { getDriveStatus, getDriveAuthUrl, disconnectDrive } from '../services/driveApi';

export function useDrive() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const checkStatus = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await getDriveStatus();
      setConnected(d.connected === true);
    } catch (e) { setError(e.message); setConnected(false); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  const connect = useCallback(async () => {
    try {
      const d = await getDriveAuthUrl();
      if (d.url) {
        const popup = window.open(d.url, 'gdrive-auth', 'width=600,height=700');
        return new Promise((resolve) => {
          const handler = (e) => {
            if (e.data === 'gdrive_connected') { window.removeEventListener('message', handler); checkStatus(); resolve(true); }
          };
          window.addEventListener('message', handler);
          setTimeout(() => { window.removeEventListener('message', handler); resolve(false); }, 120000);
        });
      }
    } catch (e) { setError(e.message); return false; }
  }, [checkStatus]);

  const disconnect = useCallback(async () => {
    try { await disconnectDrive(); setConnected(false); }
    catch (e) { setError(e.message); }
  }, []);

  return { connected, loading, error, connect, disconnect, checkStatus };
}
