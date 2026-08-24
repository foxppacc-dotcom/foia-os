import { getApiBase } from '../../../api';
const API = getApiBase();
import { useState, useEffect } from 'react';
import { Link2, Copy, Trash2, Mail, Loader2, CheckSquare, Send } from 'lucide-react';
import AppDialog from '../../../components/ds/AppDialog';
import Button from '../../../components/ui/Button';

const tok = () => localStorage.getItem('foia_token');
const hdrs = () => ({ 'Authorization': `Bearer ${tok()}`, 'Content-Type': 'application/json' });

// FileFetch: a public, token-based upload link an external agency can use
// to drop files straight into this case's Drive folder with no login at
// all. Generated/managed here; the actual public-facing page lives at
// /upload/:token (PublicUpload.jsx), unauthenticated by design.
export default function FileFetchModal({ open, onClose, caseId, caseTitle }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [revokingId, setRevokingId] = useState(null);

  const [accounts, setAccounts] = useState([]);
  const [emailForm, setEmailForm] = useState({ account_id: '', to: '' });
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

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
      const html = `<p>Upload the files to our drive.</p>
<p style="margin:20px 0;">
  <a href="${link.url}" style="background:#2563eb;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;font-family:Arial,sans-serif;">FileFetch</a>
</p>`;
      const fd = new FormData();
      fd.append('to', emailForm.to.trim());
      fd.append('subject', `طلب رفع ملفات${caseTitle ? ' — قضية ' + caseTitle : ''}`);
      fd.append('body', `Upload the files to our drive.\n${link.url}`);
      fd.append('html', html);
      fd.append('account_id', emailForm.account_id);
      const r = await fetch(`${API}/cases/${caseId}/compose`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${tok()}` }, body: fd,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الإرسال');
      setSendResult({ ok: true, to: emailForm.to.trim() });
      setEmailForm(f => ({ ...f, to: '' }));
    } catch (e) {
      setSendResult({ ok: false, error: e.message });
    }
    setSending(false);
  };

  return (
    <AppDialog open={open} onClose={onClose} title="FileFetch — رابط رفع ملفات خارجي" width="560px">
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
          <p className="text-xs font-medium mb-2" style={{ color: 'var(--ds-text-primary)' }}>إرسال الرابط عبر الإيميل</p>
          <div className="space-y-2">
            <select value={emailForm.account_id} onChange={e => setEmailForm(f => ({ ...f, account_id: e.target.value }))}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}>
              <option value="">اختر حساب الإرسال...</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
            </select>
            <div className="flex gap-2">
              <input value={emailForm.to} onChange={e => setEmailForm(f => ({ ...f, to: e.target.value }))} placeholder="بريد الجهة الخارجية" type="email"
                className="flex-1 px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
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
