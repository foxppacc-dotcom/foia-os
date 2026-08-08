import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getApiBase } from '../api';
import { Mail, Reply, Forward, Download, Paperclip, ExternalLink, Loader2, X, Send } from 'lucide-react';

const BASE = getApiBase();
const tok = () => localStorage.getItem('foia_token');
const hdrs = () => ({ 'Authorization': `Bearer ${tok()}`, 'Content-Type': 'application/json' });
const authHdrs = () => ({ 'Authorization': `Bearer ${tok()}` });

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.toLocaleDateString('ar-SA')} ${d.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Standalone, self-contained page for one message -- meant to be opened in
// its own browser tab (window.open) from صندوق البريد or a case's
// الاتصالات tab, so a message can sit open on its own for review/copying/
// inspection alongside whatever else the reviewer has open, without losing
// their place in the main list. Reply/forward are available right here so
// opening the tab is a complete workflow, not just a read-only dead end.
export default function MessageView() {
  const { id } = useParams();
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState([]);

  const [showComposer, setShowComposer] = useState(false);
  const [composerMode, setComposerMode] = useState('reply'); // 'reply' | 'forward'
  const [composeForm, setComposeForm] = useState({ account_id: '', to: '', cc: '', subject: '', body: '' });
  const [composeFiles, setComposeFiles] = useState([]);
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState('');
  const [sendSuccess, setSendSuccess] = useState('');

  const fetchMessage = () => {
    setLoading(true);
    fetch(`${BASE}/communications/${id}`, { headers: hdrs() })
      .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'تعذر تحميل الرسالة'); return d.data; })
      .then(d => { setMsg(d); setError(''); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchMessage(); }, [id]);
  useEffect(() => {
    fetch(`${BASE}/email-accounts`, { headers: hdrs() }).then(r => r.json()).then(d => setAccounts(d.data || [])).catch(() => {});
  }, []);

  const openComposer = (mode) => {
    if (!msg) return;
    setComposerMode(mode);
    setComposeForm({
      account_id: msg.email_account_id ? String(msg.email_account_id) : '',
      to: mode === 'reply' ? msg.sender : '',
      cc: '',
      subject: `${mode === 'reply' ? 'Re' : 'Fwd'}: ${(msg.subject || '').replace(/^(Re|Fwd):\s*/i, '')}`,
      body: mode === 'forward'
        ? `\n\n---------- رسالة معاد توجيهها ----------\nمن: ${msg.sender || ''}\nبتاريخ: ${formatDateTime(msg.created_at)}\nالموضوع: ${msg.subject || ''}\n\n${msg.body || ''}`
        : '',
    });
    setComposeFiles([]);
    setComposeError('');
    setShowComposer(true);
  };

  const closeComposer = () => { setShowComposer(false); setComposeError(''); };

  const sendCompose = async () => {
    if (!composeForm.account_id || !composeForm.to || !composeForm.subject) return;
    setComposing(true); setComposeError('');
    try {
      const fd = new FormData();
      Object.entries(composeForm).forEach(([k, v]) => fd.append(k, v));
      if (composerMode === 'reply') fd.append('reply_to_id', msg.id);
      if (msg.case_id) fd.append('case_id', msg.case_id);
      composeFiles.forEach(f => fd.append('attachments', f));
      const r = await fetch(`${BASE}/inbox/compose`, { method: 'POST', headers: { Authorization: `Bearer ${tok()}` }, body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.success === false) { setComposeError(d.error || 'فشل الإرسال'); setComposing(false); return; }
      closeComposer();
      setSendSuccess('تم إرسال الرسالة بنجاح ✓');
      setTimeout(() => setSendSuccess(''), 4000);
    } catch (e) { setComposeError('خطأ: ' + (e.message || '')); }
    setComposing(false);
  };

  const download = async (index) => {
    const r = await fetch(`${BASE}/communications/${id}/attachments/${index}/download`, { headers: authHdrs() });
    const d = await r.json().catch(() => ({}));
    if (d.url) window.open(d.url, '_blank', 'noopener,noreferrer');
  };

  if (loading) return (
    <div className="flex items-center justify-center h-screen" style={{ background: 'var(--ds-bg-primary)' }}>
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--ds-accent)' }} />
    </div>
  );

  if (error || !msg) return (
    <div className="flex items-center justify-center h-screen p-6 text-center" style={{ background: 'var(--ds-bg-primary)' }}>
      <div>
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--ds-text-primary)' }}>تعذر فتح الرسالة</p>
        <p className="text-xs" style={{ color: 'var(--ds-text-muted)' }}>{error || 'الرسالة غير موجودة'}</p>
      </div>
    </div>
  );

  const attachments = msg.metadata?.attachments || [];

  return (
    <div className="min-h-screen p-4 md:p-8" style={{ background: 'var(--ds-bg-primary)' }} dir="rtl">
      <div className="max-w-3xl mx-auto space-y-4">
        {sendSuccess && (
          <div className="px-3 py-2 rounded-lg text-xs font-medium" style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}>
            {sendSuccess}
          </div>
        )}

        <div className="rounded-2xl p-5" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <Mail className="w-5 h-5 shrink-0" style={{ color: msg.direction === 'inbound' ? '#22c55e' : '#3b82f6' }} />
              <h1 className="text-base font-semibold truncate" style={{ color: 'var(--ds-text-primary)' }}>{msg.subject || '(بدون موضوع)'}</h1>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: msg.direction === 'inbound' ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.15)', color: msg.direction === 'inbound' ? '#22c55e' : '#3b82f6' }}>
                {msg.direction === 'inbound' ? 'وارد' : 'صادر'}
              </span>
              {msg.case_id && (
                <a href={`/cases/${msg.case_id}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(234,179,8,0.15)', color: '#eab308' }}>
                  <ExternalLink className="w-2.5 h-2.5" />قضية #{msg.case_id}
                </a>
              )}
            </div>
          </div>

          <div className="space-y-1 text-xs mb-4" style={{ color: 'var(--ds-text-secondary)' }}>
            <div><span style={{ color: 'var(--ds-text-muted)' }}>من: </span>{msg.sender || '—'}</div>
            <div><span style={{ color: 'var(--ds-text-muted)' }}>إلى: </span>{msg.recipient || '—'}</div>
            {msg.cc && <div><span style={{ color: 'var(--ds-text-muted)' }}>نسخة: </span>{msg.cc}</div>}
            <div><span style={{ color: 'var(--ds-text-muted)' }}>التاريخ: </span>{formatDateTime(msg.created_at)}</div>
          </div>

          {/* Full body -- plain selectable text, for copying/reviewing/inspecting */}
          <div className="rounded-lg p-3.5 text-sm leading-relaxed whitespace-pre-wrap select-text mb-3"
            style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-primary)' }}>
            {msg.body || '(لا يوجد محتوى)'}
          </div>

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {attachments.map((att, i) => (
                <span key={i} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-secondary)' }}>
                  <Paperclip className="w-3.5 h-3.5" />{att.filename}{att.size != null && ` (${formatSize(att.size)})`}
                  {(att.driveFileId || att.storageKey) ? (
                    <button onClick={() => download(i)} title="تحميل" style={{ color: 'var(--ds-accent)' }}><Download className="w-3.5 h-3.5" /></button>
                  ) : (
                    <span className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>(غير متاح للتحميل)</span>
                  )}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2" style={{ borderTop: '1px solid var(--ds-border)' }}>
            <button onClick={() => openComposer('reply')} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
              style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>
              <Reply className="w-3.5 h-3.5" />رد
            </button>
            <button onClick={() => openComposer('forward')} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
              style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-muted)' }}>
              <Forward className="w-3.5 h-3.5" />إعادة توجيه
            </button>
          </div>
        </div>

        {showComposer && (
          <div className="rounded-2xl p-5" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--ds-text-primary)' }}>{composerMode === 'reply' ? 'رد' : 'إعادة توجيه'}</h3>
              <button onClick={closeComposer} style={{ color: 'var(--ds-text-muted)' }}><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-2">
              <select value={composeForm.account_id} onChange={e => setComposeForm({ ...composeForm, account_id: e.target.value })}
                className="w-full px-2 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}>
                <option value="">اختر الحساب المرسل منه</option>
                {accounts.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.email} ({a.name})</option>)}
              </select>
              <input value={composeForm.to} onChange={e => setComposeForm({ ...composeForm, to: e.target.value })} placeholder="إلى..."
                className="w-full px-2 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
              <input value={composeForm.cc} onChange={e => setComposeForm({ ...composeForm, cc: e.target.value })} placeholder="CC (اختياري)"
                className="w-full px-2 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
              <input value={composeForm.subject} onChange={e => setComposeForm({ ...composeForm, subject: e.target.value })} placeholder="الموضوع"
                className="w-full px-2 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
              <textarea value={composeForm.body} onChange={e => setComposeForm({ ...composeForm, body: e.target.value })} placeholder="نص الرسالة..." rows={8}
                className="w-full px-2 py-1.5 rounded-lg text-xs resize-none" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />

              {composeFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {composeFiles.map((f, i) => (
                    <span key={i} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-secondary)' }}>
                      {f.name}
                      <button onClick={() => setComposeFiles(composeFiles.filter((_, fi) => fi !== i))} style={{ color: 'var(--ds-text-muted)' }}><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              )}
              <label className="flex items-center gap-1 text-[11px] cursor-pointer w-fit" style={{ color: 'var(--ds-accent)' }}>
                <Paperclip className="w-3.5 h-3.5" />مرفقات
                <input type="file" multiple hidden onChange={e => setComposeFiles([...composeFiles, ...Array.from(e.target.files || [])])} />
              </label>

              {composeError && <div className="text-[11px] p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{composeError}</div>}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={closeComposer} disabled={composing} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-muted)' }}>إلغاء</button>
                <button onClick={sendCompose} disabled={composing || !composeForm.account_id || !composeForm.to || !composeForm.subject}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg" style={{ background: 'var(--ds-accent)', color: 'white', opacity: composing ? 0.7 : 1 }}>
                  {composing ? 'جارٍ الإرسال...' : <><Send className="w-3.5 h-3.5" />إرسال</>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
