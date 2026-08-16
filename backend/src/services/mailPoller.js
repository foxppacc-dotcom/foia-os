const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { getSupabase } = require('../supabase');
const { decrypt } = require('./crypto');
const storage = require('./storage');
const caseFileStorage = require('./caseFileStorage');
const { notifyUsers, getCaseRecipients, getUsersWithPermission, getCaseActivityRecipients } = require('./notificationService');

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

// Local part (before @) that's too generic to mean "the same specific person
// or submission channel" -- excluded from the local-part-continuity tier
// below so "info@oldDomain.com" -> "info@newDomain.com" never false-matches
// just because both happen to be "info".
const GENERIC_LOCAL_PARTS = new Set([
  'info', 'support', 'contact', 'admin', 'administrator', 'noreply', 'no-reply', 'donotreply',
  'help', 'service', 'services', 'sales', 'hr', 'office', 'mail', 'webmaster', 'media', 'press',
  'legal', 'records', 'general', 'inquiries', 'inquiry', 'questions', 'team', 'notifications',
  'notification', 'foia', 'requests', 'records-request', 'clerk', 'frontdesk', 'reception',
]);

function emailLocalPart(email) {
  const at = (email || '').indexOf('@');
  return at > 0 ? email.slice(0, at).toLowerCase() : '';
}

function emailDomain(email) {
  const at = (email || '').indexOf('@');
  return at > 0 ? email.slice(at + 1).toLowerCase() : '';
}

function domainFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

// Strip spaces/dashes/underscores so "John Smith" also matches "JohnSmith",
// "john-smith", "john_smith" appearing in an email -- agencies and
// third-party senders often concatenate or reformat a name/agency string
// that was typed with spaces at case-registration time.
function normalizeForMatch(s) {
  return (s || '').toLowerCase().replace(/[\s\-_]+/g, '');
}

class MailPoller {
  constructor() {
    this.clients = new Map();
    this.messageIdCache = new Set();
    this.pollingIntervals = new Map();
  }

  async pollAccount(account, sinceOverride = null) {
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
        // sinceOverride lets the HTML-backfill pass (see backfillHtmlBodies
        // below) re-fetch further back than the normal incremental cursor,
        // without disturbing last_checked or the regular poll's window.
        const since = sinceOverride ? sinceOverride
          : account.last_checked ? new Date(account.last_checked)
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

  // The whole matching pipeline (tiers 1-7 + request/reference-number
  // resolution), extracted out of processMessages so it can also be
  // replayed on-demand against already-received, still-unlinked messages
  // via rescanUnmatched() below -- previously this only ever ran ONCE, at
  // the moment a message was first fetched. A channel/keyword/defendant
  // name added to a case AFTER an email already arrived could never
  // retroactively catch it; the email just sat unlinked forever.
  async matchToCase(sup, msg, forceCaseId = null) {
    let matchedCaseId = forceCaseId || null;
    let matchedAgencyId = null;
    let matchedRequestId = null;
    // Collected by any tier that finds more than one plausible case instead
    // of confidently picking one -- declared up front so both tier 3 below
    // and the fuzzy tiers further down share the same "don't guess, ask a
    // human" mechanism.
    let possibleMatches = [];
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

    // 2b2. By the domain of a case's registered portal link -- "بيانات
    // تسجيل تقديم عبر البوابة" is part of what a case is registered with, so
    // an email from that same portal's domain (e.g. a notification/reply
    // sent by the portal itself) is a direct signal even with no exact
    // address on file.
    if (!matchedCaseId && msg.from) {
      const senderDomain = emailDomain(msg.from);
      if (senderDomain) {
        try {
          const { data: channels } = await sup.from('case_agency_channels').select('case_id, agency_id, portal_link').not('portal_link', 'is', null);
          const match = (channels || []).find(ch => domainFromUrl(ch.portal_link) === senderDomain);
          if (match) { matchedCaseId = match.case_id; matchedAgencyId = match.agency_id; }
        } catch (e) { /* case_agency_channels may not exist yet */ }
      }
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
        // An agency can have more than one active case going through this
        // platform at once -- blindly taking whichever request row happens
        // to be newest was a deterministic mis-link whenever that's true
        // (a reply plainly about an older case still got auto-linked to a
        // newer, unrelated one). Only auto-link when the agency's requests
        // all point to the SAME case; otherwise defer to the same
        // human-review mechanism the fuzzy tiers below use instead of
        // guessing.
        const { data: agencyReqs } = await sup.from('requests').select('id, case_id, created_at').eq('agency_id', agencyId).order('created_at', { ascending: false });
        const distinctCaseIds = [...new Set((agencyReqs || []).map(r => r.case_id))];
        if (distinctCaseIds.length === 1) {
          matchedAgencyId = agencyId;
          matchedCaseId = distinctCaseIds[0];
          matchedRequestId = agencyReqs[0].id;
        } else if (distinctCaseIds.length > 1) {
          const { data: agencyRow } = await sup.from('agencies').select('name_ar, name_en').eq('id', agencyId).maybeSingle();
          const agencyName = agencyRow?.name_ar || agencyRow?.name_en || `جهة #${agencyId}`;
          for (const caseId of distinctCaseIds) {
            possibleMatches.push({ caseId, reasons: [`نفس الجهة (${agencyName}) لديها أكثر من قضية مفتوحة`] });
          }
        }
      }
    }

    // 4. By reference/tracking number the agency itself assigned and
    // quoted back -- this is what still works when the agency replies
    // from a completely different, previously-unknown address. Also
    // covers a portal-submitted confirmation number saved on the request
    // (case_agency_channels' portal_link flow) getting quoted back.
    if (!matchedCaseId && extractedRefNumber) {
      const { data: reqByRef } = await sup.from('requests').select('id, case_id, agency_id').eq('reference_number', extractedRefNumber).maybeSingle();
      if (reqByRef) { matchedCaseId = reqByRef.case_id; matchedAgencyId = reqByRef.agency_id; matchedRequestId = reqByRef.id; }
    }

    // 5. By case number in subject
    if (!matchedCaseId) {
      const caseMatch = (msg.subject || '').match(/#(\d+)|Case[:\s]*(\d+)/i) || msg.text?.match(/#(\d+)|Case[:\s]*(\d+)/i);
      if (caseMatch) {
        const cid = parseInt(caseMatch[1] || caseMatch[2]);
        if (cid) { const { data: c } = await sup.from('cases').select('id').eq('id', cid).maybeSingle(); if (c) matchedCaseId = c.id; }
      }
    }

    // 6/7/8. Fuzzy signals -- case title, defendant name, or source agency
    // name (raw AND normalized with spaces/dashes/underscores stripped, so
    // "John Smith" also catches "JohnSmith"/"john-smith"), the linked
    // agency's own name, and local-part continuity (same "username@" across
    // a domain change, e.g. an agency contact switching mail providers but
    // keeping their mailbox name -- excludes generic local parts like
    // info/support since those repeat across unrelated senders).
    //
    // Unlike the short-circuit tiers above, these are the ones actually
    // prone to matching more than one plausible case (a shared defendant
    // surname, a generic agency word). Rather than silently picking
    // whichever case happened to be found first, every distinct case any
    // fuzzy signal points to is collected. Exactly one candidate -> assign
    // it, same as before. More than one -> leave case_id unset and record
    // every candidate + its reason as `possibleMatches`, so a human resolves
    // the ambiguity instead of the system guessing and risking a wrong,
    // silent auto-link. Skipped entirely if tier 3 above already populated
    // possibleMatches (agency-level ambiguity) -- that's already a genuine
    // signal to defer to a human; no need to layer a second, unrelated
    // ambiguity source on top of it.
    if (!matchedCaseId && possibleMatches.length === 0) {
      const haystackLower = `${msg.subject || ''} ${msg.text || ''}`.toLowerCase();
      const haystackNorm = normalizeForMatch(haystackLower);
      const candidates = new Map(); // caseId -> { agencyId, reasons: [] }
      const addCandidate = (caseId, agencyId, reason) => {
        if (!caseId) return;
        if (!candidates.has(caseId)) candidates.set(caseId, { agencyId: agencyId || null, reasons: [] });
        const c = candidates.get(caseId);
        if (!c.agencyId && agencyId) c.agencyId = agencyId;
        if (!c.reasons.includes(reason)) c.reasons.push(reason);
      };

      if (haystackLower.trim()) {
        const { data: openCases } = await sup.from('cases').select('id, title, defendant_name, source_agency_name').in('status', ['open', 'in_progress']);
        for (const c of openCases || []) {
          if (c.title && c.title.trim().length > 6) {
            const t = c.title.trim().toLowerCase();
            if (haystackLower.includes(t) || haystackNorm.includes(normalizeForMatch(t))) addCandidate(c.id, null, `عنوان القضية: ${c.title}`);
          }
          if (c.defendant_name && c.defendant_name.trim().length > 3) {
            const d = c.defendant_name.trim().toLowerCase();
            if (haystackLower.includes(d) || haystackNorm.includes(normalizeForMatch(d))) addCandidate(c.id, null, `اسم المتهم: ${c.defendant_name}`);
          }
          if (c.source_agency_name && c.source_agency_name.trim().length > 3) {
            const s = c.source_agency_name.trim().toLowerCase();
            if (haystackLower.includes(s) || haystackNorm.includes(normalizeForMatch(s))) addCandidate(c.id, null, `الجهة المصدر: ${c.source_agency_name}`);
          }
        }

        const { data: linkedAgencies } = await sup.from('requests')
          .select('case_id, cases!inner(status), agencies!inner(id, name_ar, name_en)')
          .in('cases.status', ['open', 'in_progress'])
          .limit(500);
        for (const r of linkedAgencies || []) {
          const names = [r.agencies?.name_ar, r.agencies?.name_en].filter(n => n && n.trim().length > 6);
          for (const n of names) {
            const nl = n.trim().toLowerCase();
            if (haystackLower.includes(nl) || haystackNorm.includes(normalizeForMatch(nl))) addCandidate(r.case_id, r.agencies?.id, `اسم الجهة: ${n}`);
          }
        }
      }

      const senderLocal = emailLocalPart(msg.from);
      if (senderLocal && !GENERIC_LOCAL_PARTS.has(senderLocal)) {
        const { data: pastComms } = await sup.from('communications')
          .select('case_id, sender')
          .not('case_id', 'is', null).eq('direction', 'inbound')
          .order('created_at', { ascending: false }).limit(2000);
        const seenCases = new Set();
        for (const row of pastComms || []) {
          if (seenCases.has(row.case_id)) continue;
          if (emailLocalPart(row.sender) === senderLocal && emailDomain(row.sender) !== emailDomain(msg.from)) {
            addCandidate(row.case_id, null, `نفس اسم المرسل (${senderLocal}@) من نطاق مختلف`);
            seenCases.add(row.case_id);
          }
        }
      }

      const candidateIds = [...candidates.keys()];
      if (candidateIds.length === 1) {
        matchedCaseId = candidateIds[0];
        matchedAgencyId = candidates.get(matchedCaseId).agencyId;
      } else if (candidateIds.length > 1) {
        possibleMatches = candidateIds.map(id => ({ caseId: id, reasons: candidates.get(id).reasons }));
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

    return { matchedCaseId, matchedAgencyId, matchedRequestId, possibleMatches };
  }

  // Re-run the matching pipeline against messages that are STILL unlinked
  // (case_id null) from a past ingestion -- the fix for "I just added a
  // filter keyword/channel to a case, but the email that already arrived
  // before I set it up never got linked." Bounded to the last `sinceDays`
  // so this can't balloon into scanning the entire table's history.
  async rescanUnmatched(sinceDays = 60) {
    const sup = getSupabase();
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
    const { data: candidates, error } = await sup.from('communications')
      .select('id, subject, body, sender, thread_id, message_id, metadata')
      .is('case_id', null).eq('direction', 'inbound')
      .gte('created_at', since);
    if (error) { console.error('[mailPoller] rescanUnmatched failed to load candidates:', error.message); return { scanned: 0, linked: 0, ambiguous: 0 }; }

    let linked = 0;
    let ambiguous = 0;
    for (const row of candidates || []) {
      try {
        // The raw In-Reply-To/References headers aren't persisted per-row --
        // only the single resolved thread_id is (see pollAccount's insert,
        // where thread_id = msg.inReplyTo || msg.messageId). A thread_id that
        // differs from the row's own message_id means it WAS a reply, so
        // reuse it as the inReplyTo signal for tier 1; there's no equivalent
        // for tier 2 (References) on already-stored rows.
        const wasReply = row.thread_id && row.thread_id !== row.message_id;
        const { matchedCaseId, matchedAgencyId, matchedRequestId, possibleMatches } = await this.matchToCase(sup, {
          subject: row.subject, text: row.body, from: row.sender,
          inReplyTo: wasReply ? row.thread_id : null, references: null,
        });
        if (!matchedCaseId) {
          // Not a confident match, but if the fuzzy tiers found more than
          // one plausible case, save that as a hint on the row's metadata
          // (rather than silently doing nothing) so the user can review and
          // manually link it from whichever candidate is actually correct.
          if (possibleMatches && possibleMatches.length) {
            let meta = {};
            try { meta = row.metadata ? JSON.parse(row.metadata) : {}; } catch { meta = {}; }
            meta.possible_matches = possibleMatches;
            const { error: metaErr } = await sup.from('communications').update({ metadata: JSON.stringify(meta) }).eq('id', row.id);
            if (metaErr) console.error(`[mailPoller] rescanUnmatched: failed to save possible_matches for ${row.id}:`, metaErr.message);
            else ambiguous++;
          }
          continue;
        }
        const { error: updateErr } = await sup.from('communications').update({
          case_id: matchedCaseId, agency_id: matchedAgencyId, request_id: matchedRequestId,
        }).eq('id', row.id);
        if (updateErr) { console.error(`[mailPoller] rescanUnmatched: failed to link communication ${row.id}:`, updateErr.message); continue; }
        linked++;
      } catch (e) {
        console.error(`[mailPoller] rescanUnmatched: matching threw for communication ${row.id}:`, e.message);
      }
    }
    return { scanned: (candidates || []).length, linked, ambiguous };
  }

  async processMessages(accountId, messages, forceCaseId = null) {
    const sup = getSupabase();
    let newCount = 0;
    const errors = [];

    for (const msg of messages) {
     try {
      // Check for duplicate via messageId. Body-html backfill piggybacks on
      // this same dedup check: a message that's already stored (from before
      // body_html existed) but is re-fetched by a wider-window poll gets its
      // html filled in via an UPDATE rather than being silently skipped --
      // still not counted as new, still no notification, just enriched.
      const { data: existing } = await sup.from('communications').select('id, body_html').eq('message_id', msg.messageId).maybeSingle();
      if (existing) {
        if (!existing.body_html && msg.html) {
          const { error: backfillErr } = await sup.from('communications').update({ body_html: msg.html }).eq('id', existing.id);
          if (backfillErr) console.error(`[mailPoller] body_html backfill failed for message ${msg.messageId}:`, backfillErr.message);
        }
        continue;
      }

      const { matchedCaseId, matchedAgencyId, matchedRequestId, possibleMatches } = await this.matchToCase(sup, msg, forceCaseId);
      const extractedRefNumber = extractReferenceNumber(msg.subject) || extractReferenceNumber(msg.text);

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
        subject: msg.subject, body: msg.text || msg.html, body_html: msg.html || null,
        message_id: msg.messageId,
        thread_id: msg.inReplyTo || msg.messageId,
        created_at: msg.date.toISOString(),
        is_read: false,
        // Which of our connected accounts this arrived through -- never set
        // before, so "filter by linked email" in Inbox.jsx would have shown
        // every fetched (inbound) message as unmatched to any account.
        email_account_id: accountId,
        // possible_matches was previously only ever written by rescanUnmatched
        // -- a brand-new email landing straight in the ambiguous-fuzzy-match
        // tier got no "قد تشابه N قضية" hint at all until someone later
        // triggered a rescan; it just sat unlinked with no indication why.
        metadata: JSON.stringify({ attachments: storedAttachments, flags: msg.flags, cc: msg.cc || '', possible_matches: possibleMatches || [] }),
      };
      if (matchedCaseId) insertData.case_id = matchedCaseId;
      if (matchedAgencyId) insertData.agency_id = matchedAgencyId;
      // Tiers 3 (agency email) and 4 (reference number) resolve a specific
      // request row, not just a case -- this was being silently discarded
      // here (rescanUnmatched and the compose-reply path both already save
      // it), leaving request_id permanently NULL for anything matched
      // through the normal "جلب الإيميلات" flow.
      if (matchedRequestId) insertData.request_id = matchedRequestId;

      // migrations/026 (body_html) may not have been run yet in this
      // environment -- retry without it rather than losing the whole
      // message, same self-healing pattern used for case_comments/
      // case_documents inserts elsewhere in this codebase.
      let { error: insertError } = await sup.from('communications').insert(insertData);
      if (insertError && /body_html/.test(insertError.message)) {
        delete insertData.body_html;
        ({ error: insertError } = await sup.from('communications').insert(insertData));
      }
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
    // target_type/target_id were never set here before -- clicking this
    // notification in the bell couldn't navigate anywhere despite it being
    // tied to a specific case. Recipient resolution also now goes through
    // the shared helper instead of a third copy-pasted assignees∪created_by
    // query (see notificationService.js).
    const recipients = await getCaseActivityRecipients(sup, caseId);
    await notifyUsers(sup, recipients, {
      type: 'email_received', title: '📩 رد جديد من جهة', body: `${from}: ${subject}`,
      target_type: 'case', target_id: caseId,
    });
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
        // forever (never past the first successful poll's baseline). Only
        // when every message this pass actually processed cleanly: IMAP
        // SEARCH SINCE is day-granular, so once the cursor crosses past
        // today into tomorrow, anything dated today that failed to insert
        // (e.g. a transient DB error) would drop out of every future
        // search's range and never be retried. Message-ID dedup already
        // makes re-searching the same day free on a clean run.
        if (!msgErrors.length) {
          const { error: touchErr } = await sup.from('email_accounts').update({ last_checked: new Date().toISOString() }).eq('id', acct.id);
          if (touchErr) console.warn(`[mailPoller] failed to update last_checked for ${acct.email}:`, touchErr.message);
        } else {
          console.warn(`[mailPoller] not advancing last_checked for ${acct.email} -- ${msgErrors.length} message(s) failed to process`);
        }
      } catch (e) {
        console.error(`IMAP error for ${acct.email}:`, e.message);
        errors.push({ account: acct.email, stage: 'connect', error: e.message });
        // A broken mailbox (bad password, revoked app-password, connection
        // refused...) previously failed completely silently -- nothing told
        // anyone until a human noticed emails had stopped arriving. Notify
        // whoever can actually fix it (email_accounts manage permission),
        // not a hardcoded admin list, deduped to once per 20h per account so
        // a persistently broken mailbox doesn't spam on every cron tick or
        // manual "Fetch Emails" click.
        try {
          const { data: recent } = await sup.from('notifications').select('id')
            .eq('type', 'mailbox_error').eq('target_id', acct.id)
            .gte('created_at', new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()).maybeSingle();
          if (!recent) {
            const managers = await getUsersWithPermission(sup, 'email_accounts', 'manage');
            await notifyUsers(sup, managers, {
              type: 'mailbox_error', title: '⚠️ فشل الاتصال بحساب بريد', body: `${acct.email}: ${e.message}`,
              target_type: 'email_account', target_id: acct.id,
            });
          }
        } catch (notifyErr) { console.error('[mailPoller] mailbox_error notification failed:', notifyErr.message); }
      }
    }
    return { total, errors };
  }

  // One-time enrichment for emails that arrived BEFORE body_html existed --
  // these rows only ever got plain text (or, worse, an HTML-only message's
  // raw markup dumped into `body` as if it were text). The raw source
  // bytes were never persisted, so the only way to recover the real HTML is
  // to re-fetch each account's mailbox from just before its own earliest
  // still-missing message and let processMessages' dedup-by-message_id path
  // update those existing rows in place (see the `existing.body_html`
  // branch above) -- never inserts anything new, never re-notifies anyone.
  async backfillHtmlBodies() {
    const sup = getSupabase();
    const { data: allAccounts } = await sup.from('email_accounts').select('*');
    const accounts = (allAccounts || []).filter(a => a.is_active === true || a.is_active === 1);
    const results = [];

    for (const acct of accounts) {
      try {
        const { data: oldest } = await sup.from('communications')
          .select('created_at').eq('email_account_id', acct.id).eq('direction', 'inbound')
          .is('body_html', null).order('created_at', { ascending: true }).limit(1).maybeSingle();
        if (!oldest) { results.push({ account: acct.email, skipped: true, reason: 'nothing missing body_html' }); continue; }

        const since = new Date(new Date(oldest.created_at).getTime() - 24 * 60 * 60 * 1000);
        const messages = await this.pollAccount(acct, since);
        const before = await sup.from('communications').select('id', { count: 'exact', head: true })
          .eq('email_account_id', acct.id).eq('direction', 'inbound').is('body_html', null);
        await this.processMessages(acct.id, messages);
        const after = await sup.from('communications').select('id', { count: 'exact', head: true })
          .eq('email_account_id', acct.id).eq('direction', 'inbound').is('body_html', null);
        results.push({ account: acct.email, since: since.toISOString(), stillMissingBefore: before.count || 0, stillMissingAfter: after.count || 0 });
      } catch (e) {
        results.push({ account: acct.email, error: e.message });
      }
    }
    return results;
  }
}

module.exports = new MailPoller();
