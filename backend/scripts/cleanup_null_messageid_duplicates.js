#!/usr/bin/env node
/**
 * One-off cleanup: mailPoller's old dedup check (`.eq('message_id', null)`)
 * could never match existing NULL rows, so ~6 real emails with no
 * Message-ID header (Google security alerts, 2FA notices, etc.) got
 * re-inserted on every poll. This groups the null-message_id inbound
 * communications by (subject, sender, created_at) -- which is identical
 * across all copies of the same original message -- keeps the
 * lowest-id row per group, and deletes the rest.
 */
const { getSupabase } = require('../src/supabase');

async function fetchAllNullMessageIdRows(sup) {
  // Supabase/PostgREST caps unbounded selects at its project default (1000).
  // Paginate with .range() until a page comes back short.
  const PAGE = 1000;
  let all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sup
      .from('communications')
      .select('id, subject, sender, created_at')
      .eq('direction', 'inbound')
      .is('message_id', null)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function main() {
  const sup = getSupabase();
  const rows = await fetchAllNullMessageIdRows(sup);

  console.log(`Found ${rows.length} inbound rows with null message_id.`);

  const groups = new Map();
  for (const r of rows) {
    const key = `${r.subject}||${r.sender}||${r.created_at}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r.id);
  }

  let toDelete = [];
  for (const ids of groups.values()) {
    ids.sort((a, b) => a - b);
    toDelete.push(...ids.slice(1)); // keep the first (lowest id), delete the rest
  }

  console.log(`${groups.size} distinct messages, keeping 1 each, deleting ${toDelete.length} duplicate rows.`);

  // Delete in batches to stay well under any request size limits.
  const BATCH = 200;
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += BATCH) {
    const batch = toDelete.slice(i, i + BATCH);
    const { error: delErr } = await sup.from('communications').delete().in('id', batch);
    if (delErr) { console.error('Batch delete failed:', delErr.message); continue; }
    deleted += batch.length;
    console.log(`Deleted ${deleted}/${toDelete.length}...`);
  }

  const { count } = await sup.from('communications').select('id', { count: 'exact', head: true });
  console.log(`Done. Total communications remaining: ${count}`);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
