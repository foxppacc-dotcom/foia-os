const express = require('express');
const router = express.Router();
const { requireAuth, hasPermission } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const aiDraftRegistry = require('../services/aiDraftRegistry');
router.use(requireAuth);

// Internal messaging: direct (1-1), group, and org-wide broadcast
// conversations -- separate from `notifications` (system alerts, no
// sender/thread) and `forum_*` (public board, no private participant-scoped
// conversations). See migrations/043_internal_messaging.sql for the schema
// and reasoning.

// A dm/group conversation is only visible to/usable by its participants;
// a broadcast conversation is visible to everyone (permission-gated on
// POSTING, not reading -- same convention forum_topics already uses).
async function assertParticipant(sup, conversationId, userId) {
  const { data: conv } = await sup.from('internal_conversations').select('id, type').eq('id', conversationId).maybeSingle();
  if (!conv) return { ok: false, status: 404, error: 'المحادثة غير موجودة' };
  if (conv.type === 'broadcast') return { ok: true, conv };
  const { data: participant } = await sup.from('internal_conversation_participants')
    .select('id').eq('conversation_id', conversationId).eq('user_id', userId).maybeSingle();
  if (!participant) return { ok: false, status: 403, error: 'Forbidden — لست عضوًا في هذه المحادثة' };
  return { ok: true, conv };
}

// GET /api/conversations — every conversation the user can see: dm/group
// they're a participant in, plus every broadcast conversation, each with a
// last-message preview and an unread count (dm/group only -- broadcast has
// no per-user read tracking, see the migration's own reasoning).
router.get('/conversations', async (req, res) => {
  try {
    const sup = getSupabase();
    const userId = req.user.id;

    const [{ data: memberships }, { data: broadcasts }] = await Promise.all([
      sup.from('internal_conversation_participants').select('conversation_id, last_read_at').eq('user_id', userId),
      sup.from('internal_conversations').select('id').eq('type', 'broadcast'),
    ]);
    const convIds = [...new Set([...(memberships || []).map(m => m.conversation_id), ...(broadcasts || []).map(b => b.id)])];
    if (!convIds.length) return res.json({ success: true, data: [] });

    const lastReadByConv = Object.fromEntries((memberships || []).map(m => [m.conversation_id, m.last_read_at]));

    const { data: convs } = await sup.from('internal_conversations').select('*').in('id', convIds);

    // For 'dm' conversations, resolve the OTHER participant's name to show
    // as the conversation's display title (dm rows have no title of their own).
    const dmIds = (convs || []).filter(c => c.type === 'dm').map(c => c.id);
    let otherByConv = {};
    let otherIdByConv = {};
    if (dmIds.length) {
      const { data: allParticipants } = await sup.from('internal_conversation_participants')
        .select('conversation_id, user_id, users!user_id!inner(id, name)').in('conversation_id', dmIds);
      for (const p of allParticipants || []) {
        if (p.user_id === userId) continue;
        otherByConv[p.conversation_id] = p.users?.name || null;
        otherIdByConv[p.conversation_id] = p.user_id;
      }
    }

    // Last message + unread count per conversation -- N+1 by conversation
    // count, but this is a small per-user list (a handful to a few dozen
    // conversations), not a table scan; same tradeoff already accepted
    // elsewhere in this codebase for similarly-small per-item lookups.
    const results = await Promise.all((convs || []).map(async (c) => {
      const { data: lastMsgRows } = await sup.from('internal_messages')
        .select('content, sender_id, created_at').eq('conversation_id', c.id)
        .order('created_at', { ascending: false }).limit(1);
      const lastMsg = lastMsgRows?.[0] || null;

      let unread = 0;
      if (c.type !== 'broadcast') {
        const lastReadAt = lastReadByConv[c.id];
        let q = sup.from('internal_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', c.id).neq('sender_id', userId);
        if (lastReadAt) q = q.gt('created_at', lastReadAt);
        const { count } = await q;
        unread = count || 0;
      }

      return {
        id: c.id, type: c.type,
        title: c.type === 'dm' ? (otherByConv[c.id] || 'محادثة') : (c.title || 'بدون عنوان'),
        other_user_id: c.type === 'dm' ? (otherIdByConv[c.id] || null) : null,
        last_message: lastMsg?.content || null,
        last_message_at: lastMsg?.created_at || c.created_at,
        unread_count: unread,
      };
    }));

    results.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
    res.json({ success: true, data: results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/conversations/unread-count — total unread across dm/group
// conversations, for the topbar badge (polled the same way notifications
// already are -- see Topbar.jsx).
router.get('/conversations/unread-count', async (req, res) => {
  try {
    const sup = getSupabase();
    const userId = req.user.id;
    const { data: memberships } = await sup.from('internal_conversation_participants')
      .select('conversation_id, last_read_at').eq('user_id', userId);
    if (!memberships?.length) return res.json({ unread: 0 });
    const totals = await Promise.all(memberships.map(async (m) => {
      let q = sup.from('internal_messages').select('id', { count: 'exact', head: true })
        .eq('conversation_id', m.conversation_id).neq('sender_id', userId);
      if (m.last_read_at) q = q.gt('created_at', m.last_read_at);
      const { count } = await q;
      return count || 0;
    }));
    res.json({ unread: totals.reduce((a, b) => a + b, 0) });
  } catch (err) { res.json({ unread: 0 }); }
});

// POST /api/conversations — create a dm/group (any authenticated employee)
// or a broadcast (gated -- default admin/manager, see permissions.js).
router.post('/conversations', async (req, res) => {
  try {
    const sup = getSupabase();
    const userId = req.user.id;
    const { type, participant_ids, title } = req.body;
    if (!['dm', 'group', 'broadcast'].includes(type)) return res.status(400).json({ error: 'type غير صالح' });

    if (type === 'broadcast') {
      if (!(await hasPermission(sup, req.user, 'internal_messages', 'broadcast'))) {
        return res.status(403).json({ error: 'Forbidden — لا تملك صلاحية إنشاء قناة بث' });
      }
      if (!title?.trim()) return res.status(400).json({ error: 'عنوان القناة مطلوب' });
      const { data: created, error } = await sup.from('internal_conversations')
        .insert({ type: 'broadcast', title: title.trim(), created_by: userId }).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ success: true, data: { id: created.id, type: 'broadcast', title: created.title } });
    }

    const ids = [...new Set((participant_ids || []).map(id => parseInt(id)).filter(Number.isFinite))];
    if (!ids.length) return res.status(400).json({ error: 'participant_ids مطلوب' });

    if (type === 'dm') {
      if (ids.length !== 1) return res.status(400).json({ error: 'محادثة خاصة تحتاج شخص واحد بالضبط' });
      const otherId = ids[0];
      if (otherId === userId) return res.status(400).json({ error: 'لا يمكن بدء محادثة مع نفسك' });

      // Deterministic pair key + a real DB unique constraint
      // (migrations/044) instead of a select-then-insert race: two
      // near-simultaneous requests from the same pair used to be able to
      // both miss each other's in-flight insert and create two separate dm
      // conversations for the same two people, silently splitting their
      // message history. Postgres serializes concurrent upserts against the
      // same unique key, so only one row can ever exist for this pair.
      const pairKey = [userId, otherId].sort((a, b) => a - b).join('-');
      const { error: upsertErr } = await sup.from('internal_conversations')
        .upsert({ type: 'dm', dm_pair_key: pairKey, created_by: userId }, { onConflict: 'dm_pair_key', ignoreDuplicates: true });
      if (upsertErr) return res.status(400).json({ error: upsertErr.message });

      const { data: conv, error: fetchErr } = await sup.from('internal_conversations').select('id').eq('dm_pair_key', pairKey).single();
      if (fetchErr || !conv) return res.status(500).json({ error: fetchErr?.message || 'فشل إنشاء المحادثة' });

      // Participants: same idea -- insert if missing, ignore if the other
      // request already created them (unique (conversation_id, user_id)).
      await sup.from('internal_conversation_participants')
        .upsert([{ conversation_id: conv.id, user_id: userId }, { conversation_id: conv.id, user_id: otherId }],
          { onConflict: 'conversation_id,user_id', ignoreDuplicates: true });

      return res.json({ success: true, data: { id: conv.id, type: 'dm' } });
    }

    // group
    if (!title?.trim()) return res.status(400).json({ error: 'عنوان المجموعة مطلوب' });
    const { data: created, error } = await sup.from('internal_conversations')
      .insert({ type: 'group', title: title.trim(), created_by: userId }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    const allIds = [...new Set([userId, ...ids])];
    const { error: partErr } = await sup.from('internal_conversation_participants')
      .insert(allIds.map(uid => ({ conversation_id: created.id, user_id: uid })));
    if (partErr) return res.status(400).json({ error: partErr.message });
    res.json({ success: true, data: { id: created.id, type: 'group', title: created.title } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/conversations/:id/messages
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const sup = getSupabase();
    const conversationId = parseInt(req.params.id);
    const access = await assertParticipant(sup, conversationId, req.user.id);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const { data: rows, error } = await sup.from('internal_messages')
      .select(`*, users!sender_id!left(name)`).eq('conversation_id', conversationId)
      .order('created_at', { ascending: false }).limit(200);
    if (error) return res.status(400).json({ error: error.message });
    // newest 200 (a long thread used to show only its FIRST 200 forever), shown oldest-first
    if (rows) rows.reverse();

    // Read-receipt: the EARLIEST last_read_at among every OTHER participant
    // -- a message is "read by all" only once every other participant's own
    // last_read_at has passed it, matching common chat-app ✓✓ semantics
    // (for a dm, "every other participant" is just the one other person).
    // Broadcast has no participant rows at all, so read receipts don't apply
    // there -- readThreshold stays null and every message reports unread.
    let readThreshold = null;
    if (access.conv.type !== 'broadcast') {
      const { data: others } = await sup.from('internal_conversation_participants')
        .select('last_read_at').eq('conversation_id', conversationId).neq('user_id', req.user.id);
      const readTimes = (others || []).map(o => o.last_read_at).filter(Boolean);
      if (readTimes.length && readTimes.length === (others || []).length) {
        readThreshold = readTimes.reduce((min, t) => (new Date(t) < new Date(min) ? t : min));
      }
    }

    const mapped = (rows || []).map(m => ({
      ...m, sender_name: m.users?.name || null, users: undefined,
      read_by_all: m.sender_id === req.user.id && !!readThreshold && new Date(m.created_at) <= new Date(readThreshold),
    }));
    res.json({ success: true, data: mapped });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/conversations/:id/messages
router.post('/conversations/:id/messages', async (req, res) => {
  try {
    const sup = getSupabase();
    const conversationId = parseInt(req.params.id);
    const { content, via_ai, draft_token } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'content مطلوب' });
    if (content.length > 4000) return res.status(400).json({ error: 'الرسالة طويلة جدًا (الحد الأقصى 4000 حرف)' });
    const trimmedContent = content.trim();

    const access = await assertParticipant(sup, conversationId, req.user.id);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    if (access.conv.type === 'broadcast' && !(await hasPermission(sup, req.user, 'internal_messages', 'broadcast'))) {
      return res.status(403).json({ error: 'Forbidden — لا تملك صلاحية النشر في قناة البث' });
    }

    // `via_ai` is otherwise a plain client-supplied boolean -- anyone could
    // label an arbitrarily-typed message as "sent via the AI assistant" (or
    // hide a real one) with nothing to verify it. Only keep the marker if
    // the client also presents the single-use token draftMessageToEmployee
    // registered for this exact (confirming human, recipient, text) triple.
    // Downgrades silently rather than rejecting the send outright -- a
    // mismatched/missing/expired token should never block a real message,
    // only its "via AI" label.
    let confirmedViaAi = false;
    if (via_ai && access.conv.type === 'dm') {
      const { data: others } = await sup.from('internal_conversation_participants')
        .select('user_id').eq('conversation_id', conversationId).neq('user_id', req.user.id);
      const recipientId = others?.[0]?.user_id;
      if (recipientId) confirmedViaAi = aiDraftRegistry.consume(draft_token, req.user.id, recipientId, trimmedContent);
    }

    const { data: created, error } = await sup.from('internal_messages')
      .insert({ conversation_id: conversationId, sender_id: req.user.id, content: trimmedContent, via_ai: confirmedViaAi })
      .select().single();
    if (error) return res.status(400).json({ error: error.message });

    // Deliberately NOT fanned out through the shared `notifications` bell --
    // the user asked for internal messages to have their OWN independent
    // notification surface (a dedicated badge, see GET /conversations/
    // unread-count and Topbar.jsx's own messages icon), not a duplicate
    // entry alongside every other system alert in the same bell/list.

    res.json({ success: true, data: { ...created, sender_name: req.user.name } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/conversations/schedule-message -- the "جدولة" counterpart to the
// immediate-send route above, confirmed from a draft_message_to_employee
// (aiTools.js) draft that carried a send_at. Deliberately does NOT create/
// touch any internal_conversations row here -- only records the intent
// (ai_scheduled_messages, migration 051); the per-minute cron
// (deadlineChecker.js's sendDueScheduledMessages) creates/reuses the dm and
// inserts the real message once send_at actually arrives. Same single-use
// draft_token verification as the immediate-send path -- whichever action
// (send now vs schedule) the confirming human clicks first consumes it.
router.post('/conversations/schedule-message', async (req, res) => {
  try {
    const sup = getSupabase();
    const { recipient_id, content, send_at, draft_token } = req.body;
    const recipientId = parseInt(recipient_id);
    if (!recipientId) return res.status(400).json({ error: 'recipient_id مطلوب' });
    if (!content?.trim()) return res.status(400).json({ error: 'content مطلوب' });
    if (content.length > 4000) return res.status(400).json({ error: 'الرسالة طويلة جدًا (الحد الأقصى 4000 حرف)' });
    const trimmedContent = content.trim();

    const sendAtDate = new Date(send_at);
    if (isNaN(sendAtDate.getTime()) || sendAtDate.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'send_at يجب أن يكون وقتًا مستقبليًا فعليًا' });
    }

    // Unlike via_ai above (which downgrades silently on a bad token so a
    // real message is never blocked), a mismatched/expired/reused token here
    // means there is NO human-approved (recipient, content) pair to act
    // on at all -- this route's entire purpose is recording that approval,
    // so it must reject outright rather than schedule something nobody
    // actually confirmed.
    if (!aiDraftRegistry.consume(draft_token, req.user.id, recipientId, trimmedContent)) {
      return res.status(400).json({ error: 'انتهت صلاحية المسودة أو تم استخدامها بالفعل -- اطلب من المساعد صياغتها من جديد' });
    }

    const { data: recipient } = await sup.from('users').select('id').eq('id', recipientId).is('deleted_at', null).maybeSingle();
    if (!recipient) return res.status(404).json({ error: 'الموظف غير موجود' });

    const { data: created, error } = await sup.from('ai_scheduled_messages')
      .insert({ requested_by: req.user.id, recipient_id: recipientId, content: trimmedContent, send_at: sendAtDate.toISOString(), status: 'pending' })
      .select('id, send_at').single();
    if (error) return res.status(400).json({ error: /does not exist|could not find the table/i.test(error.message) ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (ai_scheduled_messages)' : error.message });
    res.json({ success: true, data: created });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/conversations/:id/read — mark a dm/group conversation read up to now.
router.put('/conversations/:id/read', async (req, res) => {
  try {
    const sup = getSupabase();
    const conversationId = parseInt(req.params.id);
    const { error } = await sup.from('internal_conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId).eq('user_id', req.user.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/conversations/presence?ids=1,2,3 — "is this user active right
// now", reusing the existing activity-heartbeat mechanism (activityTracking.js
// / useActivityHeartbeat.js) instead of building a whole new presence system.
// A user counts as online if today's row's last_heartbeat_at is within the
// last ONLINE_WINDOW_MS -- the frontend heartbeat flushes roughly every 60s
// while a tab is visible and the user isn't idle, and stops updating within
// ~4 minutes of real inactivity (see useActivityHeartbeat.js's own IDLE_MS),
// so this window has to comfortably cover one missed flush without reporting
// someone "offline" the instant they stop moving the mouse for a few seconds.
const ONLINE_WINDOW_MS = 3 * 60 * 1000;
router.get('/conversations/presence', async (req, res) => {
  try {
    const sup = getSupabase();
    // Capped -- an uncapped id list here is a cheap resource-exhaustion
    // vector (one request fanning out into an arbitrarily large IN() query)
    // for no real benefit, since the frontend only ever needs presence for
    // whichever employees/conversations are on screen at once.
    const ids = String(req.query.ids || '').split(',').map(s => parseInt(s)).filter(Number.isFinite).slice(0, 200);
    if (!ids.length) return res.json({ success: true, data: {} });
    const today = new Date().toISOString().split('T')[0];
    const { data: rows } = await sup.from('user_activity_time')
      .select('user_id, last_heartbeat_at').eq('date', today).in('user_id', ids);
    const cutoff = Date.now() - ONLINE_WINDOW_MS;
    const online = {};
    for (const id of ids) online[id] = false;
    for (const r of rows || []) {
      if (r.last_heartbeat_at && new Date(r.last_heartbeat_at).getTime() >= cutoff) online[r.user_id] = true;
    }
    res.json({ success: true, data: online });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
