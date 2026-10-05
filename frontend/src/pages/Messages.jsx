import { useState, useEffect, useRef, useCallback } from 'react';
import { api, getCurrentUser } from '../api';
import { MessagesSquare, Send, Plus, X, Users as UsersIcon, Megaphone, Check, CheckCheck } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';
import { formatArabicTime, formatArabicDate, isSameDay, dayDividerLabel } from '../utils/formatDate';

const LIST_POLL_MS = 20_000;
const THREAD_POLL_MS = 6_000;
const PRESENCE_POLL_MS = 20_000;

// Conversation-LIST preview only (today = time, older = date) -- the
// in-thread message view below always shows the time and groups by day with
// its own divider instead, since inside one thread every message needs its
// own timestamp regardless of which day it's from.
function timeShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  return isToday ? formatArabicTime(dateStr) : formatArabicDate(dateStr);
}

const AVATAR_COLORS = ['#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#06B6D4', '#EC4899', '#84CC16'];
function avatarColor(name) {
  const s = name || '؟';
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
function Avatar({ name, online, size = 36 }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="w-full h-full rounded-full flex items-center justify-center font-bold text-white"
        style={{ background: avatarColor(name), fontSize: size * 0.4 }}>
        {name?.charAt(0)?.toUpperCase() || '؟'}
      </div>
      {online != null && (
        <span className="absolute bottom-0 left-0 rounded-full border-2"
          style={{
            width: size * 0.3, height: size * 0.3, borderColor: 'var(--bg-secondary)',
            background: online ? 'var(--success)' : 'var(--text-muted)',
          }} title={online ? 'متصل الآن' : 'غير متصل'} />
      )}
    </div>
  );
}

export default function Messages() {
  const toast = useToast();
  const me = getCurrentUser();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [presence, setPresence] = useState({});
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [canBroadcast, setCanBroadcast] = useState(false);
  const threadEndRef = useRef(null);
  const activeIdRef = useRef(null);
  activeIdRef.current = activeId;

  const fetchConversations = useCallback(() => {
    api.get('/conversations').then(d => setConversations(d.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchConversations();
    const t = setInterval(fetchConversations, LIST_POLL_MS);
    return () => clearInterval(t);
  }, [fetchConversations]);

  useEffect(() => {
    api.get('/users/list').then(d => setAllUsers((d.data || []).filter(u => u.id !== me?.id))).catch(() => {});
    api.get('/permissions/mine').then(d => setCanBroadcast(me?.role === 'admin' || !!d.permissions?.find(p => p.resource === 'internal_messages' && p.action === 'broadcast'))).catch(() => {});
  }, []);

  const fetchMessages = useCallback((id) => {
    if (!id) return;
    api.get(`/conversations/${id}/messages`).then(d => {
      if (activeIdRef.current !== id) return; // switched away before this resolved
      setMessages(d.data || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeId) return;
    fetchMessages(activeId);
    api.put(`/conversations/${activeId}/read`, {}).catch(() => {});
    const t = setInterval(() => fetchMessages(activeId), THREAD_POLL_MS);
    return () => clearInterval(t);
  }, [activeId, fetchMessages]);

  useEffect(() => { threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Online dots for every dm conversation's other participant + the "new
  // conversation" employee picker -- polled independently of the
  // conversation list itself (presence changes faster than last-message previews).
  useEffect(() => {
    const ids = allUsers.map(u => u.id);
    if (!ids.length) return;
    const load = () => api.get(`/conversations/presence?ids=${ids.join(',')}`).then(d => setPresence(d.data || {})).catch(() => {});
    load();
    const t = setInterval(load, PRESENCE_POLL_MS);
    return () => clearInterval(t);
  }, [allUsers]);

  const openConversation = (id) => {
    setActiveId(id);
    setConversations(prev => prev.map(c => c.id === id ? { ...c, unread_count: 0 } : c));
  };

  const send = async () => {
    if (!body.trim() || sending || !activeId) return;
    setSending(true);
    try {
      const d = await api.post(`/conversations/${activeId}/messages`, { content: body.trim() });
      setMessages(prev => [...prev, d.data]);
      setBody('');
      fetchConversations();
    } catch (e) { toast.error(e.message || 'فشل إرسال الرسالة'); }
    setSending(false);
  };

  const startConversation = async (type, participantIds, title) => {
    try {
      const d = await api.post('/conversations', { type, participant_ids: participantIds, title });
      setShowNew(false);
      await new Promise(r => setTimeout(r, 0));
      fetchConversations();
      openConversation(d.data.id);
    } catch (e) { toast.error(e.message || 'فشل إنشاء المحادثة'); }
  };

  const active = conversations.find(c => c.id === activeId);
  const totalUnread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);

  if (loading) return <Spinner full />;

  return (
    <div className="space-y-4 animate-fadeIn h-full flex flex-col">
      <PageHeader eyebrow="التواصل الداخلي" title="الرسائل الداخلية" meta={totalUnread > 0 ? `${totalUnread} غير مقروءة` : `${conversations.length} محادثة`}
        actions={<Button icon={Plus} onClick={() => setShowNew(true)}>محادثة جديدة</Button>} />

      <div className="flex-1 grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 min-h-0">
        {/* Conversation list */}
        <div className="rounded-2xl border overflow-y-auto" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
          {conversations.length === 0 ? (
            <EmptyState icon={MessagesSquare} title="لا توجد محادثات" description="ابدأ محادثة جديدة مع أحد الزملاء" />
          ) : conversations.map(c => (
            <button key={c.id} onClick={() => openConversation(c.id)}
              className="w-full flex items-center gap-2.5 p-3 text-start transition-colors border-b"
              style={{ borderColor: 'var(--border)', background: activeId === c.id ? 'var(--bg-tertiary)' : 'transparent' }}>
              {c.type === 'broadcast' ? (
                <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--bg-tertiary)' }}>
                  <Megaphone className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                </div>
              ) : c.type === 'group' ? (
                <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--bg-tertiary)' }}>
                  <UsersIcon className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                </div>
              ) : (
                <Avatar name={c.title} size={36} online={c.other_user_id != null ? !!presence[c.other_user_id] : null} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{c.title}</span>
                  <span className="text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>{timeShort(c.last_message_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{c.last_message || 'لا رسائل بعد'}</span>
                  {c.unread_count > 0 && (
                    <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5 shrink-0" style={{ background: 'var(--accent)', color: '#1A1A2E' }}>{c.unread_count}</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Thread */}
        <div className="rounded-2xl border flex flex-col min-h-0" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
          {!active ? (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState icon={MessagesSquare} title="اختر محادثة" description="أو ابدأ محادثة جديدة من الزر أعلاه" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 p-3 border-b" style={{ borderColor: 'var(--border)' }}>
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{active.title}</span>
                {active.type === 'broadcast' && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>بث عام</span>}
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {messages.map((m, i) => {
                  const mine = m.sender_id === me?.id;
                  // Same shared date-divider convention as the AI assistant's
                  // two chat surfaces (formatDate.js's isSameDay/dayDividerLabel)
                  // -- "اليوم"/"أمس" mean the same thing everywhere in the app.
                  const showDivider = m.created_at && (i === 0 || !isSameDay(messages[i - 1]?.created_at, m.created_at));
                  return (
                    <div key={m.id}>
                      {showDivider && (
                        <div className="flex items-center justify-center my-2">
                          <span className="text-[10px] px-2.5 py-1 rounded-full" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                            {dayDividerLabel(m.created_at)}
                          </span>
                        </div>
                      )}
                      <div className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
                        <div className="max-w-[75%] rounded-2xl px-3 py-2" style={{ background: mine ? 'var(--accent)' : 'var(--bg-tertiary)', color: mine ? '#1A1A2E' : 'var(--text-primary)' }}>
                          {!mine && active.type !== 'dm' && <div className="text-[10px] font-semibold mb-0.5 opacity-70">{m.sender_name || 'موظف'}</div>}
                          {m.via_ai && <div className="text-[10px] mb-0.5 opacity-70">🤖 عبر المساعد الذكي</div>}
                          <div className="text-xs whitespace-pre-wrap break-words">{m.content}</div>
                          <div className="flex items-center gap-1 justify-end mt-1">
                            <span className="text-[9px] opacity-60">{formatArabicTime(m.created_at)}</span>
                            {mine && active.type !== 'broadcast' && (
                              m.read_by_all
                                ? <CheckCheck className="w-3 h-3 opacity-80" />
                                : <Check className="w-3 h-3 opacity-60" />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={threadEndRef} />
              </div>
              {(active.type !== 'broadcast' || canBroadcast) && (
                <div className="flex items-center gap-2 p-3 border-t" style={{ borderColor: 'var(--border)' }}>
                  <input value={body} onChange={e => setBody(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder="اكتب رسالتك..." disabled={sending}
                    className="flex-1 px-3.5 py-2.5 rounded-xl border text-sm outline-none"
                    style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                  <Button icon={Send} onClick={send} disabled={sending || !body.trim()}>إرسال</Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showNew && (
        <NewConversationModal
          allUsers={allUsers} presence={presence} canBroadcast={canBroadcast}
          onClose={() => setShowNew(false)} onCreate={startConversation}
        />
      )}
    </div>
  );
}

function NewConversationModal({ allUsers, presence, canBroadcast, onClose, onCreate }) {
  const [type, setType] = useState('dm');
  const [selected, setSelected] = useState([]);
  const [title, setTitle] = useState('');
  const [search, setSearch] = useState('');

  const filtered = allUsers.filter(u => !search.trim() || u.name?.toLowerCase().includes(search.trim().toLowerCase()));
  const toggle = (id) => {
    if (type === 'dm') { setSelected([id]); return; }
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const canSubmit = type === 'broadcast' ? title.trim() : type === 'group' ? (title.trim() && selected.length > 0) : selected.length === 1;

  return (
    <Modal open onClose={onClose} title="محادثة جديدة" maxWidth="max-w-md">
      <div className="space-y-3">
        <div className="flex gap-2">
          {[{ v: 'dm', l: 'خاصة' }, { v: 'group', l: 'مجموعة' }, ...(canBroadcast ? [{ v: 'broadcast', l: 'بث عام' }] : [])].map(o => (
            <button key={o.v} onClick={() => { setType(o.v); setSelected([]); }}
              className="flex-1 py-2 rounded-lg text-xs font-medium transition-colors"
              style={{ background: type === o.v ? 'var(--accent)' : 'var(--bg-tertiary)', color: type === o.v ? '#1A1A2E' : 'var(--text-secondary)' }}>
              {o.l}
            </button>
          ))}
        </div>

        {(type === 'group' || type === 'broadcast') && (
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder={type === 'group' ? 'اسم المجموعة' : 'اسم قناة البث'} />
        )}

        {type !== 'broadcast' && (
          <>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث عن موظف..." />
            <div className="max-h-56 overflow-y-auto space-y-1 rounded-lg border p-1.5" style={{ borderColor: 'var(--border)' }}>
              {filtered.map(u => (
                <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer"
                  style={{ background: selected.includes(u.id) ? 'var(--bg-tertiary)' : 'transparent' }}>
                  <input type={type === 'dm' ? 'radio' : 'checkbox'} checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: presence[u.id] ? 'var(--success)' : 'var(--text-muted)' }} />
                  <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{u.name}</span>
                </label>
              ))}
              {filtered.length === 0 && <div className="text-xs text-center py-3" style={{ color: 'var(--text-muted)' }}>لا يوجد موظفون</div>}
            </div>
          </>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button disabled={!canSubmit} onClick={() => onCreate(type, selected, title)}>بدء المحادثة</Button>
        </div>
      </div>
    </Modal>
  );
}
