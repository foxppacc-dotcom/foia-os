import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, getCurrentUser, getApiBase } from '../api';
import {
  Megaphone, Plus, Pin, PinOff, Trash2, MessageSquare, ArrowRight, Send,
  Paperclip, Link2, X, FileText, ExternalLink, ThumbsUp,
} from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';

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

// A handful of distinct, pleasant avatar colors -- picked deterministically
// from the author's name so the same person always gets the same color
// (matches the way Facebook/Slack-style avatars stay consistent per user
// instead of re-rolling a random color every render).
const AVATAR_COLORS = ['#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#06B6D4', '#EC4899', '#84CC16'];
function avatarColor(name) {
  const s = name || '؟';
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
function Avatar({ name, size = 36 }) {
  return (
    <div className="rounded-full flex items-center justify-center shrink-0 font-bold text-white"
      style={{ width: size, height: size, background: avatarColor(name), fontSize: size * 0.4 }}>
      {name?.charAt(0)?.toUpperCase() || '؟'}
    </div>
  );
}

const tok = () => localStorage.getItem('foia_token');

// Topic/comment creation supports an optional file attachment -- multer only
// activates for multipart bodies, so this bypasses api.post's JSON-only
// helper and posts FormData directly, same pattern as commentApi.js.
async function postMultipart(path, formData) {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: 'POST',
    headers: tok() ? { Authorization: 'Bearer ' + tok() } : {},
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'فشل الطلب');
  return data;
}

export default function Forum() {
  const toast = useToast();
  const me = getCurrentUser();
  const isAdmin = me?.role === 'admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [perms, setPerms] = useState(null);
  // Opened directly via a notification link (/forum?topic=123) instead of
  // clicking a card in the list -- otherwise a forum_topic/forum_comment
  // notification had nowhere real to navigate to and just closed the bell.
  const [selected, setSelected] = useState(() => {
    const t = searchParams.get('topic');
    return t ? parseInt(t) : null;
  });
  const [showCreate, setShowCreate] = useState(false);
  const [, forceTick] = useState(0);

  const fetchTopics = () => {
    api.get('/forum/topics').then(d => setTopics(d.data || [])).catch(e => toast.error(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { fetchTopics(); }, []);
  useEffect(() => {
    if (searchParams.get('topic')) { searchParams.delete('topic'); setSearchParams(searchParams, { replace: true }); }
  }, []);
  useEffect(() => {
    api.get('/permissions/mine').then(setPerms).catch(() => setPerms({ permissions: [] }));
  }, []);
  useEffect(() => {
    const t = setInterval(() => forceTick(x => x + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const has = (action) => isAdmin || !!perms?.permissions?.find(p => p.resource === 'forum' && p.action === action);
  const canCreateTopic = has('create_topic');
  const canComment = has('comment');
  const canPin = has('pin');
  const canDeleteAny = has('delete_any');

  if (loading || !perms) return <Spinner full />;

  // The feed (list view) gets a wide, magazine-style two-column layout on
  // desktop; a single open post (detail view) stays narrow and centered
  // like Facebook's own post-detail page, since a 2-column layout makes no
  // sense once there's only one thing to show.
  return (
    <div className={`${selected ? 'max-w-xl' : 'max-w-4xl'} mx-auto space-y-4 animate-fadeIn`}>
      <PageHeader
        eyebrow="فريق العمل"
        title="المنتدى العام"
        meta="مساحة النقاش العام والإعلانات لكل فريق العمل"
        actions={!selected && canCreateTopic ? <Button icon={Plus} onClick={() => setShowCreate(true)}>موضوع جديد</Button> : undefined}
      />

      {selected ? (
        <TopicDetail
          topicId={selected}
          onBack={() => { setSelected(null); fetchTopics(); }}
          me={me} isAdmin={isAdmin} canComment={canComment} canPin={canPin} canDeleteAny={canDeleteAny}
          toast={toast}
        />
      ) : (
        <TopicList topics={topics} onSelect={setSelected} isAdmin={isAdmin} canDeleteAny={canDeleteAny} canComment={canComment} me={me} toast={toast} onChanged={fetchTopics} />
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="موضوع جديد">
        <CreateTopicForm onDone={() => { setShowCreate(false); fetchTopics(); }} toast={toast} />
      </Modal>
    </div>
  );
}

// Facebook-style stats row ("N إعجاب · N تعليقات") sitting between the post
// body/image and the action button bar.
function StatsRow({ likeCount, commentCount }) {
  if (!likeCount && commentCount == null) return null;
  return (
    <div className="px-3 py-1.5 flex items-center justify-between text-[11px]" style={{ color: 'var(--text-muted)' }}>
      <span>{likeCount > 0 ? `👍 ${likeCount}` : ''}</span>
      {commentCount != null && <span>{commentCount > 0 ? `${commentCount} تعليقات` : ''}</span>}
    </div>
  );
}

// Facebook-style action bar: two evenly-split buttons ("إعجاب"/"تعليق")
// separated by a vertical divider, sitting right under the stats row.
function ActionBar({ liked, onLike, onComment }) {
  return (
    <div className="flex items-stretch" style={{ borderTop: '1px solid var(--border)' }}>
      <button onClick={onLike}
        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold ds-transition-colors"
        style={{ color: liked ? 'var(--accent)' : 'var(--text-secondary)' }}>
        <ThumbsUp className="w-4 h-4" fill={liked ? 'currentColor' : 'none'} /> إعجاب
      </button>
      <div className="w-px" style={{ background: 'var(--border)' }} />
      <button onClick={onComment} className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
        <MessageSquare className="w-4 h-4" /> تعليق
      </button>
    </div>
  );
}

function TopicList({ topics, onSelect, isAdmin, canDeleteAny, canComment, me, toast, onChanged }) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  // Optimistic like state -- toggling re-renders instantly instead of
  // waiting on the round trip, matching how Facebook's like button feels.
  const [localTopics, setLocalTopics] = useState(topics);
  useEffect(() => { setLocalTopics(topics); }, [topics]);

  const canDelete = (t) => isAdmin || canDeleteAny || (t.created_by === me?.id && (Date.now() - new Date(t.created_at).getTime()) < DELETE_WINDOW_MS);

  const toggleLike = async (topicId) => {
    if (!canComment) return;
    setLocalTopics(prev => prev.map(t => t.id === topicId ? { ...t, liked_by_me: !t.liked_by_me, like_count: t.like_count + (t.liked_by_me ? -1 : 1) } : t));
    try {
      const d = await api.post(`/forum/topics/${topicId}/like`, {});
      setLocalTopics(prev => prev.map(t => t.id === topicId ? { ...t, liked_by_me: d.liked, like_count: d.like_count } : t));
    } catch (e) {
      toast.error(e.message);
      setLocalTopics(prev => prev.map(t => t.id === topicId ? { ...t, liked_by_me: !t.liked_by_me, like_count: t.like_count + (t.liked_by_me ? -1 : 1) } : t));
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      await api.delete(`/forum/topics/${confirmDelete.id}`);
      toast.success('تم حذف الموضوع');
      setConfirmDelete(null);
      onChanged();
    } catch (e) { toast.error(e.message); setConfirmDelete(null); }
  };

  if (!localTopics.length) return <EmptyState icon={Megaphone} title="لا توجد مواضيع بعد" description="ابدأ أول نقاش أو إعلان للفريق" />;

  return (
    // Magazine/waterfall layout on wide screens: CSS multi-column flows
    // posts top-to-bottom then column-to-column, so the newest post lands
    // at the top of column 1, the next-newest at the top of column 2, and
    // so on -- naturally giving the "newest sits a little higher" look
    // without manually computing heights. Collapses to a single column on
    // phones, stacked one under another exactly like Facebook's feed.
    // break-inside-avoid on each card keeps one post from being split
    // across the column break.
    <div className="columns-1 md:columns-2 gap-4">
      {localTopics.map(t => (
        <div key={t.id} className="rounded-xl border overflow-hidden mb-4 break-inside-avoid" style={{ background: 'var(--bg-secondary)', borderColor: t.is_pinned ? 'var(--accent)' : 'var(--border)' }}>
          <div className="p-3 flex items-start gap-2.5 cursor-pointer" onClick={() => onSelect(t.id)}>
            <Avatar name={t.author_name} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t.author_name || 'مستخدم محذوف'}</span>
                {t.is_pinned && <Badge variant="accent" dot><Pin className="w-3 h-3" /> إعلان مثبت</Badge>}
              </div>
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{timeAgo(t.created_at)}</span>
            </div>
            {canDelete(t) && (
              <button onClick={e => { e.stopPropagation(); setConfirmDelete(t); }} className="p-1.5 rounded-lg shrink-0" style={{ color: 'var(--text-muted)' }}
                onMouseOver={e => e.currentTarget.style.color = 'var(--danger)'} onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}>
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="px-3 pb-2 cursor-pointer" onClick={() => onSelect(t.id)}>
            <h3 className="font-bold text-sm mb-0.5" style={{ color: 'var(--text-primary)' }}>{t.title}</h3>
            {t.body && <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{t.body}</p>}
          </div>

          {t.attachment_url && t.attachment_type === 'image' && (
            <img src={t.attachment_url} alt="" className="w-full max-h-[420px] object-cover cursor-pointer" onClick={() => onSelect(t.id)} />
          )}
          {t.attachment_url && t.attachment_type !== 'image' && (
            <div className="px-3 pb-2">
              <AttachmentBlock item={t} />
            </div>
          )}

          <StatsRow likeCount={t.like_count} commentCount={t.comment_count} />
          <ActionBar liked={t.liked_by_me} onLike={() => toggleLike(t.id)} onComment={() => onSelect(t.id)} />
        </div>
      ))}

      <ConfirmDialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={doDelete}
        title="حذف الموضوع" confirmLabel="حذف" message={`هل أنت متأكد من حذف "${confirmDelete?.title}"؟ سيتم حذف كل التعليقات المرتبطة به.`} />
    </div>
  );
}

function CreateTopicForm({ onDone, toast }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [file, setFile] = useState(null);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);
  // Without resetting the native input's own .value too, re-picking the
  // exact same file after clearing it via the X button fires no change
  // event (the browser sees the value as unchanged), silently failing to
  // re-attach it.
  useEffect(() => { if (!file && fileInputRef.current) fileInputRef.current.value = ''; }, [file]);

  const submit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('title', title.trim());
      if (body.trim()) fd.append('body', body.trim());
      if (file) fd.append('file', file);
      if (linkUrl.trim()) fd.append('link_url', linkUrl.trim());
      await postMultipart('/forum/topics', fd);
      toast.success('تم نشر الموضوع');
      onDone();
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <Input label="العنوان" value={title} onChange={e => setTitle(e.target.value)} placeholder="عنوان الموضوع أو الإعلان" />
      <div>
        <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>المحتوى</label>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={4}
          placeholder="اكتب تفاصيل الموضوع..."
          className="w-full px-3 py-2 rounded-lg text-sm resize-none"
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
      </div>
      {file && (
        <div className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
          <Paperclip className="w-3.5 h-3.5 shrink-0" /><span className="flex-1 truncate">{file.name}</span>
          <button onClick={() => setFile(null)} style={{ color: 'var(--text-muted)' }}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}
      {showLinkInput && (
        <div className="flex items-center gap-2">
          <Link2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
          <input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://..." dir="ltr"
            className="flex-1 px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
          <button onClick={() => { setShowLinkInput(false); setLinkUrl(''); }} style={{ color: 'var(--text-muted)' }}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}
      <div className="flex items-center gap-1">
        <label className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
          <Paperclip className="w-3.5 h-3.5" /> مرفق
          <input ref={fileInputRef} type="file" hidden onChange={e => setFile(e.target.files?.[0] || null)} />
        </label>
        <button onClick={() => setShowLinkInput(s => !s)} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg" style={{ color: showLinkInput ? 'var(--accent)' : 'var(--text-secondary)' }}>
          <Link2 className="w-3.5 h-3.5" /> رابط
        </button>
      </div>
      <div className="flex gap-2 pt-1">
        <Button className="flex-1" onClick={submit} loading={saving} disabled={!title.trim()}>نشر</Button>
        <Button variant="secondary" className="flex-1" onClick={onDone}>إلغاء</Button>
      </div>
    </div>
  );
}

function TopicDetail({ topicId, onBack, me, isAdmin, canComment, canPin, canDeleteAny, toast }) {
  const [topic, setTopic] = useState(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [posting, setPosting] = useState(false);
  const [confirmDeleteComment, setConfirmDeleteComment] = useState(null);
  const [confirmDeleteTopic, setConfirmDeleteTopic] = useState(false);
  const [, forceTick] = useState(0);
  const fileInputRef = useRef(null);
  useEffect(() => { if (!file && fileInputRef.current) fileInputRef.current.value = ''; }, [file]);

  const fetchTopic = () => {
    api.get(`/forum/topics/${topicId}`).then(d => setTopic(d.data)).catch(e => toast.error(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { fetchTopic(); }, [topicId]);
  useEffect(() => {
    const t = setInterval(() => forceTick(x => x + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const canDeleteItem = (item) => isAdmin || canDeleteAny || (item.created_by === me?.id && (Date.now() - new Date(item.created_at).getTime()) < DELETE_WINDOW_MS);

  const toggleTopicLike = async () => {
    if (!canComment || !topic) return;
    const prev = { liked_by_me: topic.liked_by_me, like_count: topic.like_count };
    setTopic(t => ({ ...t, liked_by_me: !t.liked_by_me, like_count: t.like_count + (t.liked_by_me ? -1 : 1) }));
    try {
      const d = await api.post(`/forum/topics/${topicId}/like`, {});
      setTopic(t => ({ ...t, liked_by_me: d.liked, like_count: d.like_count }));
    } catch (e) {
      toast.error(e.message);
      setTopic(t => ({ ...t, ...prev }));
    }
  };

  const toggleCommentLike = async (commentId) => {
    if (!canComment) return;
    setTopic(t => ({ ...t, comments: t.comments.map(c => c.id === commentId ? { ...c, liked_by_me: !c.liked_by_me, like_count: c.like_count + (c.liked_by_me ? -1 : 1) } : c) }));
    try {
      const d = await api.post(`/forum/comments/${commentId}/like`, {});
      setTopic(t => ({ ...t, comments: t.comments.map(c => c.id === commentId ? { ...c, liked_by_me: d.liked, like_count: d.like_count } : c) }));
    } catch (e) {
      toast.error(e.message);
      setTopic(t => ({ ...t, comments: t.comments.map(c => c.id === commentId ? { ...c, liked_by_me: !c.liked_by_me, like_count: c.like_count + (c.liked_by_me ? -1 : 1) } : c) }));
    }
  };

  const submitComment = async () => {
    if ((!text.trim() && !file && !linkUrl.trim()) || posting) return;
    setPosting(true);
    try {
      const fd = new FormData();
      if (text.trim()) fd.append('content', text.trim());
      if (file) fd.append('file', file);
      if (linkUrl.trim()) fd.append('link_url', linkUrl.trim());
      await postMultipart(`/forum/topics/${topicId}/comments`, fd);
      setText(''); setFile(null); setLinkUrl(''); setShowLinkInput(false);
      fetchTopic();
    } catch (e) { toast.error(e.message); }
    setPosting(false);
  };

  const togglePin = async () => {
    try { await api.put(`/forum/topics/${topicId}/pin`); fetchTopic(); }
    catch (e) { toast.error(e.message); }
  };

  const deleteComment = async () => {
    if (!confirmDeleteComment) return;
    try {
      await api.delete(`/forum/comments/${confirmDeleteComment}`);
      setConfirmDeleteComment(null);
      fetchTopic();
    } catch (e) { toast.error(e.message); setConfirmDeleteComment(null); }
  };

  const deleteTopic = async () => {
    try {
      await api.delete(`/forum/topics/${topicId}`);
      toast.success('تم حذف الموضوع');
      onBack();
    } catch (e) { toast.error(e.message); setConfirmDeleteTopic(false); }
  };

  if (loading || !topic) return <Spinner full />;

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
        <ArrowRight className="w-4 h-4" /> العودة إلى المنتدى
      </button>

      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <div className="p-3 flex items-start gap-2.5">
          <Avatar name={topic.author_name} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{topic.author_name || 'مستخدم محذوف'}</span>
              {topic.is_pinned && <Badge variant="accent" dot><Pin className="w-3 h-3" /> إعلان مثبت</Badge>}
            </div>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{timeAgo(topic.created_at)}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {canPin && (
              <button onClick={togglePin} className="p-1.5 rounded-lg" style={{ color: topic.is_pinned ? 'var(--accent)' : 'var(--text-muted)' }} title={topic.is_pinned ? 'إلغاء التثبيت' : 'تثبيت كإعلان مهم'}>
                {topic.is_pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
              </button>
            )}
            {canDeleteItem(topic) && (
              <button onClick={() => setConfirmDeleteTopic(true)} className="p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}
                onMouseOver={e => e.currentTarget.style.color = 'var(--danger)'} onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}>
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="px-3 pb-2">
          <h2 className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{topic.title}</h2>
          {topic.body && <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{topic.body}</p>}
        </div>

        {topic.attachment_url && topic.attachment_type === 'image' && (
          <img src={topic.attachment_url} alt="" className="w-full max-h-[520px] object-cover" />
        )}
        {topic.attachment_url && topic.attachment_type !== 'image' && (
          <div className="px-3 pb-2"><AttachmentBlock item={topic} /></div>
        )}

        <StatsRow likeCount={topic.like_count} commentCount={topic.comments?.length || 0} />
        <ActionBar liked={topic.liked_by_me} onLike={toggleTopicLike} onComment={() => document.getElementById('forum-comment-input')?.focus()} />
      </div>

      <div className="space-y-3 px-1">
        {(topic.comments || []).map(cm => (
          <div key={cm.id} className="flex items-start gap-2 group">
            <Avatar name={cm.author_name} size={30} />
            <div className="min-w-0 flex-1">
              <div className="inline-block max-w-full rounded-2xl px-3 py-2" style={{ background: 'var(--bg-tertiary)' }}>
                <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{cm.author_name || 'مستخدم محذوف'}</div>
                {cm.content && <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{cm.content}</div>}
                <AttachmentBlock item={cm} compact />
              </div>
              <div className="flex items-center gap-3 mt-1 px-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                <button onClick={() => toggleCommentLike(cm.id)}
                  className="font-semibold" style={{ color: cm.liked_by_me ? 'var(--accent)' : 'var(--text-muted)' }}>
                  إعجاب{cm.like_count > 0 ? ` (${cm.like_count})` : ''}
                </button>
                <span>{timeAgo(cm.created_at)}</span>
                {canDeleteItem(cm) && (
                  <button onClick={() => setConfirmDeleteComment(cm.id)} className="opacity-0 group-hover:opacity-100 transition-opacity"
                    onMouseOver={e => e.currentTarget.style.color = 'var(--danger)'} onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}>
                    حذف
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {!topic.comments?.length && <p className="text-xs text-center py-3" style={{ color: 'var(--text-muted)' }}>لا توجد تعليقات بعد</p>}
      </div>

      {canComment && (
        <div className="flex items-start gap-2 px-1">
          <Avatar name={me?.name} size={32} />
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5" style={{ background: 'var(--bg-tertiary)' }}>
              <input id="forum-comment-input" value={text} onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment(); } }}
                placeholder="اكتب تعليقًا..."
                className="flex-1 bg-transparent text-sm outline-none" style={{ color: 'var(--text-primary)' }} />
              <label className="cursor-pointer shrink-0" style={{ color: 'var(--text-muted)' }}>
                <Paperclip className="w-4 h-4" />
                <input ref={fileInputRef} type="file" hidden onChange={e => setFile(e.target.files?.[0] || null)} />
              </label>
              <button onClick={() => setShowLinkInput(s => !s)} className="shrink-0" style={{ color: showLinkInput || linkUrl ? 'var(--accent)' : 'var(--text-muted)' }}>
                <Link2 className="w-4 h-4" />
              </button>
              <button onClick={submitComment} disabled={posting || (!text.trim() && !file && !linkUrl.trim())} className="shrink-0 disabled:opacity-30" style={{ color: 'var(--accent)' }}>
                <Send className="w-4 h-4" />
              </button>
            </div>
            {file && (
              <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                <Paperclip className="w-3.5 h-3.5 shrink-0" /><span className="flex-1 truncate">{file.name}</span>
                <button onClick={() => setFile(null)} style={{ color: 'var(--text-muted)' }}><X className="w-3.5 h-3.5" /></button>
              </div>
            )}
            {showLinkInput && (
              <div className="flex items-center gap-2 px-1">
                <Link2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
                <input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://..." dir="ltr"
                  className="flex-1 px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                <button onClick={() => { setShowLinkInput(false); setLinkUrl(''); }} style={{ color: 'var(--text-muted)' }}><X className="w-3.5 h-3.5" /></button>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog open={!!confirmDeleteComment} onClose={() => setConfirmDeleteComment(null)} onConfirm={deleteComment}
        title="حذف التعليق" confirmLabel="حذف" message="هل أنت متأكد من حذف هذا التعليق؟" />
      <ConfirmDialog open={confirmDeleteTopic} onClose={() => setConfirmDeleteTopic(false)} onConfirm={deleteTopic}
        title="حذف الموضوع" confirmLabel="حذف" message="هل أنت متأكد من حذف هذا الموضوع؟ سيتم حذف كل التعليقات المرتبطة به." />
    </div>
  );
}

function AttachmentBlock({ item, compact }) {
  if (!item.attachment_url || item.attachment_type === 'image') return null;
  const Icon = item.attachment_type === 'link' ? ExternalLink : FileText;
  return (
    <a href={item.attachment_url} target="_blank" rel="noopener noreferrer"
      className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg w-fit ${compact ? 'mt-1' : 'mt-2'}`}
      style={{ background: 'var(--bg-secondary)', color: 'var(--accent)' }}>
      <Icon className="w-3.5 h-3.5" /> {item.attachment_name || item.attachment_url}
    </a>
  );
}
