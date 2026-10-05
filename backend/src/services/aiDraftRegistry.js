// Ephemeral, in-memory registry connecting an AI-drafted message
// (aiTools.js's draftMessageToEmployee) to the one human confirm-action
// allowed to actually mark a send as "via the AI assistant"
// (routes/messages.js). Without this, `via_ai` on POST
// /conversations/:id/messages was a plain client-supplied boolean -- any
// authenticated user could label an arbitrarily-typed message as sent via
// the assistant (or hide a real one) with nothing to stop them, undermining
// the one transparency signal this feature relies on.
//
// In-memory only, deliberately: this app runs as a single long-lived Node
// process on the VPS (not multiple serverless instances), so a registry
// that doesn't survive a restart or need cross-process sharing is the right
// scope for something this ephemeral -- a draft nobody confirmed within
// DRAFT_TTL_MS is simply forgotten, same as a suggestion in a chat window
// naturally going stale.
const DRAFT_TTL_MS = 15 * 60 * 1000;
const drafts = new Map(); // token -> { senderId, recipientId, content, expiresAt }

function register(senderId, recipientId, content) {
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  drafts.set(token, { senderId, recipientId, content, expiresAt: Date.now() + DRAFT_TTL_MS });
  return token;
}

// Single-use: consumes (deletes) the registered draft regardless of outcome,
// and returns true only if it existed, hadn't expired, and matches the exact
// sender/recipient/content it was registered with.
function consume(token, senderId, recipientId, content) {
  if (!token) return false;
  const d = drafts.get(token);
  drafts.delete(token);
  if (!d) return false;
  if (d.expiresAt < Date.now()) return false;
  return d.senderId === senderId && d.recipientId === recipientId && d.content === content;
}

// Periodic sweep so a never-confirmed draft doesn't sit in memory forever.
// unref() so this timer alone never keeps the process alive.
setInterval(() => {
  const now = Date.now();
  for (const [token, d] of drafts) if (d.expiresAt < now) drafts.delete(token);
}, 5 * 60 * 1000).unref();

module.exports = { register, consume };
