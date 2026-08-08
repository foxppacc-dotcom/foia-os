const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { getSupabase } = require('../supabase');
const { decrypt } = require('./crypto');
const storage = require('./storage');
const caseFileStorage = require('./caseFileStorage');

function guessFileType(filename) {
  const dotIdx = (filename || '').lastIndexOf('.');
  const ext = dotIdx >= 0 ? filename.slice(dotIdx).toLowerCase() : '';
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) return 'image';
  if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.ogg', '.flac'].includes(ext)) return 'audio';
  return 'document';
}

// Extract an agency-assigned reference/tracking number from an email's
// subject or body, e.g. "Reference Number: ABC-123", "Ref#: 456",
// "رقم مرجعي: ABC123", "رقم التتبع: 456". Matters most when the agency
// replies from a different address than the one on file -- the reference
// number they quote back is often the only reliable link to the case.
function extractReferenceNumber(text) {
  if (!text) return null;
  // Require either an explicit label keyword ("number"/"no") or at least one
  // hard punctuation separator (: # .) -- never just the bare word on its
  // own, or "a reference to X" would false-positive.
  const patterns = [
    /reference\s*(?:number|no)?\s*[:#\.]+\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,30})/i,
    /\bref\.?\s*(?:number|no)?\s*[:#\.]+\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,30})/i,
    /tracking\s*(?:number|no)?\s*[:#\.]+\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,30})/i,
    /(?:رقم\s*(?:مرجعي|المرجع|التتبع|الطلب))\s*[:#\.]?\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,30})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return null;
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
        // '1:*' pulled every message in the mailbox -- full source, every
        // poll, forever. Fine for a brand-new test inbox with a handful of
        // messages; on a real, actively-used mailbox (hundreds of emails)
        // this re-downloads and re-parses the entire history on every
        // single "جلب الإيميلات" click, which is slow enough to blow past
        // the platform's request timeout and looks like a hang with no
        // response at all. Only search for messages since the last
        // successful poll (or since the account was connected, for the
        // very first poll) -- IMAP SINCE is date-only, so a same-day
        // message can be re-seen once, but processMessages' dedup by
        // message_id already makes that safe.
        const since = account.last_checked ? new Date(account.last_checked)
          : account.created_at ? new Date(account.created_at)
          : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const uids = await client.search({ since }, { uid: true });

        if (uids && uids.length) {
          for await (const msg of client.fetch(uids, { uid: true, envelope: true, bodyStructure: true, source: true, flags: true }, { uid: true })) {
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
      let matchedRequestId = null;
      const extractedRefNumber = extractReferenceNumber(msg.subject) || extractReferenceNumber(msg.text);

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

      // 2b. By a case-specific communication channel's email -- an admin
      // can register an exact email address for a given (case, agency) pair
      // (see case_agency_channels, added from a case's الجهات tab), which is
      // a direct, unambiguous hit and takes priority over the generic
      // agency-level tiers below.
      if (!matchedCaseId && msg.from) {
        try {
          const { data: channel } = await sup.from('case_agency_channels').select('case_id, agency_id').eq('email', msg.from).maybeSingle();
          if (channel) { matchedCaseId = channel.case_id; matchedAgencyId = channel.agency_id; }
        } catch (e) { /* case_agency_channels may not exist yet */ }
      }

      // 2c. By a case-specific channel's filter keywords/phrases appearing
      // in the subject or body -- the last resort before falling back to
      // the broader agency-name/case-title heuristics below, since these
      // phrases were deliberately configured by a user for this exact
      // purpose rather than inferred.
      if (!matchedCaseId) {
        const haystack = `${msg.subject || ''} ${msg.text || ''}`.toLowerCase();
        if (haystack.trim()) {
          try {
            const { data: channels } = await sup.from('case_agency_channels').select('case_id, agency_id, filter_keywords').not('filter_keywords', 'is', null);
            for (const ch of channels || []) {
              const phrases = (ch.filter_keywords || '').split(/[,\n]+/).map(p => p.trim().toLowerCase()).filter(Boolean);
              if (phrases.some(p => haystack.includes(p))) { matchedCaseId = ch.case_id; matchedAgencyId = ch.agency_id; break; }
            }
          } catch (e) { /* case_agency_channels may not exist yet */ }
        }
      }

      // 3. By Agency Email -- the agency's own address, or any of its
      // individual contacts' emails (agency_contacts), since replies
      // legitimately come from a named person at the agency, not always
      // the generic address on file.
      if (!matchedCaseId && msg.from) {
        let agencyId = null;
        const { data: agency } = await sup.from('agencies').select('id').eq('email', msg.from).maybeSingle();
        if (agency) agencyId = agency.id;
        if (!agencyId) {
          try {
            const { data: contact } = await sup.from('agency_contacts').select('agency_id').eq('email', msg.from).maybeSingle();
            if (contact) agencyId = contact.agency_id;
          } catch (e) { /* agency_contacts may not exist in every environment */ }
        }
        if (agencyId) {
          // Find the most recent case for this agency
          const { data: recentReq } = await sup.from('requests').select('id, case_id').eq('agency_id', agencyId).order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (recentReq) { matchedCaseId = recentReq.case_id; matchedAgencyId = agencyId; matchedRequestId = recentReq.id; }
        }
      }

      // 4. By reference/tracking number the agency itself assigned and
      // quoted back -- this is what still works when the agency replies
      // from a completely different, previously-unknown address.
      if (!matchedCaseId && extractedRefNumber) {
        const { data: reqByRef } = await sup.from('requests').select('id, case_id, agency_id').eq('reference_number', extractedRefNumber).maybeSingle();
        if (reqByRef) { matchedCaseId = reqByRef.case_id; matchedAgencyId = reqByRef.agency_id; matchedRequestId = reqByRef.id; }
      }

      // 5. By case number in subject
      if (!matchedCaseId) {
        const caseMatch = msg.subject.match(/#(\d+)|Case[:\s]*(\d+)/i) || msg.text?.match(/#(\d+)|Case[:\s]*(\d+)/i);
        if (caseMatch) {
          const cid = parseInt(caseMatch[1] || caseMatch[2]);
          if (cid) { const { data: c } = await sup.from('cases').select('id').eq('id', cid).maybeSingle(); if (c) matchedCaseId = c.id; }
        }
      }

      // 6. By case title or defendant name appearing in the subject/body
      // (skip short/generic values -- too high a false-positive risk to
      // match on those). defendant_name is part of "معلومات تسجيل القضية"
      // recorded at case creation specifically so it can double as an
      // email-matching signal, same purpose as case_agency_channels'
      // filter_keywords.
      if (!matchedCaseId) {
        const haystackLower = `${msg.subject || ''} ${msg.text || ''}`.toLowerCase();
        if (haystackLower.trim()) {
          const { data: openCases } = await sup.from('cases').select('id, title, defendant_name').in('status', ['open', 'in_progress']);
          const match = (openCases || []).find(c =>
            (c.title && c.title.trim().length > 6 && haystackLower.includes(c.title.trim().toLowerCase())) ||
            (c.defendant_name && c.defendant_name.trim().length > 3 && haystackLower.includes(c.defendant_name.trim().toLowerCase()))
          );
          if (match) matchedCaseId = match.id;
        }
      }

      // 7. By the name of the agency actually linked to a case (via its
      // requests) appearing in the subject or body -- covers the case
      // where the agency's OWN name is quoted back even though the reply
      // came from a completely different, unlisted address, so tier 3
      // (agency email) never had a chance to fire.
      if (!matchedCaseId) {
        const haystack = `${msg.subject || ''} ${msg.text || ''}`.toLowerCase();
        if (haystack.trim()) {
          const { data: linkedAgencies } = await sup.from('requests')
            .select('case_id, cases!inner(status), agencies!inner(id, name_ar, name_en)')
            .in('cases.status', ['open', 'in_progress'])
            .limit(500);
          const match = (linkedAgencies || []).find(r => {
            const names = [r.agencies?.name_ar, r.agencies?.name_en].filter(n => n && n.trim().length > 6);
            return names.some(n => haystack.includes(n.trim().toLowerCase()));
          });
          if (match) { matchedCaseId = match.case_id; matchedAgencyId = match.agencies?.id || null; }
        }
      }

      // If a case matched but we don't yet know the specific request (tiers
      // 1/2/5/6 only resolve a case, not a request row), best-effort resolve
      // one so a newly-seen reference number below has somewhere to attach.
      if (matchedCaseId && !matchedRequestId) {
        let reqQuery = sup.from('requests').select('id').eq('case_id', matchedCaseId);
        if (matchedAgencyId) reqQuery = reqQuery.eq('agency_id', matchedAgencyId);
        const { data: anyReq } = await reqQuery.order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (anyReq) matchedRequestId = anyReq.id;
      }

      // Learn the agency's reference number for next time, so a later reply
      // from yet another unlisted address can still match via tier 4.
      if (matchedRequestId && extractedRefNumber) {
        const { data: reqRow } = await sup.from('requests').select('reference_number').eq('id', matchedRequestId).maybeSingle();
        if (reqRow && !reqRow.reference_number) {
          const { error: refSaveErr } = await sup.from('requests').update({ reference_number: extractedRefNumber }).eq('id', matchedRequestId);
          if (refSaveErr) console.error('[mailPoller] reference_number save failed:', refSaveErr.message);
        }
      }

      // Persist attachment content to Google Drive (was previously uploaded
      // to Supabase Storage), and -- when the email matched a case -- also
      // register each one as a real Case Document so users find it in the
      // Files tab, not only buried in the email thread. Unmatched emails
      // have no case to file a Drive folder under, so their attachments
      // stay unpersisted (metadata only) rather than accumulating as
      // ownerless bytes in permanent storage.
      const storedAttachments = [];
      for (const att of msg.attachments) {
        if (!att.content) continue;
        if (!matchedCaseId) {
          storedAttachments.push({ filename: att.filename, size: att.size, mimeType: att.contentType, unmatched: true });
          continue;
        }
        try {
          const buffer = Buffer.from(att.content, 'base64');
          const driveFields = await caseFileStorage.saveCaseFile({
            caseId: matchedCaseId, buffer, fileName: att.filename, mimeType: att.contentType, category: 'incoming',
          });
          storedAttachments.push({ filename: att.filename, size: att.size, mimeType: att.contentType, driveFileId: driveFields.drive_file_id, viewUrl: driveFields.file_path });

          // Supabase-js resolves {data, error} rather than throwing on a
          // DB-level rejection -- must check `error` explicitly, a bare
          // try/catch around the await would not have caught it.
          const { error: docErr } = await sup.from('case_documents').insert({
            case_id: matchedCaseId,
            filename: att.filename, original_name: att.filename,
            mime_type: att.contentType, size: att.size,
            file_type: guessFileType(att.filename),
            source: 'email',
            ...driveFields, url: driveFields.file_path,
          });
          if (docErr) console.error(`[mailPoller] case_documents insert failed for "${att.filename}":`, docErr.message);
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
        // Which of our connected accounts this arrived through -- never set
        // before, so "filter by linked email" in Inbox.jsx would have shown
        // every fetched (inbound) message as unmatched to any account.
        email_account_id: accountId,
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
        // Advance the "since" cursor pollAccount reads next run -- without
        // this, every cron pass re-searched from the same stale timestamp
        // forever (never past the first successful poll's baseline).
        const { error: touchErr } = await sup.from('email_accounts').update({ last_checked: new Date().toISOString() }).eq('id', acct.id);
        if (touchErr) console.warn(`[mailPoller] failed to update last_checked for ${acct.email}:`, touchErr.message);
      } catch (e) {
        console.error(`IMAP error for ${acct.email}:`, e.message);
        errors.push({ account: acct.email, stage: 'connect', error: e.message });
      }
    }
    return { total, errors };
  }
}

module.exports = new MailPoller();
