import { getApiBase } from '../../../api';
const API = getApiBase();
import { useState, useEffect, useMemo, useRef } from 'react';
import { Link2, Copy, Trash2, Mail, Loader2, CheckSquare, Send, Paperclip, X } from 'lucide-react';
import AppDialog from '../../../components/ds/AppDialog';
import Button from '../../../components/ui/Button';

const tok = () => localStorage.getItem('foia_token');
const hdrs = () => ({ 'Authorization': `Bearer ${tok()}`, 'Content-Type': 'application/json' });

const DEFAULT_SUBJECT = 'File Upload Request';
const DEFAULT_BODY = 'Hello,\n\nPlease use the link below to upload the requested files.\n\nThank you.';

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// FileFetch: a public, token-based upload link an external agency can use
// to drop files straight into this case's Drive folder with no login at
// all. Generated/managed here; the actual public-facing page lives at
// /upload/:token (PublicUpload.jsx), unauthenticated by design.
//
// requests/channels are passed from DocumentsTab's own case context so this
// modal can offer "send to this case's agency" without a separate fetch --
// requests already carry the full agency row (case_detail.routes.js's
// dashboard aggregate), channels carry a case-specific override email/
// portal/keywords per (case, agency) pair.
export default function FileFetchModal({ open, onClose, caseId, caseTitle, requests, channels }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [revokingId, setRevokingId] = useState(null);

  const [accounts, setAccounts] = useState([]);
  const [agencyId, setAgencyId] = useState('');
  const [emailForm, setEmailForm] = useState({ account_id: '', to: '', subject: DEFAULT_SUBJECT, body: DEFAULT_BODY });
  const [attachments, setAttachments] = useState([]);
  const fileInputRef = useRef(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  const caseAgencies = useMemo(() => {
    const byId = {};
    for (const r of requests || []) {
      const ag = r.agencies;
      if (!ag) continue;
      if (!byId[ag.id]) {
        const channel = (channels || []).find(c => c.agency_id === ag.id);
        byId[ag.id] = { id: ag.id, name: ag.name_ar || ag.name_en || `Agency #${ag.id}`, email: channel?.email || ag.email || '' };
      }
    }
    return Object.values(byId);
  }, [requests, channels]);

  useEffect(() => {
    setEmailForm(f => ({ ...f, subject: `${DEFAULT_SUBJECT}${caseTitle ? ' — Case: ' + caseTitle : ''}` }));
  }, [caseTitle]);

  const fetchLinks = () => {
    setLoading(true);
    fetch(`${API}/cases/${caseId}/upload-links`, { headers: hdrs() }).then(r => r.json())
      .then(d => setLinks(d.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    fetchLinks();
    fetch(`${API}/email-accounts`, { headers: hdrs() }).then(r => r.json())
      .then(d => setAccounts(Array.isArray(d) ? d : d.data || d.accounts || []))
      .catch(() => {});
  }, [open, caseId]);
  useEffect(() => { if (!attachments.length && fileInputRef.current) fileInputRef.current.value = ''; }, [attachments]);

  const activeLinks = links.filter(l => !l.revoked_at);

  const createLink = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const r = await fetch(`${API}/cases/${caseId}/upload-links`, { method: 'POST', headers: hdrs() });
      const d = await r.json();
      if (!r.ok) { alert('❌ ' + (d.error || 'فشل إنشاء الرابط')); return; }
      fetchLinks();
    } catch (e) { alert('❌ ' + e.message); }
    finally { setCreating(false); }
  };

  const revokeLink = async (linkId) => {
    if (revokingId || !confirm('إلغاء هذا الرابط؟ لن يعمل بعدها نهائيًا.')) return;
    setRevokingId(linkId);
    try {
      const r = await fetch(`${API}/cases/${caseId}/upload-links/${linkId}`, { method: 'DELETE', headers: hdrs() });
      const d = await r.json();
      if (!r.ok) { alert('❌ ' + (d.error || 'فشل الإلغاء')); return; }
      fetchLinks();
    } catch (e) { alert('❌ ' + e.message); }
    finally { setRevokingId(null); }
  };

  const copyUrl = async (link) => {
    try { await navigator.clipboard.writeText(link.url); setCopiedId(link.id); setTimeout(() => setCopiedId(null), 1500); }
    catch { window.prompt('انسخ الرابط:', link.url); }
  };

  const pickAgency = (id) => {
    setAgencyId(id);
    const ag = caseAgencies.find(a => String(a.id) === String(id));
    if (ag?.email) setEmailForm(f => ({ ...f, to: ag.email }));
  };

  const sendEmail = async () => {
    if (!emailForm.account_id || !emailForm.to.trim() || sending) return;
    setSending(true);
    setSendResult(null);
    try {
      // Reuse an existing active link if one exists, otherwise create one on
      // the spot -- the email needs a real URL to point at either way.
      let link = activeLinks[0];
      if (!link) {
        const r = await fetch(`${API}/cases/${caseId}/upload-links`, { method: 'POST', headers: hdrs() });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'فشل إنشاء الرابط');
        link = d.data;
        fetchLinks();
      }
      // The recipient's own written content, wrapped as HTML, with the
      // FileFetch button appended after it -- not a rigid fixed template,
      // so the sender can write whatever they actually need to say.
      const bodyHtml = escapeHtml(emailForm.body).replace(/\n/g, '<br/>');
      const html = `<p>${bodyHtml}</p>
<p style="margin:20px 0;">
  <a href="${link.url}" style="background:#2563eb;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;font-family:Arial,sans-serif;">FileFetch</a>
</p>`;
      const fd = new FormData();
      fd.append('to', emailForm.to.trim());
      fd.append('subject', emailForm.subject.trim() || DEFAULT_SUBJECT);
      fd.append('body', `${emailForm.body}\n\n${link.url}`);
      fd.append('html', html);
      fd.append('account_id', emailForm.account_id);
      attachments.forEach(f => fd.append('attachments', f));
      const r = await fetch(`${API}/cases/${caseId}/compose`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${tok()}` }, body: fd,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الإرسال');
      setSendResult({ ok: true, to: emailForm.to.trim() });
      setEmailForm(f => ({ ...f, to: '' }));
      setAttachments([]);
      setAgencyId('');
    } catch (e) {
      setSendResult({ ok: false, error: e.message });
    }
    setSending(false);
  };

  return (
    <AppDialog open={open} onClose={onClose} title="FileFetch — رابط رفع ملفات خارجي" width="620px">
      <div className="space-y-5">
        <p className="text-xs" style={{ color: 'var(--ds-text-muted)' }}>
          رابط يفتحه أي شخص خارج النظام (بدون تسجيل دخول) ليرفع ملفات مباشرة إلى مجلد هذه القضية على Drive. لا ينتهي صلاحيته إلا إذا ألغيته بنفسك.
        </p>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium" style={{ color: 'var(--ds-text-primary)' }}>الروابط النشطة</p>
            <Button size="sm" onClick={createLink} disabled={creating} loading={creating}>إنشاء رابط جديد</Button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center p-4"><Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--ds-accent)' }} /></div>
          ) : activeLinks.length === 0 ? (
            <p className="text-[11px] text-center py-3" style={{ color: 'var(--ds-text-muted)' }}>لا يوجد رابط نشط بعد</p>
          ) : (
            <div className="space-y-1.5">
              {activeLinks.map(link => (
                <div key={link.id} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)' }}>
                  <Link2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ds-accent)' }} />
                  <span className="flex-1 min-w-0 truncate text-[11px] font-mono" style={{ color: 'var(--ds-text-secondary)' }}>{link.url}</span>
                  <span className="text-[9px] shrink-0" style={{ color: 'var(--ds-text-muted)' }}>{link.upload_count || 0} رفع</span>
                  <button onClick={() => copyUrl(link)} className="p-1 rounded shrink-0" style={{ color: 'var(--ds-text-muted)' }} title="نسخ">
                    {copiedId === link.id ? <CheckSquare className="w-3.5 h-3.5" style={{ color: '#22c55e' }} /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => revokeLink(link.id)} disabled={revokingId === link.id} className="p-1 rounded shrink-0" style={{ color: '#ef4444' }} title="إلغاء">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-xs font-medium mb-2" style={{ color: 'var(--ds-text-primary)' }}>إرسال طلب رفع ملفات عبر الإيميل</p>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <select value={emailForm.account_id} onChange={e => setEmailForm(f => ({ ...f, account_id: e.target.value }))}
                className="px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}>
                <option value="">اختر حساب الإرسال...</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
              </select>
              {caseAgencies.length > 0 && (
                <select value={agencyId} onChange={e => pickAgency(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}>
                  <option value="">اختر جهة من القضية...</option>
                  {caseAgencies.map(a => <option key={a.id} value={a.id}>{a.name}{!a.email ? ' (لا يوجد إيميل مسجل)' : ''}</option>)}
                </select>
              )}
            </div>
            <input value={emailForm.to} onChange={e => setEmailForm(f => ({ ...f, to: e.target.value }))} placeholder="بريد المستلم" type="email"
              className="w-full px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
            <input value={emailForm.subject} onChange={e => setEmailForm(f => ({ ...f, subject: e.target.value }))} placeholder="Subject"
              dir="ltr" className="w-full px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
            <textarea value={emailForm.body} onChange={e => setEmailForm(f => ({ ...f, body: e.target.value }))} rows={5} placeholder="Message"
              dir="ltr" className="w-full px-2.5 py-1.5 rounded-lg text-xs resize-none" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
            <p className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>سيُضاف زر رفع الملفات (FileFetch) تلقائيًا في نهاية الرسالة.</p>

            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {attachments.map((f, i) => (
                  <span key={i} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-secondary)' }}>
                    {f.name}
                    <button onClick={() => setAttachments(prev => prev.filter((_, fi) => fi !== i))} style={{ color: 'var(--ds-text-muted)' }}><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1 text-[11px] cursor-pointer" style={{ color: 'var(--ds-accent)' }}>
                <Paperclip className="w-3.5 h-3.5" />إرفاق ملف
                <input ref={fileInputRef} type="file" multiple hidden onChange={e => { setAttachments(prev => [...prev, ...Array.from(e.target.files || [])]); e.target.value = ''; }} />
              </label>
              <Button size="sm" onClick={sendEmail} disabled={sending || !emailForm.account_id || !emailForm.to.trim()} loading={sending}>
                <Send className="w-3.5 h-3.5" />إرسال
              </Button>
            </div>
            {sendResult && (
              <p className="text-[11px]" style={{ color: sendResult.ok ? '#22c55e' : '#ef4444' }}>
                {sendResult.ok ? `✅ تم إرسال الرابط إلى ${sendResult.to}` : `❌ ${sendResult.error}`}
              </p>
            )}
          </div>
        </div>
      </div>
    </AppDialog>
  );
}
