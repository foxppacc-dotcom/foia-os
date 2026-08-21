import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

// Shared between AIAssistantWidget.jsx and AIAssistantChat.jsx -- kept in
// one place after the widget's own fail-open fix (assuming `true` on a
// failed check, so a network hiccup silently rendered the full chat UI even
// with no way to tell) wasn't propagated to the full-page chat, which still
// had the old buggy version. One hook now, so a future fix can't diverge
// between the two surfaces again.
export function useActiveProviderStatus() {
  const [hasActiveProvider, setHasActiveProvider] = useState(null);
  const [checkFailed, setCheckFailed] = useState(false);

  const check = useCallback(() => {
    api.get('/ai/providers')
      .then(d => { setHasActiveProvider((d.data || []).some(p => p.is_active)); setCheckFailed(false); })
      .catch(() => setCheckFailed(true));
  }, []);

  useEffect(() => { check(); }, [check]);

  return { hasActiveProvider, checkFailed, recheck: check };
}
