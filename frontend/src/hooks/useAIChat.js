import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiBase } from '../api';

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

  return { conversationId, messages, input, setInput, file, setFile, sending, send };
}
