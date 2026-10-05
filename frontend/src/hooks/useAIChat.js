import { useState, useEffect, useRef } from 'react';
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
  // "لستة المحادثات" -- GET /api/ai/conversations already existed (used below
  // only to silently resume the latest thread on mount) but had no UI path
  // back to an OLDER conversation once the user started a new one via
  // newConversation() -- that just cleared local state, with no way to
  // return to what was cleared. Lazily fetched (only when the user actually
  // opens the list), not kept continuously in sync.
  const [conversations, setConversations] = useState([]);
  const fetchConversations = () => api.get('/ai/conversations').then(d => setConversations(d.data || [])).catch(() => {});

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
        .map(m => ({ role: m.role, content: m.content, created_at: m.created_at }));
      if (restored.length) { setConversationId(latest.id); setMessages(restored); }
    }).catch(() => {}).finally(() => { if (!cancelled) setHistoryLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // ---- Voice mode (Web Speech API -- browser-native, no new provider/cost) ----
  // Two independent halves: voiceMode controls whether an assistant reply
  // gets READ ALOUD (speechSynthesis); listening/toggleListening is the mic
  // input (speechRecognition), already existed per-surface (duplicated
  // identically in the widget and the full-page chat) but centralized here
  // now that it needs to auto-send too -- see toggleListening's own comment.
  const [voiceMode, setVoiceMode] = useState(() => { try { return localStorage.getItem('ai_voice_mode') === '1'; } catch { return false; } });
  const voiceModeRef = useRef(voiceMode);
  useEffect(() => {
    voiceModeRef.current = voiceMode;
    try { localStorage.setItem('ai_voice_mode', voiceMode ? '1' : '0'); } catch {}
    // Turning voice mode off mid-sentence shouldn't leave the assistant
    // still talking -- stop immediately rather than finishing the utterance.
    if (!voiceMode) { try { window.speechSynthesis?.cancel(); } catch {} stopAudio(); }
  }, [voiceMode]);

  // Picks the best-sounding installed Arabic voice instead of leaving it to
  // the browser's own default-for-this-lang pick, which is often the
  // lowest-quality one even when a much better Arabic voice (a "Natural"/
  // "Google"/"Microsoft ... Online" one, not a generic offline/compact
  // engine) is installed on the SAME device. getVoices() can return an empty
  // list on first call (loaded asynchronously) -- callers should call this
  // lazily (right before speaking), not cache the result at mount.
  // Voice objects expose no real gender field, only a free-text `name` --
  // these are the known male/female Arabic voice names across the engines
  // that actually ship one (Microsoft Hamed vs Zariyah/Salma on Windows/Edge,
  // Apple Maged/Tarik vs Laila on iOS/Safari). Requested explicitly: prefer
  // a male-named voice over everything else, including the quality signals
  // below -- those only decide the fallback when no voice is gender-labeled
  // at all (common on Android/Chrome, which usually ships one unlabeled
  // Arabic voice with no alternative to pick from).
  const MALE_VOICE_HINTS = /hamed|maged|majed|tarik|tariq|fahd/i;
  const FEMALE_VOICE_HINTS = /zariyah|zariah|salma|laila|layla|hoda|amira/i;
  const pickArabicVoice = () => {
    try {
      const voices = window.speechSynthesis.getVoices();
      const arabicVoices = voices.filter(v => v.lang?.toLowerCase().startsWith('ar'));
      if (!arabicVoices.length) return null;
      const score = (v) => {
        if (MALE_VOICE_HINTS.test(v.name)) return 3;
        if (FEMALE_VOICE_HINTS.test(v.name)) return -1;
        if (/natural|neural|online|google|premium|enhanced/i.test(v.name)) return 2;
        if (/microsoft/i.test(v.name)) return 1;
        return 0;
      };
      return arabicVoices.sort((a, b) => score(b) - score(a))[0];
    } catch { return null; }
  };

  // Real audio generated server-side by Piper (POST /ai/tts, self-hosted
  // neural TTS -- see the Dockerfile's own comment) -- sounds identical on
  // every device since it's just an audio FILE, unlike speechSynthesis
  // (browser fallback below) which depends entirely on whatever TTS engine,
  // if any, happens to be installed on that specific phone/OS.
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null); // the blob: URL backing audioRef.current, if any -- must be revoked exactly once
  const revokeAudioUrl = () => { if (audioUrlRef.current) { try { URL.revokeObjectURL(audioUrlRef.current); } catch {} audioUrlRef.current = null; } };
  // Previously only revoked the URL in `onended` -- every OTHER way a reply
  // stops (stopGenerating, toggling voice mode off, mic barge-in, a newer
  // reply interrupting an older one) called this function instead and left
  // the blob alive for the rest of the tab's life. Confirmed live: repeated
  // interruptions leak one blob-backed buffer each, indefinitely.
  const stopAudio = () => { try { audioRef.current?.pause(); } catch {} audioRef.current = null; revokeAudioUrl(); };
  const MAX_TTS_CHARS = 2000; // matches the backend's own cap
  // Guards against two overlapping playServerTTS calls racing (e.g. mic
  // barge-in immediately followed by a fresh reply, or toggling voice mode
  // on/off faster than the confirmation phrase's own fetch resolves) --
  // whichever call is NEWEST when its fetch resolves is the one allowed to
  // actually play; a call that's been superseded revokes its own blob
  // immediately instead of playing a stale/out-of-order reply.
  const ttsGenerationRef = useRef(0);
  const isMountedRef = useRef(true);

  // Adjustable from the chat UI's own "إعدادات الصوت" panel -- a personal,
  // per-browser preference (like voiceMode itself), not an org-wide setting,
  // so it lives here next to voiceMode rather than in the admin-only
  // "الربط الذكي" settings page. rate follows normal playback-speed
  // convention (1 = normal, >1 = faster) and is inverted server-side into
  // Piper's own --length-scale (which is the opposite: bigger = slower).
  const [voiceRate, setVoiceRate] = useState(() => { try { return parseFloat(localStorage.getItem('ai_voice_rate')) || 1; } catch { return 1; } });
  const [voiceVolume, setVoiceVolume] = useState(() => { try { const v = parseFloat(localStorage.getItem('ai_voice_volume')); return Number.isFinite(v) ? v : 1; } catch { return 1; } });
  const voiceRateRef = useRef(voiceRate);
  const voiceVolumeRef = useRef(voiceVolume);
  useEffect(() => { voiceRateRef.current = voiceRate; try { localStorage.setItem('ai_voice_rate', String(voiceRate)); } catch {} }, [voiceRate]);
  useEffect(() => { voiceVolumeRef.current = voiceVolume; try { localStorage.setItem('ai_voice_volume', String(voiceVolume)); } catch {} if (audioRef.current) audioRef.current.volume = voiceVolume; }, [voiceVolume]);

  const playServerTTS = async (text) => {
    const myGeneration = ++ttsGenerationRef.current;
    const res = await fetch(`${getApiBase()}/ai/tts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok() },
      body: JSON.stringify({ text: text.slice(0, MAX_TTS_CHARS), speed: voiceRateRef.current }),
    });
    if (!res.ok) throw new Error('tts failed');
    const blob = await res.blob();
    // A newer call (or an unmount, or voice mode being turned back off)
    // superseded this one while the fetch was in flight -- discard rather
    // than play an out-of-order/stale reply, and don't leak this blob either.
    if (myGeneration !== ttsGenerationRef.current || !isMountedRef.current || !voiceModeRef.current) {
      return; // no object URL was ever created for this blob -- nothing to revoke
    }
    const url = URL.createObjectURL(blob);
    stopAudio();
    try { window.speechSynthesis?.cancel(); } catch {} // never overlap with a leftover browser-voice fallback
    const audio = new Audio(url);
    audio.volume = voiceVolumeRef.current;
    audioRef.current = audio;
    audioUrlRef.current = url;
    audio.onended = () => { if (audioUrlRef.current === url) revokeAudioUrl(); audioRef.current = null; };
    await audio.play();
  };

  const speakBrowserFallback = (text) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel(); // never overlap two replies
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'ar-SA';
      const voice = pickArabicVoice();
      if (voice) utter.voice = voice;
      window.speechSynthesis.speak(utter);
    } catch {}
  };

  const speak = async (text) => {
    if (!voiceModeRef.current || !text) return;
    stopAudio();
    try { window.speechSynthesis?.cancel(); } catch {}
    try {
      await playServerTTS(text);
    } catch {
      // Server TTS unreachable/failed (offline, disabled, cold start...) --
      // stay silent-proof by falling back to the browser's own voice rather
      // than producing nothing.
      speakBrowserFallback(text);
    }
  };

  // Mobile Chrome/Safari only allow speechSynthesis.speak() to actually
  // produce sound when it's called SYNCHRONOUSLY inside a real user gesture
  // (a click handler) -- every other speak() call in this file happens after
  // an `await fetch(...)`, which by then no longer counts as "inside" the
  // gesture that triggered send(), so it silently does nothing on phones
  // (confirmed: this is exactly why voice replies "didn't work" on mobile
  // while looking fine on desktop Chrome/Edge, which don't enforce this).
  // Speaking one short utterance directly inside the toggle's own click
  // handler "unlocks" the API for the rest of the page session, and doubles
  // as immediate audible confirmation that voice mode is now on.
  // Some browsers only populate getVoices() after this event fires once
  // (it's an async voice-list load) -- calling it once up front here just
  // nudges that load to happen early, so it's already warm by the time
  // pickArabicVoice() actually needs it.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const warm = () => window.speechSynthesis.getVoices();
    warm();
    window.speechSynthesis.addEventListener('voiceschanged', warm);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', warm);
  }, []);

  const toggleVoiceMode = () => {
    const next = !voiceModeRef.current;
    setVoiceMode(next);
    if (!next) return;
    // Real <audio> playback (unlike speechSynthesis) doesn't need a strict
    // SYNCHRONOUS user gesture on most browsers -- a gesture ANYWHERE earlier
    // in the interaction (this very click) is enough to allow a later
    // programmatic play() after an await. Confirmed this was the actual
    // fix needed: previously this also spoke the confirmation via the
    // browser's OWN voice first as an "unlock", but that meant the user
    // heard two different voices back-to-back for one phrase -- Piper alone
    // is both necessary and sufficient here.
    const confirmPhrase = 'تم تفعيل الرد الصوتي';
    playServerTTS(confirmPhrase).catch(() => {
      // No silent failure -- if the confirmation couldn't be generated at
      // all (network hiccup, server TTS down), the user still gets SOME
      // audible confirmation that voice mode is on, same fallback speak()
      // itself uses for real replies.
      if (voiceModeRef.current) speakBrowserFallback(confirmPhrase);
    });
  };

  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const SpeechRecognitionCtor = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const toggleListening = () => {
    if (!SpeechRecognitionCtor) return;
    if (listening) { recognitionRef.current?.stop(); return; }
    // A reply mid-playback would otherwise keep talking over the user's next
    // question -- barge-in should cut it off the moment they start speaking.
    try { window.speechSynthesis?.cancel(); } catch {} stopAudio();
    const rec = new SpeechRecognitionCtor();
    rec.lang = 'ar-SA';
    rec.interimResults = false;
    // Auto-sends the recognized speech immediately instead of just filling
    // the input box -- a real back-and-forth ("talk to it, it answers back")
    // needs this, not a dictate-then-manually-press-send flow. The mic stays
    // easy to re-trigger (or stop mid-listen) if a word gets misheard.
    rec.onresult = (e) => { const transcript = e.results[0][0].transcript; setInput(transcript); send(transcript); };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };
  useEffect(() => () => recognitionRef.current?.stop(), []);

  // Lets the user cut a reply off mid-way -- either because they no longer
  // want an answer at all, or (per the user's own report) because a voice
  // reply sometimes plays only part of a long response and they'd rather
  // stop it than let it keep going/risk reading out something wrong. Aborts
  // the in-flight fetch (so the UI stops waiting immediately) and kills any
  // audio/speech already playing. Note: this only stops what the user sees
  // and hears -- the backend call already in flight still finishes server-side
  // (Express doesn't cancel the LLM call just because the client disconnected),
  // so the conversation history may still gain that reply once it lands.
  const abortControllerRef = useRef(null);
  const stopGenerating = () => {
    abortControllerRef.current?.abort();
    stopAudio();
    try { window.speechSynthesis?.cancel(); } catch {}
  };

  // AIAssistantWidget.jsx is mounted globally for the whole session, but
  // AIAssistantChat.jsx (the full-page surface) unmounts on route navigation
  // -- without this, sending a message, then navigating away before the
  // reply lands, still let the reply's audio start playing out loud on
  // whatever page the user had moved to (confirmed: no crash, just an
  // unexpected voice on an unrelated screen). Aborting here also means
  // speak() never runs at all for a reply nobody is present to see or hear.
  useEffect(() => () => {
    isMountedRef.current = false;
    abortControllerRef.current?.abort();
    stopAudio();
    try { window.speechSynthesis?.cancel(); } catch {}
  }, []);

  const send = async (overrideText) => {
    const text = overrideText !== undefined ? overrideText : input;
    if ((!text.trim() && !file) || sending) return;
    const userMsg = text.trim() || `📎 ${file?.name}`;
    setMessages(m => [...m, { role: 'user', content: userMsg, created_at: new Date().toISOString() }]);
    const fd = new FormData();
    fd.append('message', text.trim() || 'حلّل هذا الملف المرفق.');
    if (conversationId) fd.append('conversation_id', conversationId);
    if (file) fd.append('file', file);
    setInput(''); setFile(null); setSending(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const res = await fetch(`${getApiBase()}/ai/chat`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok() }, body: fd, signal: controller.signal });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'فشل الطلب');
      setConversationId(d.conversation_id);
      const next = [{ role: 'assistant', content: d.answer, created_at: new Date().toISOString() }];
      // The assistant never sends this itself (see draftMessageToEmployee's
      // own comment in aiTools.js) -- it only proposes a draft, rendered
      // here with explicit إرسال/إلغاء buttons the human must click.
      if (d.ui_action?.type === 'confirm_message') {
        next.push({ role: 'draft', created_at: new Date().toISOString(), draft: { recipient_id: d.ui_action.recipient_id, recipient_name: d.ui_action.recipient_name, content: d.ui_action.content, draft_token: d.ui_action.draft_token } });
      }
      // Same draft bubble, but a send_at was proposed -- adds a third
      // "جدولة" action (resolveDraft's own 'schedule' branch) that records
      // the send for later instead of sending now, still off a SINGLE human
      // click confirming the exact content/recipient/time up front.
      if (d.ui_action?.type === 'confirm_scheduled_message') {
        next.push({ role: 'draft', created_at: new Date().toISOString(), draft: { recipient_id: d.ui_action.recipient_id, recipient_name: d.ui_action.recipient_name, content: d.ui_action.content, send_at: d.ui_action.send_at, draft_token: d.ui_action.draft_token, scheduled: true } });
      }
      // Permanent delete from the trash: only a proposal -- explicit red confirm button below.
      if (d.ui_action?.type === 'confirm_purge') {
        next.push({ role: 'draft', created_at: new Date().toISOString(), draft: { kind: 'purge', entity_type: d.ui_action.entity_type, entity_label: d.ui_action.entity_label, id: d.ui_action.id, title: d.ui_action.title, draft_token: d.ui_action.draft_token } });
      }
      setMessages(m => [...m, ...next]);
      speak(d.answer);
      onReply?.(d);
      if (d.ui_action?.type === 'navigate' && d.ui_action.url) navigate(d.ui_action.url);
      // compose_email never sends anything itself (see composeEmail's own
      // comment in aiTools.js) -- it hands back a drafted to/subject/body,
      // stashed here for the case page's own composer to pick up and
      // pre-fill, so the human reviews it and clicks إرسال themselves.
      if (d.ui_action?.type === 'compose_email_draft') {
        try {
          sessionStorage.setItem(`ai_email_draft_${d.ui_action.case_id}`, JSON.stringify({
            to: d.ui_action.to || '', subject: d.ui_action.subject || '', body: d.ui_action.body || '',
          }));
        } catch {}
        navigate(`/cases/${d.ui_action.case_id}`);
      }
    } catch (e) {
      // A manual stop (stopGenerating -> controller.abort()) shouldn't be
      // reported as an error -- the user asked for exactly this.
      if (e.name !== 'AbortError') {
        setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${e.message}`, created_at: new Date().toISOString() }]);
        onReply?.(null);
      }
    }
    abortControllerRef.current = null;
    setSending(false);
  };

  // Confirms (or cancels) a pending draft rendered inline in `messages` at
  // `index`. Confirming actually creates/reuses a dm conversation and sends
  // the message as the CONFIRMING HUMAN (via_ai: true is only a transparency
  // marker, see migrations/043) -- never something the AI tool itself did.
  // `resolvingRef` guards against a scripted/rapid double-invocation of this
  // same index resolving twice (unlike normal UI clicking, which already
  // can't double-fire since the buttons unmount the instant `resolved` is
  // set) -- `send()` has an equivalent `sending` guard, this mirrors it.
  const resolvingRef = useRef(new Set());
  const resolveDraft = async (index, action) => {
    if (resolvingRef.current.has(index)) return;
    resolvingRef.current.add(index);
    setMessages(m => m.map((msg, i) => i === index ? { ...msg, resolved: action } : msg));
    if (action === 'cancel') { resolvingRef.current.delete(index); return; }
    const draft = messages[index]?.draft;
    if (!draft) { resolvingRef.current.delete(index); return; }
    try {
      if (draft.kind === 'purge') {
        // The human's explicit "حذف نهائي" click on a purge the assistant only PROPOSED.
        await api.post('/trash/ai-purge-confirm', { draft_token: draft.draft_token, entity_type: draft.entity_type, id: draft.id });
      } else if (action === 'schedule') {
        // Records the approved (recipient, content, time) triple -- the
        // per-minute cron (deadlineChecker.js's sendDueScheduledMessages)
        // does the actual send later; no DM conversation is created here.
        await api.post('/conversations/schedule-message', { recipient_id: draft.recipient_id, content: draft.content, send_at: draft.send_at, draft_token: draft.draft_token });
      } else {
        const conv = await api.post('/conversations', { type: 'dm', participant_ids: [draft.recipient_id] });
        await api.post(`/conversations/${conv.data.id}/messages`, { content: draft.content, via_ai: true, draft_token: draft.draft_token });
      }
    } catch (e) {
      const label = draft.kind === 'purge' ? 'الحذف النهائي' : action === 'schedule' ? 'جدولة' : 'إرسال';
      // The bubble was optimistically marked resolved ("✅ تم الإرسال") before the
      // request ran -- undo that on failure so it doesn't claim a send that never
      // happened, and the buttons come back for a retry.
      setMessages(m => [
        ...m.map((msg, i) => i === index ? { ...msg, resolved: undefined } : msg),
        { role: 'assistant', content: `⚠️ فشل ${label} الرسالة: ${e.message}`, created_at: new Date().toISOString() },
      ]);
    } finally {
      resolvingRef.current.delete(index);
    }
  };

  // Resuming old history is usually right, but it can go stale: a
  // conversation that started before a new capability/tool was added keeps
  // the assistant's own earlier "I can't do that" answer in context, and it
  // tends to stay consistent with itself rather than reconsidering with the
  // CURRENT tool list -- confirmed live (a case-detail-navigation request
  // made right after that capability shipped still got the old refusal,
  // because the same resumed conversation had that refusal from minutes
  // earlier). Letting the user deliberately start fresh is the direct fix.
  const newConversation = () => { resolvingRef.current.clear(); setConversationId(null); setMessages([]); };

  // Switches to a PAST conversation the user picked from the list -- same
  // interruption cleanup newConversation/unmount already do (stop any
  // in-flight request/audio) so switching mid-reply doesn't leave a stray
  // answer or voice playback from the conversation being left behind.
  const loadConversation = async (id) => {
    if (id === conversationId) return;
    resolvingRef.current.clear();
    abortControllerRef.current?.abort();
    stopAudio();
    try { window.speechSynthesis?.cancel(); } catch {}
    const detail = await api.get(`/ai/conversations/${id}`);
    const restored = (detail.data || [])
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
      .map(m => ({ role: m.role, content: m.content, created_at: m.created_at }));
    setConversationId(id);
    setMessages(restored);
  };

  return {
    conversationId, messages, input, setInput, file, setFile, sending, send, stopGenerating, historyLoaded, newConversation, resolveDraft,
    conversations, fetchConversations, loadConversation,
    voiceMode, toggleVoiceMode, listening, toggleListening, canListen: !!SpeechRecognitionCtor,
    voiceRate, setVoiceRate, voiceVolume, setVoiceVolume,
  };
}
