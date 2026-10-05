import { useState, useEffect, useRef } from 'react';
import { Send, Paperclip, X, Mic, MessageSquarePlus, Volume2, VolumeX, Square, ListChecks, History } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import FoxBotIcon from '../components/icons/FoxBotIcon';
import VoiceSettingsPanel from '../components/VoiceSettingsPanel';
import AITasksPanel from '../components/AITasksPanel';
import { useAIChat } from '../hooks/useAIChat';
import { useActiveProviderStatus } from '../hooks/useActiveProviderStatus';
import { useToast } from '../components/ui/Toast';
import { isSameDay, dayDividerLabel, formatArabicTime, formatArabicDateTime } from '../utils/formatDate';

// The dedicated, full-page place to talk to the assistant -- separate from
// "الربط الذكي" (provider keys, capability toggles, knowledge center) and
// from the small floating widget (AIAssistantWidget.jsx), which shares this
// same useAIChat() hook so both surfaces stay behaviorally identical, just
// with a roomier layout here.
export default function AIAssistantChat() {
  const listRef = useRef(null);
  const fileInputRef = useRef(null);
  const historyRef = useRef(null);
  const toast = useToast();
  const [tab, setTab] = useState('chat'); // 'chat' | 'tasks'
  const [historyOpen, setHistoryOpen] = useState(false);

  const {
    conversationId, messages, input, setInput, file, setFile, sending, send, stopGenerating, newConversation, resolveDraft,
    conversations, fetchConversations, loadConversation,
    voiceMode, toggleVoiceMode, listening, toggleListening, canListen,
    voiceRate, setVoiceRate, voiceVolume, setVoiceVolume,
  } = useAIChat();
  const { hasActiveProvider, checkFailed, recheck } = useActiveProviderStatus();

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages]);
  useEffect(() => { if (!file && fileInputRef.current) fileInputRef.current.value = ''; }, [file]);

  // Close the "المحادثات السابقة" dropdown on an outside click -- same
  // convention as any other lightweight dropdown in this app (no portal
  // needed here: unlike VoiceSettingsPanel, this button sits OUTSIDE the
  // chat card's own overflow-hidden container, so nothing clips it).
  useEffect(() => {
    if (!historyOpen) return;
    const onClick = (e) => { if (historyRef.current && !historyRef.current.contains(e.target)) setHistoryOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [historyOpen]);

  const openHistory = () => { setHistoryOpen(o => !o); if (!historyOpen) fetchConversations(); };

  return (
    <div className="space-y-4 animate-fadeIn h-full flex flex-col">
      <PageHeader eyebrow="ذكاء اصطناعي" title="المساعد الذكي" meta="اسأل، اطلب تقارير، أو اطلب فتح وتصفية أقسام النظام مباشرة"
        actions={tab === 'chat' ? (
          <div className="flex items-center gap-1.5">
            <div className="relative" ref={historyRef}>
              <button onClick={openHistory} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                <History className="w-3.5 h-3.5" />المحادثات السابقة
              </button>
              {historyOpen && (
                <div className="absolute left-0 top-full mt-2 w-72 max-h-80 overflow-y-auto rounded-xl border shadow-lg z-20 p-1.5"
                  style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
                  {conversations.length === 0 ? (
                    <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>لا توجد محادثات سابقة</p>
                  ) : conversations.map(c => (
                    <button key={c.id} onClick={() => { loadConversation(c.id); setHistoryOpen(false); }}
                      className="w-full text-right px-3 py-2 rounded-lg text-xs"
                      style={{ background: c.id === conversationId ? 'var(--accent)' : 'transparent', color: c.id === conversationId ? 'white' : 'var(--text-primary)' }}>
                      <p className="truncate">{c.title || 'محادثة بلا عنوان'}</p>
                      <p className="text-[10px] mt-0.5 opacity-70">{formatArabicDateTime(c.created_at)}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={newConversation} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
              <MessageSquarePlus className="w-3.5 h-3.5" />محادثة جديدة
            </button>
          </div>
        ) : null} />

      {/* "المهام" -- كل تذكير طلبته من المساعد (aiTools.js's set_case_reminder)،
          منفصل عن المحادثة نفسها ولا يحتاج مزودًا مفعّلًا لعرضه. */}
      <div className="flex gap-1.5 shrink-0">
        <button onClick={() => setTab('chat')} className="px-3 py-1.5 rounded-xl text-xs font-medium"
          style={{ background: tab === 'chat' ? 'var(--accent)' : 'var(--bg-tertiary)', color: tab === 'chat' ? 'white' : 'var(--text-secondary)' }}>
          المحادثة
        </button>
        <button onClick={() => setTab('tasks')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium"
          style={{ background: tab === 'tasks' ? 'var(--accent)' : 'var(--bg-tertiary)', color: tab === 'tasks' ? 'white' : 'var(--text-secondary)' }}>
          <ListChecks className="w-3.5 h-3.5" />المهام
        </button>
      </div>

      {tab === 'tasks' ? (
        <div className="flex-1 flex flex-col rounded-2xl border overflow-hidden" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', minHeight: '60vh' }}>
          <AITasksPanel toast={toast} />
        </div>
      ) : checkFailed ? (
        <div className="text-sm p-4 rounded-2xl" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
          <p className="mb-2">⚠️ تعذر التحقق من حالة المساعد الذكي.</p>
          <button onClick={recheck} className="underline" style={{ color: 'var(--accent)' }}>إعادة المحاولة</button>
        </div>
      ) : hasActiveProvider === false ? (
        <p className="text-sm p-4 rounded-2xl" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
          لا يوجد مزود ذكاء اصطناعي مفعّل حاليًا. فعّل واحدًا من صفحة "الربط الذكي".
        </p>
      ) : (
        <div className="flex-1 flex flex-col rounded-2xl border overflow-hidden" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', minHeight: '60vh' }}>
          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 py-16">
                <FoxBotIcon className="w-12 h-12" style={{ color: 'var(--accent)' }} />
                <p className="text-sm text-center max-w-md" style={{ color: 'var(--text-muted)' }}>
                  اسألني عن قضايا الاستقبال الذكي، تقارير أداء الموظفين، القضايا ذات الردود غير المُطّلع عليها، الإيميلات غير المرتبطة، أو اطلب مني فتح وتصفية القضايا مباشرة.
                </p>
              </div>
            ) : messages.map((m, i) => {
              // Same date-divider convention as the floating widget and the
              // internal team-messaging page -- one shared helper (formatDate.js)
              // so "اليوم"/"أمس" mean the same thing everywhere in the app.
              const showDivider = m.created_at && (i === 0 || !isSameDay(messages[i - 1]?.created_at, m.created_at));
              return (
                <div key={i}>
                  {showDivider && (
                    <div className="flex items-center justify-center my-3">
                      <span className="text-[10px] px-2.5 py-1 rounded-full" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                        {dayDividerLabel(m.created_at)}
                      </span>
                    </div>
                  )}
                  {m.role === 'draft' && m.draft.kind === 'purge' ? (
                    <div className="flex justify-end">
                      <div className="max-w-[70%] px-4 py-2.5 rounded-2xl text-sm" style={{ background: 'var(--bg-tertiary)', border: '1px dashed #EF4444' }}>
                        <p className="mb-1" style={{ color: '#EF4444' }}>⚠️ طلب موافقة: حذف نهائي من سلة المحذوفات</p>
                        <p className="mb-1" style={{ color: 'var(--text-muted)' }}>{m.draft.entity_label} #{m.draft.id}</p>
                        <p className="whitespace-pre-wrap mb-2 font-medium" style={{ color: 'var(--text-primary)' }}>{m.draft.title || '(بدون عنوان)'}</p>
                        {!m.resolved ? (
                          <>
                            <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>لا يمكن التراجع عن هذا الإجراء، وتُمسح ملفات العنصر أيضًا.</p>
                            <div className="flex gap-2">
                              <button onClick={() => resolveDraft(i, 'send')} className="flex-1 py-1.5 rounded-lg text-xs font-medium" style={{ background: '#EF4444', color: 'white' }}>حذف نهائي</button>
                              <button onClick={() => resolveDraft(i, 'cancel')} className="flex-1 py-1.5 rounded-lg text-xs" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>إلغاء</button>
                            </div>
                          </>
                        ) : (
                          <p className="text-xs" style={{ color: m.resolved === 'cancel' ? 'var(--text-muted)' : '#EF4444' }}>
                            {m.resolved === 'cancel' ? '❌ تم الإلغاء -- لم يُحذف شيء' : '🗑️ تم الحذف النهائي'}
                          </p>
                        )}
                      </div>
                    </div>
                  ) : m.role === 'draft' ? (
                    <div className="flex justify-end">
                      <div className="max-w-[70%] px-4 py-2.5 rounded-2xl text-sm" style={{ background: 'var(--bg-tertiary)', border: '1px dashed var(--accent)' }}>
                        <p className="mb-1" style={{ color: 'var(--text-muted)' }}>📝 مسودة رسالة إلى <b style={{ color: 'var(--text-primary)' }}>{m.draft.recipient_name}</b>:</p>
                        <p className="whitespace-pre-wrap mb-2" style={{ color: 'var(--text-primary)' }}>{m.draft.content}</p>
                        {m.draft.scheduled && (
                          <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>الوقت المقترح للإرسال: {formatArabicDateTime(m.draft.send_at)}</p>
                        )}
                        {!m.resolved ? (
                          <div className="flex gap-2">
                            <button onClick={() => resolveDraft(i, 'send')} className="flex-1 py-1.5 rounded-lg text-xs font-medium" style={{ background: 'var(--accent)', color: 'white' }}>إرسال الآن</button>
                            {m.draft.scheduled && (
                              <button onClick={() => resolveDraft(i, 'schedule')} className="flex-1 py-1.5 rounded-lg text-xs font-medium" style={{ background: 'var(--success, #22c55e)', color: 'white' }}>جدولة</button>
                            )}
                            <button onClick={() => resolveDraft(i, 'cancel')} className="flex-1 py-1.5 rounded-lg text-xs" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>إلغاء</button>
                          </div>
                        ) : (
                          <p className="text-xs" style={{ color: m.resolved === 'cancel' ? 'var(--text-muted)' : 'var(--success)' }}>
                            {m.resolved === 'send' ? '✅ تم الإرسال' : m.resolved === 'schedule' ? `🕒 تم الجدولة على ${formatArabicDateTime(m.draft.send_at)}` : '❌ تم الإلغاء'}
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                      <div className="max-w-[70%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap" style={{
                        background: m.role === 'user' ? 'var(--accent)' : 'var(--bg-tertiary)',
                        color: m.role === 'user' ? 'white' : 'var(--text-primary)',
                      }}>
                        {m.content}
                        {m.created_at && <div className="text-[10px] mt-1 opacity-70">{formatArabicTime(m.created_at)}</div>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {sending && <div className="flex justify-end"><div className="px-4 py-2.5 rounded-2xl text-sm" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>...جارٍ التفكير</div></div>}
          </div>

          {file && (
            <div className="flex items-center justify-between gap-2 mx-4 mb-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--bg-tertiary)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>📎 {file.name}</span>
              <button onClick={() => setFile(null)}><X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /></button>
            </div>
          )}

          <div className="flex items-center gap-2 p-3 pt-0">
            <input ref={fileInputRef} type="file" hidden onChange={e => setFile(e.target.files?.[0] || null)} />
            <button onClick={() => fileInputRef.current?.click()} disabled={sending} className="p-2.5 rounded-xl shrink-0" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }} title="إرفاق ملف">
              <Paperclip className="w-4 h-4" />
            </button>
            {canListen && (
              <button onClick={toggleListening} disabled={sending} className="p-2.5 rounded-xl shrink-0" title="إدخال صوتي"
                style={{ background: listening ? '#ef4444' : 'var(--bg-tertiary)', color: listening ? 'white' : 'var(--text-muted)' }}>
                <Mic className="w-4 h-4" />
              </button>
            )}
            <button onClick={toggleVoiceMode} className="p-2.5 rounded-xl shrink-0" title={voiceMode ? 'إيقاف رد المساعد بالصوت' : 'تفعيل رد المساعد بالصوت'}
              style={{ background: voiceMode ? 'var(--accent)' : 'var(--bg-tertiary)', color: voiceMode ? 'white' : 'var(--text-muted)' }}>
              {voiceMode ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
            {voiceMode && (
              <VoiceSettingsPanel voiceRate={voiceRate} setVoiceRate={setVoiceRate} voiceVolume={voiceVolume} setVoiceVolume={setVoiceVolume} />
            )}
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="اكتب سؤالك..." disabled={sending}
              className="flex-1 min-w-0 px-4 py-2.5 rounded-xl text-sm" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            {sending ? (
              <button onClick={stopGenerating} title="إيقاف" className="p-2.5 rounded-xl shrink-0" style={{ background: '#ef4444', color: 'white' }}>
                <Square className="w-4 h-4" fill="currentColor" />
              </button>
            ) : (
              // send() takes an optional overrideText (used by voice input) --
              // onClick={send} would pass the click event itself as that
              // argument, so a click silently threw "event.trim is not a
              // function" while Enter (onKeyDown calls send() with no args)
              // kept working, masking this for anyone who mostly uses Enter.
              <button onClick={() => send()} disabled={!input.trim() && !file} className="p-2.5 rounded-xl shrink-0 disabled:opacity-40" style={{ background: 'var(--accent)', color: 'white' }}>
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
