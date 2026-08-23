import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiBase, api } from '../api';

const tok = () => localStorage.getItem('foia_token');

// Shared chat-session logic between the global floating widget
// (AIAssistantWidget.jsx) and the full-page chat (pages/AIAssistantChat.jsx)
// -- same conversation semantics, same file-attach/ui_action handling,
// different surrounding UI (small draggable panel vs a roomy dedicated page).
export function useAIChat({ onReply } = {}) {
  const navigate = useNavigate();
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Every mount previously started a brand-new conversation with empty
  // history -- opening the widget on the phone after chatting on the
  // computer (same account) looked like the assistant "forgot" everything
  // instantly. Resume the user's own most recent conversation instead, same
  // way any other chat app persists a thread across devices/sessions.
  useEffect(() => {
    let cancelled = false;
    api.get('/ai/conversations').then(async (list) => {
      const latest = (list.data || [])[0];
      if (!latest || cancelled) return;
      const detail = await api.get(`/ai/conversations/${latest.id}`);
      if (cancelled) return;
      const restored = (detail.data || [])
        .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
        .map(m => ({ role: m.role, content: m.content }));
      if (restored.length) { setConversationId(latest.id); setMessages(restored); }
    }).catch(() => {}).finally(() => { if (!cancelled) setHistoryLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const send = async () => {
    if ((!input.trim() && !file) || sending) return;
    const userMsg = input.trim() || `📎 ${file?.name}`;
    setMessages(m => [...m, { role: 'user', content: userMsg }]);
    const fd = new FormData();
    fd.append('message', input.trim() || 'حلّل هذا الملف المرفق.');
    if (conversationId) fd.append('conversation_id', conversationId);
    if (file) fd.append('file', file);
    setInput(''); setFile(null); setSending(true);
    try {
      const res = await fetch(`${getApiBase()}/ai/chat`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok() }, body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'فشل الطلب');
      setConversationId(d.conversation_id);
      setMessages(m => [...m, { role: 'assistant', content: d.answer }]);
      onReply?.(d);
      if (d.ui_action?.type === 'navigate' && d.ui_action.url) navigate(d.ui_action.url);
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${e.message}` }]);
      onReply?.(null);
    }
    setSending(false);
  };

  // Resuming old history is usually right, but it can go stale: a
  // conversation that started before a new capability/tool was added keeps
  // the assistant's own earlier "I can't do that" answer in context, and it
  // tends to stay consistent with itself rather than reconsidering with the
  // CURRENT tool list -- confirmed live (a case-detail-navigation request
  // made right after that capability shipped still got the old refusal,
  // because the same resumed conversation had that refusal from minutes
  // earlier). Letting the user deliberately start fresh is the direct fix.
  const newConversation = () => { setConversationId(null); setMessages([]); };

  return { conversationId, messages, input, setInput, file, setFile, sending, send, historyLoaded, newConversation };
}
