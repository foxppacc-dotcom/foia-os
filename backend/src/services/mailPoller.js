const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { getSupabase } = require('../supabase');
const { decrypt } = require('./crypto');
const storage = require('./storage');

function guessFileType(filename) {
  const dotIdx = (filename || '').lastIndexOf('.');
  const ext = dotIdx >= 0 ? filename.slice(dotIdx).toLowerCase() : '';
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) return 'image';
  if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.ogg', '.flac'].includes(ext)) return 'audio';
  return 'document';
}

class MailPoller {
  constructor() {
    this.clients = new Map();
    this.messageIdCache = new Set();
    this.pollingIntervals = new Map();
  }

  async pollAccount(account) {
    const { decrypt } = require('./crypto');
    const imapPass = decrypt(account.imap_pass);

    const client = new ImapFlow({
      host: account.imap_host || 'imap.gmail.com',
      port: account.imap_port || 993,
      secure: true,
      auth: { user: account.imap_user || account.email, pass: imapPass },
      logger: false,
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      const messages = [];

      try {
        for await (const msg of client.fetch('1:*', { uid: true, envelope: true, bodyStructure: true, source: true, flags: true })) {
          const parsed = await simpleParser(msg.source);
          // Some messages (e.g. provider security-alert notices, some
          // webmail-composed replies) arrive with no Message-ID header at
          // all. Falling back to `null` here breaks dedup permanently --
          // `.eq('message_id', null)` never matches an existing NULL row in
          // SQL (NULL is never equal to NULL), so a message like this gets
          // re-inserted as a fresh "new" communication on every single poll,
          // forever. Fall back to a synthetic ID keyed on account+UID, which
          // is stable across polls of the same mailbox.
          const messageId = parsed.messageId || msg.envelope.messageId || `imap-${account.id}-${msg.uid}`;
          messages.push({
            messageId,
            inReplyTo: parsed.inReplyTo || '',
            references: Array.isArray(parsed.references) ? parsed.references.join(' ') : (parsed.references || ''),
            from: parsed.from?.value?.[0]?.address || '',
            to: parsed.to?.value?.[0]?.address || '',
            cc: (parsed.cc?.value || []).map(v => v.address).join(', '),
            subject: parsed.subject || '(بدون موضوع)',
            text: parsed.text || parsed.html || '',
            html: parsed.html || '',
            date: parsed.date || new Date(),
            attachments: parsed.attachments?.map(a => ({
              filename: a.filename, contentType: a.contentType, size: a.size,
              content: a.content?.toString('base64') || '',
            })) || [],
            uid: msg.uid,
            flags: msg.flags || [],
          });
          this.messageIdCache.add(messageId);
        }
      } finally { lock.release(); }
      await client.logout();

      return messages;
    } catch (err) {
      // Previously swallowed here and returned [] -- meaning a connection
      // drop or a timeout partway through fetching every message's full
      // source (45 messages x full body, every single poll) looked
      // identical to "genuinely no new mail" to every caller. Let it
      // propagate so pollAll's per-account error collection (and any other
      // caller's try/catch) actually sees what happened.
      console.error(`IMAP poll error for ${account.email}:`, err.message);
      try { await client.logout(); } catch {}
      throw err;
    }
  }

  async processMessages(accountId, messages, forceCaseId = null) {
    const sup = getSupabase();
    let newCount = 0;
    const errors = [];

    for (const msg of messages) {
     try {
      // Check for duplicate via messageId
      const { data: existing } = await sup.from('communications').select('id').eq('message_id', msg.messageId).maybeSingle();
      if (existing) continue;

      // Auto-matching
      let matchedCaseId = forceCaseId || null;
      let matchedAgencyId = null;

      // 1. By Message-ID (already sent from this system)
      if (!matchedCaseId && msg.inReplyTo) {
        const { data: ref } = await sup.from('communications').select('case_id, agency_id').eq('thread_id', msg.inReplyTo).maybeSingle();
        if (ref) { matchedCaseId = ref.case_id; matchedAgencyId = ref.agency_id; }
      }

      // 2. By References
      if (!matchedCaseId && msg.references) {
        const refs = msg.references.split(/[,\s]+/).filter(Boolean);
        for (const ref of refs) {
          const { data: refComm } = await sup.from('communications').select('case_id, agency_id').eq('thread_id', ref).maybeSingle();
          if (refComm) { matchedCaseId = refComm.case_id; matchedAgencyId = refComm.agency_id; break; }
        }
      }

      // 3. By Agency Email
      if (!matchedCaseId && msg.from) {
        const { data: agency } = await sup.from('agencies').select('id').eq('email', msg.from).maybeSingle();
        if (agency) {
          // Find the most recent case for this agency
          const { data: recentReq } = await sup.from('requests').select('case_id').eq('agency_id', agency.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (recentReq) { matchedCaseId = recentReq.case_id; matchedAgencyId = agency.id; }
        }
      }

      // 4. By case number in subject
      if (!matchedCaseId) {
        const caseMatch = msg.subject.match(/#(\d+)|Case[:\s]*(\d+)/i) || msg.text?.match(/#(\d+)|Case[:\s]*(\d+)/i);
        if (caseMatch) {
          const cid = parseInt(caseMatch[1] || caseMatch[2]);
          if (cid) { const { data: c } = await sup.from('cases').select('id').eq('id', cid).maybeSingle(); if (c) matchedCaseId = c.id; }
        }
      }

      // Persist attachment content to Supabase Storage (was previously
      // discarded after just counting them), and -- when the email matched a
      // case -- also register each one as a real Case Document so users
      // find it in the Files tab, not only buried in the email thread.
      const storedAttachments = [];
      for (const att of msg.attachments) {
        if (!att.content) continue;
        try {
          const buffer = Buffer.from(att.content, 'base64');
          const subdir = matchedCaseId ? `case_${matchedCaseId}/email` : 'unmatched_email';
          const ext = att.filename?.includes('.') ? att.filename.slice(att.filename.lastIndexOf('.')) : '';
          const storagePath = `${subdir}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
          const storageKey = await storage.upload('case-documents', storagePath, buffer, att.contentType);
          storedAttachments.push({ filename: att.filename, size: att.size, mimeType: att.contentType, storageKey });

          if (matchedCaseId) {
            await sup.from('case_documents').insert({
              case_id: matchedCaseId,
              filename: att.filename, original_name: att.filename,
              mime_type: att.contentType, size: att.size,
              file_path: storageKey, storage_key: storageKey,
              file_type: guessFileType(att.filename),
            }).catch(e => console.error(`[mailPoller] case_documents insert failed for "${att.filename}":`, e.message));
          }
        } catch (e) {
          console.error(`[mailPoller] attachment upload failed for "${att.filename}":`, e.message);
          storedAttachments.push({ filename: att.filename, size: att.size, mimeType: att.contentType, error: e.message });
        }
      }

      // Insert communication record
      const insertData = {
        type: 'email', direction: 'inbound',
        sender: msg.from, recipient: msg.to,
        subject: msg.subject, body: msg.text || msg.html,
        message_id: msg.messageId,
        thread_id: msg.inReplyTo || msg.messageId,
        created_at: msg.date.toISOString(),
        is_read: false,
        metadata: JSON.stringify({ attachments: storedAttachments, flags: msg.flags, cc: msg.cc || '' }),
      };
      if (matchedCaseId) insertData.case_id = matchedCaseId;
      if (matchedAgencyId) insertData.agency_id = matchedAgencyId;

      const { error: insertError } = await sup.from('communications').insert(insertData);
      if (insertError) {
        console.error(`[mailPoller] communications insert failed for "${msg.subject}":`, insertError.message);
        errors.push({ subject: msg.subject, messageId: msg.messageId, stage: 'insert', error: insertError.message });
        continue; // do not count a failed insert as a new message
      }
      newCount++;

      // Create timeline event + notify assignees for matched emails
      if (matchedCaseId) {
        try {
          await sup.from('activity_logs').insert({
            action_type: 'email_received',
            target_type: 'case',
            target_id: matchedCaseId,
            target_title: `📩 ${msg.subject}`,
            user_name: msg.from,
            created_at: msg.date.toISOString(),
          });
        } catch (e) { console.error(`[mailPoller] activity_logs insert failed for case ${matchedCaseId}:`, e.message); }

        try {
          await this.notifyCaseUsers(sup, matchedCaseId, msg.subject, msg.from);
        } catch (e) { console.error(`[mailPoller] notifyCaseUsers failed for case ${matchedCaseId}:`, e.message); }
      }
     } catch (e) {
       // One bad message must not abort the rest of the batch.
       console.error(`[mailPoller] failed to process message "${msg.subject}":`, e.message);
       errors.push({ subject: msg.subject, messageId: msg.messageId, stage: 'process', error: e.message });
     }
    }

    return { count: newCount, errors };
  }

  async notifyCaseUsers(sup, caseId, subject, from) {
    const { data: assignees } = await sup.from('case_assignees').select('user_id').eq('case_id', caseId);
    const { data: caseRow } = await sup.from('cases').select('created_by').eq('id', caseId).maybeSingle();
    const userIds = new Set((assignees || []).map(a => a.user_id));
    if (caseRow?.created_by) userIds.add(caseRow.created_by);
    for (const userId of userIds) {
      try {
        await sup.from('notifications').insert({
          user_id: userId,
          type: 'email_received',
          title: '📩 رد جديد من جهة',
          body: `${from}: ${subject}`,
        });
      } catch (e) { console.error(`[mailPoller] notification insert failed for user ${userId}:`, e.message); }
    }
  }

  async pollAll() {
    const sup = getSupabase();
    // is_active is stored as INTEGER (1/0), not boolean -- .eq('is_active',
    // true) silently returned zero rows every single time (PostgREST/Postgres
    // does not coerce integer 1 == boolean true), which pollAll never checked
    // (no `error` destructured here either). Every poll therefore iterated
    // over zero accounts and reported newMessages: 0 with no error at all,
    // identical to "genuinely nothing new" -- this is why a real message
    // sitting in INBOX never got fetched no matter how many times "Fetch
    // Emails" was clicked. Filtering in JS avoids the fragile type match.
    const { data: allAccounts, error: acctError } = await sup.from('email_accounts').select('*');
    if (acctError) console.error('[mailPoller] failed to load email_accounts:', acctError.message);
    const accounts = (allAccounts || []).filter(a => a.is_active === true || a.is_active === 1);
    let total = 0;
    const errors = [];
    for (const acct of accounts) {
      try {
        const messages = await this.pollAccount(acct);
        const { count, errors: msgErrors } = await this.processMessages(acct.id, messages);
        if (count > 0) console.log(`IMAP: ${count} new messages from ${acct.email}`);
        total += count;
        for (const e of msgErrors) errors.push({ account: acct.email, ...e });
      } catch (e) {
        console.error(`IMAP error for ${acct.email}:`, e.message);
        errors.push({ account: acct.email, stage: 'connect', error: e.message });
      }
    }
    return { total, errors };
  }
}

module.exports = new MailPoller();
