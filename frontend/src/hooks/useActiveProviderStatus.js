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
    // /ai/providers is admin-only (it lists full provider configs) -- a role
    // granted ai_assistant:use_chat but not admin got a 403 on every single
    // check here, making the chat feature that permission exists to grant
    // completely unreachable for them. /ai/status is gated by the SAME
    // use_chat permission /ai/chat itself uses, and returns only a boolean.
    api.get('/ai/status')
      .then(d => { setHasActiveProvider(!!d.hasActiveProvider); setCheckFailed(false); })
      .catch(() => setCheckFailed(true));
  }, []);

  useEffect(() => { check(); }, [check]);

  return { hasActiveProvider, checkFailed, recheck: check };
}
