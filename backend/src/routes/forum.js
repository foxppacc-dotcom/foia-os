const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission, hasPermission } = require('../middleware/auth');
router.use(requireAuth);
const { getSupabase } = require('../supabase');
const { notifyUsers, getUsersWithPermission } = require('../services/notificationService');
const multer = require('multer');
const gdrive = require('../services/googleDriveService');
const forumFileStorage = require('../services/forumFileStorage');

const forumUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const FORUM_ACTIONS = ['view', 'create_topic', 'comment', 'pin', 'delete_any'];

// Being able to comment/create/pin/moderate the forum is meaningless without
// being able to see it -- but the Permissions matrix renders these as 4
// independent checkboxes, so an admin granting only "التعليق" (without also
// remembering to check "عرض") would otherwise 403 that role on the very
// pages it needs to reach the comment box. Reading is implied by ANY
// granted forum capability, not just the literal 'view' row.
async function requireForumVisible(req, res, next) {
  if (req.user.role === 'admin') return next();
  try {
    const sup = getSupabase();
    const { data } = await sup.from('role_permissions')
      .select('action, allowed').eq('role', req.user.role).eq('resource', 'forum').in('action', FORUM_ACTIONS);
    if ((data || []).some(r => r.allowed)) return next();
  } catch (e) { /* table not migrated yet -- fail closed */ }
  return res.status(403).json({ error: 'Forbidden — insufficient permissions' });
}

// Batch-resolve user_name for a set of rows carrying created_by, same
// no-FK-embed-reliance pattern used for case_comments -- forum_topics/
// forum_comments don't declare a users FK in every environment yet.
async function withAuthorNames(sup, rows) {
  const ids = [...new Set(rows.map(r => r.created_by).filter(Boolean))];
  if (!ids.length) return rows.map(r => ({ ...r, author_name: null }));
  const { data: users } = await sup.from('users').select('id, name').in('id', ids);
  const byId = Object.fromEntries((users || []).map(u => [u.id, u.name]));
  return rows.map(r => ({ ...r, author_name: byId[r.created_by] || null }));
}

// Batch-attach like_count/liked_by_me to a set of rows (topics OR comments,
// never mixed in one call) -- one query for all the counts, one for whether
// the current user is among them, instead of N+1 per row.
async function withLikes(sup, targetType, rows, userId) {
  if (!rows.length) return rows;
  const ids = rows.map(r => r.id);
  const { data: likes } = await sup.from('forum_likes').select('target_id, user_id').eq('target_type', targetType).in('target_id', ids);
  const counts = {};
  const mine = new Set();
  for (const l of likes || []) {
    counts[l.target_id] = (counts[l.target_id] || 0) + 1;
    if (l.user_id === userId) mine.add(l.target_id);
  }
  return rows.map(r => ({ ...r, like_count: counts[r.id] || 0, liked_by_me: mine.has(r.id) }));
}

// GET /api/forum/topics — pinned first, then newest first
router.get('/forum/topics', requireForumVisible, async (req, res) => {
  try {
    const sup = getSupabase();
    const { data: topics, error } = await sup
      .from('forum_topics').select('*')
      .order('is_pinned', { ascending: false }).order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: /does not exist|could not find the table/i.test(error.message) ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (forum_topics)' : error.message });

    const { data: comments } = await sup.from('forum_comments').select('topic_id');
    const counts = {};
    for (const c of comments || []) counts[c.topic_id] = (counts[c.topic_id] || 0) + 1;

    const withNames = await withAuthorNames(sup, topics || []);
    const withCounts = withNames.map(t => ({ ...t, comment_count: counts[t.id] || 0 }));
    const withLikeInfo = await withLikes(sup, 'topic', withCounts, req.user?.id);
    res.json({ success: true, data: withLikeInfo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/forum/topics/:id — topic + its comments
router.get('/forum/topics/:id', requireForumVisible, async (req, res) => {
  try {
    const sup = getSupabase();
    const topicId = parseInt(req.params.id);
    const { data: topic } = await sup.from('forum_topics').select('*').eq('id', topicId).maybeSingle();
    if (!topic) return res.status(404).json({ error: 'الموضوع غير موجود' });

    const { data: comments } = await sup.from('forum_comments').select('*').eq('topic_id', topicId).order('created_at', { ascending: true });
    const [topicWithName] = await withAuthorNames(sup, [topic]);
    const commentsWithNames = await withAuthorNames(sup, comments || []);
    const [[topicWithLikes], commentsWithLikes] = await Promise.all([
      withLikes(sup, 'topic', [topicWithName], req.user?.id),
      withLikes(sup, 'comment', commentsWithNames, req.user?.id),
    ]);
    res.json({ success: true, data: { ...topicWithLikes, comments: commentsWithLikes } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/forum/topics — create a topic, optional attachment or link
router.post('/forum/topics', requirePermission('forum', 'create_topic'), forumUpload.single('file'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { title, body, link_url, link_label } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'عنوان الموضوع مطلوب' });

    const insertData = {
      title: title.trim(), body: body || null,
      created_by: req.user?.id || null, created_at: new Date().toISOString(),
      is_pinned: false,
    };

    if (req.file) {
      if (!(await gdrive.isConnected())) return res.status(503).json({ error: 'حساب Google Drive غير متصل — لازم يتم ربطه قبل إرفاق ملف' });
      try {
        const saved = await forumFileStorage.saveForumFile({ buffer: req.file.buffer, fileName: req.file.originalname, mimeType: req.file.mimetype });
        insertData.attachment_url = saved.attachment_url;
        insertData.attachment_type = saved.attachment_type;
        insertData.attachment_name = saved.attachment_name;
      } catch (uploadErr) { return res.status(500).json({ error: 'فشل رفع المرفق: ' + uploadErr.message }); }
    } else if (link_url) {
      insertData.attachment_url = link_url;
      insertData.attachment_type = 'link';
      insertData.attachment_name = link_label || link_url;
    }

    const { data: topic, error } = await sup.from('forum_topics').insert(insertData).select().single();
    if (error) return res.status(400).json({ error: /does not exist|could not find the table/i.test(error.message) ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (forum_topics)' : error.message });

    try {
      const recipients = await getUsersWithPermission(sup, 'forum', 'view', { excludeUserId: req.user?.id });
      await notifyUsers(sup, recipients, {
        type: 'forum_topic', title: '📢 موضوع جديد في المنتدى العام', body: title.trim(),
        target_type: 'forum_topic', target_id: topic.id,
      });
    } catch (e) { console.error('[forum] topic notification failed:', e.message); }

    res.status(201).json({ ...topic, author_name: req.user?.name || null, comment_count: 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/forum/topics/:id/comments
router.post('/forum/topics/:id/comments', requirePermission('forum', 'comment'), forumUpload.single('file'), async (req, res) => {
  try {
    const sup = getSupabase();
    const topicId = parseInt(req.params.id);
    const { data: topic } = await sup.from('forum_topics').select('id').eq('id', topicId).maybeSingle();
    if (!topic) return res.status(404).json({ error: 'الموضوع غير موجود' });

    const { content, link_url, link_label } = req.body;
    if (!content && !req.file && !link_url) return res.status(400).json({ error: 'content أو مرفق أو رابط مطلوب' });

    const insertData = {
      topic_id: topicId, content: content || null,
      created_by: req.user?.id || null, created_at: new Date().toISOString(),
    };

    if (req.file) {
      if (!(await gdrive.isConnected())) return res.status(503).json({ error: 'حساب Google Drive غير متصل — لازم يتم ربطه قبل إرفاق ملف' });
      try {
        const saved = await forumFileStorage.saveForumFile({ buffer: req.file.buffer, fileName: req.file.originalname, mimeType: req.file.mimetype });
        insertData.attachment_url = saved.attachment_url;
        insertData.attachment_type = saved.attachment_type;
        insertData.attachment_name = saved.attachment_name;
      } catch (uploadErr) { return res.status(500).json({ error: 'فشل رفع المرفق: ' + uploadErr.message }); }
    } else if (link_url) {
      insertData.attachment_url = link_url;
      insertData.attachment_type = 'link';
      insertData.attachment_name = link_label || link_url;
    }

    const { data: comment, error } = await sup.from('forum_comments').insert(insertData).select().single();
    if (error) return res.status(400).json({ error: error.message });

    try {
      const { data: topicRow } = await sup.from('forum_topics').select('title, created_by').eq('id', topicId).maybeSingle();
      const recipients = await getUsersWithPermission(sup, 'forum', 'view', { excludeUserId: req.user?.id });
      await notifyUsers(sup, recipients, {
        type: 'forum_comment', title: '💬 تعليق جديد في المنتدى العام', body: topicRow?.title || 'موضوع',
        target_type: 'forum_topic', target_id: topicId,
      });
    } catch (e) { console.error('[forum] comment notification failed:', e.message); }

    res.status(201).json({ ...comment, author_name: req.user?.name || null, like_count: 0, liked_by_me: false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Toggle a like on a topic or comment -- one row per (target, user), so
// liking twice just unlikes rather than double-counting. Gated the same as
// commenting: liking is the lightest form of participation, not its own
// separate permission action.
async function toggleLike(req, res, targetType, targetId) {
  const sup = getSupabase();
  const { data: existing } = await sup.from('forum_likes').select('id')
    .eq('target_type', targetType).eq('target_id', targetId).eq('user_id', req.user.id).maybeSingle();

  if (existing) {
    const { error } = await sup.from('forum_likes').delete().eq('id', existing.id);
    if (error) return res.status(400).json({ error: error.message });
  } else {
    const { error } = await sup.from('forum_likes').insert({ target_type: targetType, target_id: targetId, user_id: req.user.id });
    if (error) return res.status(400).json({ error: /does not exist|could not find the table/i.test(error.message) ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (forum_likes)' : error.message });
  }

  const { count } = await sup.from('forum_likes').select('id', { count: 'exact', head: true }).eq('target_type', targetType).eq('target_id', targetId);
  res.json({ success: true, liked: !existing, like_count: count || 0 });
}

// POST /api/forum/topics/:id/like
router.post('/forum/topics/:id/like', requirePermission('forum', 'comment'), async (req, res) => {
  try {
    const topicId = parseInt(req.params.id);
    const sup = getSupabase();
    const { data: topic } = await sup.from('forum_topics').select('id').eq('id', topicId).maybeSingle();
    if (!topic) return res.status(404).json({ error: 'الموضوع غير موجود' });
    await toggleLike(req, res, 'topic', topicId);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/forum/comments/:id/like
router.post('/forum/comments/:id/like', requirePermission('forum', 'comment'), async (req, res) => {
  try {
    const commentId = parseInt(req.params.id);
    const sup = getSupabase();
    const { data: comment } = await sup.from('forum_comments').select('id').eq('id', commentId).maybeSingle();
    if (!comment) return res.status(404).json({ error: 'التعليق غير موجود' });
    await toggleLike(req, res, 'comment', commentId);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/forum/topics/:id/pin — toggle pinned state (announcements)
router.put('/forum/topics/:id/pin', requirePermission('forum', 'pin'), async (req, res) => {
  try {
    const sup = getSupabase();
    const topicId = parseInt(req.params.id);
    const { data: topic } = await sup.from('forum_topics').select('is_pinned').eq('id', topicId).maybeSingle();
    if (!topic) return res.status(404).json({ error: 'الموضوع غير موجود' });

    const { error } = await sup.from('forum_topics').update({ is_pinned: !topic.is_pinned, is_announcement: !topic.is_pinned }).eq('id', topicId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, is_pinned: !topic.is_pinned });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/forum/topics/:id — author within 60s, admin any time, or a
// role granted forum/delete_any -- same three-way rule as case comments.
router.delete('/forum/topics/:id', async (req, res) => {
  try {
    const sup = getSupabase();
    const topicId = parseInt(req.params.id);
    const { data: topic } = await sup.from('forum_topics').select('id, created_by, created_at').eq('id', topicId).maybeSingle();
    if (!topic) return res.status(404).json({ error: 'الموضوع غير موجود' });

    const isOwnWithinWindow = topic.created_by === req.user?.id && (Date.now() - new Date(topic.created_at).getTime()) <= 60 * 1000;
    const canDeleteAny = await hasPermission(sup, req.user, 'forum', 'delete_any');
    if (!isOwnWithinWindow && !canDeleteAny) {
      return res.status(403).json({ error: 'لا يمكن حذف هذا الموضوع — يمكن حذف موضوعك خلال دقيقة واحدة من نشره فقط' });
    }

    const { error } = await sup.from('forum_topics').delete().eq('id', topicId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/forum/comments/:id
router.delete('/forum/comments/:id', async (req, res) => {
  try {
    const sup = getSupabase();
    const commentId = parseInt(req.params.id);
    const { data: comment } = await sup.from('forum_comments').select('id, created_by, created_at').eq('id', commentId).maybeSingle();
    if (!comment) return res.status(404).json({ error: 'التعليق غير موجود' });

    const isOwnWithinWindow = comment.created_by === req.user?.id && (Date.now() - new Date(comment.created_at).getTime()) <= 60 * 1000;
    const canDeleteAny = await hasPermission(sup, req.user, 'forum', 'delete_any');
    if (!isOwnWithinWindow && !canDeleteAny) {
      return res.status(403).json({ error: 'لا يمكن حذف هذا التعليق — يمكن حذف تعليقك خلال دقيقة واحدة من نشره فقط' });
    }

    const { error } = await sup.from('forum_comments').delete().eq('id', commentId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// forumUpload (multer) throws inside its own middleware layer, before any
// route handler's try/catch runs -- same fix as documentCenter.js/cases.js.
router.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'حجم الملف أكبر من الحد المسموح (100 ميجابايت)'
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'عدد الملفات أكبر من الحد المسموح'
      : err.message;
    return res.status(400).json({ error: message });
  }
  next(err);
});

module.exports = router;
