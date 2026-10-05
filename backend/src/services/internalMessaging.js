/**
 * Small helper extracted for the AI scheduled-message sender
 * (deadlineChecker.js's sendDueScheduledMessages) -- deliberately NOT a
 * refactor of the already-working, security-sensitive routes in
 * routes/messages.js (POST /conversations, POST /conversations/:id/messages
 * stay exactly as they are). Duplicates their small dm-pair logic instead of
 * risking a regression on a live, already-verified messaging path.
 */

// Same deterministic-pair-key + upsert pattern as POST /api/conversations'
// own dm branch (messages.js) -- Postgres serializes concurrent upserts
// against the same unique key (migrations/044), so this can't create a
// second dm thread for a pair that already has one.
async function getOrCreateDm(sup, userId, otherId) {
  const pairKey = [userId, otherId].sort((a, b) => a - b).join('-');
  await sup.from('internal_conversations').upsert(
    { type: 'dm', dm_pair_key: pairKey, created_by: userId }, { onConflict: 'dm_pair_key', ignoreDuplicates: true }
  );
  const { data: conv, error } = await sup.from('internal_conversations').select('id').eq('dm_pair_key', pairKey).single();
  if (error || !conv) throw new Error(error?.message || 'فشل إنشاء المحادثة');
  await sup.from('internal_conversation_participants').upsert(
    [{ conversation_id: conv.id, user_id: userId }, { conversation_id: conv.id, user_id: otherId }],
    { onConflict: 'conversation_id,user_id', ignoreDuplicates: true }
  );
  return conv.id;
}

async function insertMessage(sup, { conversationId, senderId, content, viaAi = false }) {
  const { error } = await sup.from('internal_messages').insert({ conversation_id: conversationId, sender_id: senderId, content, via_ai: viaAi });
  if (error) throw error;
}

module.exports = { getOrCreateDm, insertMessage };
