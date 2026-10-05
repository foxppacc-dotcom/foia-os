import { useState, useEffect } from 'react';
import { api } from '../../api';

// Pipeline-specific permission flags from /permissions/mine. Admin comes back
// as `wildcard`; everyone else needs an explicit granted row. Fails closed
// (all false) until loaded or if the request fails.
export default function usePipelinePerms() {
  const [perms, setPerms] = useState({ canManage: false, canTag: false, canReorder: false, loaded: false });
  useEffect(() => {
    let cancelled = false;
    api.get('/permissions/mine')
      .then(d => {
        if (cancelled) return;
        const has = (action) => !!(d.wildcard || (d.permissions || []).some(p => p.resource === 'pipeline' && p.action === action));
        setPerms({ canManage: has('manage_labels'), canTag: has('edit'), canReorder: has('reorder_lists'), loaded: true });
      })
      .catch(() => { if (!cancelled) setPerms({ canManage: false, canTag: false, canReorder: false, loaded: true }); });
    return () => { cancelled = true; };
  }, []);
  return perms;
}
