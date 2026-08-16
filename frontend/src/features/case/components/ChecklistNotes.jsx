import { useState, useEffect } from 'react';
import { useCaseContext } from '../context/CaseContext';
import { postComment, deleteComment } from '../services/commentApi';
import { api, getCurrentUser } from '../../../api';
import { Send, Paperclip, Link2, FileText, X, User, ExternalLink, Reply, Trash2, AtSign } from 'lucide-react';

const DELETE_WINDOW_MS = 60 * 1000;

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} د`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} س`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `منذ ${days} يوم`;
  return new Date(dateStr).toLocaleDateString('ar-EG');
}

// One checklist item's own notes thread -- identical mechanics to
// TeamDiscussion (reply/mention/attachment/link/delete-within-60s), just
// scoped to this record_type via case_comments.record_type instead of the
// case's general discussion. A checklist item is now JUST this: no status
// buttons, no separate detail panel -- writing/reading notes IS the whole
// interaction, per the explicit request to simplify it down to that.
export default function ChecklistNotes({ recordType }) {
  const { id: caseId, comments: allComments, users, refetch } = useCaseContext();
  const comments = (allComments || []).filter(c => c.record_type === recordType);
  const me = getCurrentUser();
  const isAdmin = me?.role === 'admin';
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [mentionTarget, setMentionTarget] = useState('');
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [canDeleteAny, setCanDeleteAny] = useState(false);
  const [, forceTick] = useState(0);

  useEffect(() => {
    api.get('/permissions/mine').then(d => {
      setCanDeleteAny(!!d.permissions?.find(p => p.resource === 'case_comments' && p.action === 'delete_any'));
    }).catch(() => {});
  }, []);
  useEffect(() => {
    const t = setInterval(() => forceTick(x => x + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const canPost = text.trim() || file || linkUrl.trim();

  const submit = async () => {
    if (!canPost || posting) return;
    setPosting(true);
    setError('');
    try {
      await postComment(caseId, {
        content: text.trim(), file, linkUrl: linkUrl.trim() || undefined,
        replyToId: replyTo?.id, mentionedUserIds: mentionTarget ? [parseInt(mentionTarget)] : undefined,
        recordType,
      });
      setText(''); setFile(null); setLinkUrl(''); setShowLinkInput(false);
      setReplyTo(null); setMentionTarget(''); setShowMentionPicker(false);
      refetch?.(true);
    } catch (e) {
      setError(e.message);
    }
    setPosting(false);
  };

  const handleDelete = async (commentId) => {
    if (!confirm('هل أنت متأكد من حذف هذه الملاحظة؟')) return;
    try {
      await deleteComment(caseId, commentId);
      refetch?.(true);
    } catch (e) {
      alert('❌ ' + e.message);
    }
  };

  const findComment = (id) => comments.find(c => c.id === id);
  const mentionedName = (id) => users?.find(u => u.id === id)?.name || null;

  return (
    <div>
      {/* Composer */}
      <div className="space-y-2 mb-3 p-3 rounded-lg" style={{ background: 'var(--ds-bg-tertiary)' }}>
        {replyTo && (
          <div className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--ds-bg-primary)', color: 'var(--ds-text-secondary)', borderRight: '3px solid var(--ds-accent)' }}>
            <Reply className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 truncate">الرد على <strong>{replyTo.user_name || 'النظام'}</strong>: {(replyTo.content || replyTo.attachment_name || '').slice(0, 60)}</span>
            <button onClick={() => setReplyTo(null)} style={{ color: 'var(--ds-text-muted)' }}><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
          placeholder="اكتب ملاحظة..."
          className="w-full px-3 py-2 rounded-lg text-sm resize-none"
          style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />

        {file && (
          <div className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--ds-bg-primary)', color: 'var(--ds-text-secondary)' }}>
            <Paperclip className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 truncate">{file.name}</span>
            <button onClick={() => setFile(null)} style={{ color: 'var(--ds-text-muted)' }}><X className="w-3.5 h-3.5" /></button>
          </div>
        )}
        {showLinkInput && (
          <div className="flex items-center gap-2">
            <Link2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ds-text-muted)' }} />
            <input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://..."
              className="flex-1 px-2.5 py-1.5 rounded-lg text-xs" dir="ltr"
              style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }} />
            <button onClick={() => { setShowLinkInput(false); setLinkUrl(''); }} style={{ color: 'var(--ds-text-muted)' }}><X className="w-3.5 h-3.5" /></button>
          </div>
        )}
        {showMentionPicker && (
          <div className="flex items-center gap-2">
            <AtSign className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ds-text-muted)' }} />
            <select value={mentionTarget} onChange={e => setMentionTarget(e.target.value)}
              className="flex-1 px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}>
              <option value="">اختر أحد أفراد الفريق...</option>
              {(users || []).filter(u => u.id !== me?.id).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button onClick={() => { setShowMentionPicker(false); setMentionTarget(''); }} style={{ color: 'var(--ds-text-muted)' }}><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        {error && <p className="text-[11px] px-1" style={{ color: 'var(--ds-danger)' }}>{error}</p>}

        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-1">
            <label className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg cursor-pointer" style={{ color: 'var(--ds-text-secondary)' }}
              title="إرفاق صورة أو ملف">
              <Paperclip className="w-3.5 h-3.5" /> مرفق
              <input type="file" hidden onChange={e => setFile(e.target.files?.[0] || null)} />
            </label>
            <button onClick={() => setShowLinkInput(s => !s)}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg" style={{ color: showLinkInput ? 'var(--ds-accent)' : 'var(--ds-text-secondary)' }}>
              <Link2 className="w-3.5 h-3.5" /> رابط
            </button>
            <button onClick={() => setShowMentionPicker(s => !s)}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg" style={{ color: showMentionPicker || mentionTarget ? 'var(--ds-accent)' : 'var(--ds-text-secondary)' }}>
              <AtSign className="w-3.5 h-3.5" /> {mentionTarget ? `موجّه إلى ${mentionedName(parseInt(mentionTarget)) || ''}` : 'توجيه إلى'}
            </button>
          </div>
          <button onClick={submit} disabled={!canPost || posting}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
            style={{ background: 'var(--ds-accent)', color: 'white' }}>
            <Send className="w-3.5 h-3.5" /> {posting ? 'جارٍ النشر...' : 'نشر'}
          </button>
        </div>
      </div>

      {/* Notes list */}
      {comments.length === 0 ? (
        <p className="text-xs text-center py-4" style={{ color: 'var(--ds-text-muted)' }}>لا توجد ملاحظات بعد</p>
      ) : (
        <div className="space-y-2.5 max-h-96 overflow-y-auto">
          {comments.map(cm => {
            const repliedTo = cm.reply_to_id ? findComment(cm.reply_to_id) : null;
            const isOwn = cm.user_id === me?.id;
            const withinWindow = isOwn && (Date.now() - new Date(cm.created_at).getTime()) < DELETE_WINDOW_MS;
            const canDelete = withinWindow || isAdmin || canDeleteAny;
            const mentions = (cm.mentioned_user_ids || []).map(mentionedName).filter(Boolean);
            return (
              <div key={cm.id} className="p-3 rounded-lg group" style={{ background: 'var(--ds-bg-tertiary)' }}>
                {repliedTo && (
                  <div className="flex items-center gap-1.5 text-[11px] mb-1.5 px-2 py-1 rounded" style={{ background: 'var(--ds-bg-primary)', color: 'var(--ds-text-muted)', borderRight: '2px solid var(--ds-border)' }}>
                    <Reply className="w-3 h-3 shrink-0" />
                    <span className="truncate">{repliedTo.user_name || 'النظام'}: {(repliedTo.content || repliedTo.attachment_name || '').slice(0, 50)}</span>
                  </div>
                )}
                {mentions.length > 0 && (
                  <div className="flex items-center gap-1 text-[11px] mb-1.5" style={{ color: 'var(--ds-accent)' }}>
                    <AtSign className="w-3 h-3" /> موجّه إلى: {mentions.join('، ')}
                  </div>
                )}
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[9px] font-bold" style={{ background: 'var(--ds-accent)', color: 'white' }}>
                    {cm.user_name?.charAt(0) || <User className="w-3 h-3" />}
                  </div>
                  <span className="text-xs font-semibold" style={{ color: 'var(--ds-text-primary)' }}>{cm.user_name || 'النظام'}</span>
                  <span className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>· {timeAgo(cm.created_at)}</span>
                  <div className="flex-1" />
                  <button onClick={() => setReplyTo(cm)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded" style={{ color: 'var(--ds-text-muted)' }} title="رد">
                    <Reply className="w-3.5 h-3.5" />
                  </button>
                  {canDelete && (
                    <button onClick={() => handleDelete(cm.id)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded" style={{ color: 'var(--ds-text-muted)' }}
                      onMouseOver={e => e.currentTarget.style.color = 'var(--ds-danger)'} onMouseOut={e => e.currentTarget.style.color = 'var(--ds-text-muted)'} title="حذف">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {cm.content && <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--ds-text-secondary)' }}>{cm.content}</p>}
                {cm.attachment_url && cm.attachment_type === 'image' && (
                  <a href={cm.attachment_url} target="_blank" rel="noopener noreferrer" className="block mt-2">
                    <img src={cm.attachment_url} alt={cm.attachment_name || ''} className="max-h-40 rounded-lg border" style={{ borderColor: 'var(--ds-border)' }} />
                  </a>
                )}
                {cm.attachment_url && cm.attachment_type === 'file' && (
                  <a href={cm.attachment_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 mt-2 text-xs px-2.5 py-1.5 rounded-lg w-fit" style={{ background: 'var(--ds-bg-primary)', color: 'var(--ds-accent)' }}>
                    <FileText className="w-3.5 h-3.5" /> {cm.attachment_name || 'ملف مرفق'}
                  </a>
                )}
                {cm.attachment_url && cm.attachment_type === 'link' && (
                  <a href={cm.attachment_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 mt-2 text-xs px-2.5 py-1.5 rounded-lg w-fit" style={{ background: 'var(--ds-bg-primary)', color: 'var(--ds-accent)' }}>
                    <ExternalLink className="w-3.5 h-3.5" /> {cm.attachment_name || cm.attachment_url}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
