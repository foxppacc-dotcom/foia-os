const ImapFlow = require('imapflow');
const { simpleParser } = require('mailparser');
const { decrypt } = require('./crypto');

/**
 * Shared IMAP diagnostic + poll service.
 * Both the poller and the diagnostic endpoint use this.
 */
class ImapService {
  /**
   * Test IMAP credentials and mailbox access step by step.
   * Never masks errors — returns each stage separately.
   */
  async diagnose(account) {
    const report = { account: account.email, decrypt: null, connection: null, authentication: null, mailbox: null, search: null, fetch: null, overall: false };

    // Stage 1: Decrypt password
    try {
      if (!account.imap_pass) throw new Error('No IMAP password stored for this account');
      const pass = decrypt(account.imap_pass);
      if (!pass || pass.length < 2) throw new Error('Decrypted password is empty or too short');
      report.decrypt = { success: true, error: null };
    } catch (e) {
      report.decrypt = { success: false, error: e.message };
      report.overall = false;
      return report;
    }

    const imapPass = decrypt(account.imap_pass);
    const client = new ImapFlow({
      host: account.imap_host || 'imap.gmail.com',
      port: account.imap_port || 993,
      secure: true,
      auth: { user: account.imap_user || account.email, pass: imapPass },
      logger: false,
      verifyConnetion: true,
    });

    // Stage 2: Connection
    try {
      await client.connect();
      report.connection = { success: true, error: null };
    } catch (e) {
      report.connection = { success: false, error: e.message };
      report.overall = false;
      return report;
    }

    // Stage 3: Authentication (if connect() succeeded, auth passed — imapflow does it during connect)
    report.authentication = { success: true, error: null };

    // Stage 4: Mailbox selection
    try {
      const lock = await client.getMailboxLock('INBOX');
      report.mailbox = { success: true, folder: 'INBOX', exists: client.mailbox?.exists, unseen: client.mailbox?.unseen, error: null };
      
      // Stage 5: Search unseen
      try {
        // Count unseen messages
        const unseenCount = client.mailbox?.unseen || 0;
        report.search = { success: true, unseen: unseenCount, error: null };

        // Stage 6: Fetch messages
        try {
          const messages = [];
          for await (const msg of client.fetch('1:*', { uid: true, envelope: true, bodyStructure: true, source: true, flags: true })) {
            messages.push({ uid: msg.uid, subject: msg.envelope?.subject, flags: msg.flags, hasSource: !!msg.source });
            if (messages.length >= 10) break; // max 10 for diagnostic
          }
          report.fetch = { success: true, messagesInMailbox: client.mailbox?.exists || 0, messagesExamined: messages.length, firstSubject: messages[0]?.subject || null, error: null };
          report.overall = true;
        } catch (e) {
          report.fetch = { success: false, error: e.message };
        }
      } catch (e) {
        report.search = { success: false, error: e.message };
      } finally {
        lock.release();
      }
    } catch (e) {
      report.mailbox = { success: false, error: e.message };
    }

    try { await client.logout(); } catch {}
    return report;
  }

  /**
   * Poll one account for new inbound messages.
   * Returns count of new messages inserted.
   * Throws on connection/auth failure — caller decides how to handle.
   */
  async pollAccount(account) {
    const { getSupabase } = require('../supabase');
    const { decrypt } = require('./crypto');
    const sup = getSupabase();

    // Run diagnostic first — fail fast if IMAP is down
    const diag = await this.diagnose(account);
    if (!diag.overall) {
      const failedStage = Object.entries(diag).find(([k, v]) => v && typeof v === 'object' && v.success === false);
      throw new Error(`IMAP ${failedStage?.[0] || 'unknown'} failed: ${failedStage?.[1]?.error || 'unknown error'}`);
    }

    const imapPass = decrypt(account.imap_pass);
    const client = new ImapFlow({
      host: account.imap_host || 'imap.gmail.com',
      port: account.imap_port || 993,
      secure: true,
      auth: { user: account.imap_user || account.email, pass: imapPass },
      logger: false,
    });

    let newCount = 0;
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        for await (const msg of client.fetch('1:*', { uid: true, envelope: true, bodyStructure: true, source: true, flags: true })) {
          const parsed = await simpleParser(msg.source);

          // Check duplicate by messageId
          const { data: existing } = await sup.from('communications').select('id').eq('message_id', parsed.messageId || msg.envelope.messageId).maybeSingle();
          if (existing) continue;

          // Skip already-seen messages (seen flag)
          if (msg.flags?.includes('\\Seen')) continue;

          // Auto-matching
          let matchedCaseId = null;
          let matchedAgencyId = null;

          // 1. By In-Reply-To matching thread_id
          if (parsed.inReplyTo) {
            const { data: ref } = await sup.from('communications').select('case_id, agency_id').eq('thread_id', parsed.inReplyTo).maybeSingle();
            if (ref) { matchedCaseId = ref.case_id; matchedAgencyId = ref.agency_id; }
          }

          // 2. By References
          if (!matchedCaseId && parsed.references) {
            const refs = parsed.references.split(/[,\s]+/).filter(Boolean);
            for (const ref of refs) {
              const { data: refComm } = await sup.from('communications').select('case_id, agency_id').eq('thread_id', ref).maybeSingle();
              if (refComm) { matchedCaseId = refComm.case_id; matchedAgencyId = refComm.agency_id; break; }
            }
          }

          // 3. By Agency Email
          if (!matchedCaseId && parsed.from?.value?.[0]?.address) {
            const fromEmail = parsed.from.value[0].address;
            const { data: agency } = await sup.from('agencies').select('id').eq('email', fromEmail).maybeSingle();
            if (agency) {
              const { data: recentReq } = await sup.from('requests').select('case_id').eq('agency_id', agency.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
              if (recentReq) { matchedCaseId = recentReq.case_id; matchedAgencyId = agency.id; }
            }
          }

          // 4. By Contact Email
          if (!matchedCaseId && parsed.from?.value?.[0]?.address) {
            const fromEmail = parsed.from.value[0].address;
            const { data: contacts } = await sup.from('agencies').select('id, notes, name_en').neq('notes', null);
            for (const a of contacts || []) {
              try {
                const notes = typeof a.notes === 'string' ? JSON.parse(a.notes) : a.notes;
                const contactsArr = notes?._contacts || [];
                if (contactsArr.some(c => c.email?.toLowerCase() === fromEmail.toLowerCase())) {
                  const { data: recentReq } = await sup.from('requests').select('case_id').eq('agency_id', a.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
                  if (recentReq) { matchedCaseId = recentReq.case_id; matchedAgencyId = a.id; break; }
                }
              } catch {}
            }
          }

          // 5. By case number in subject
          if (!matchedCaseId) {
            const subject = parsed.subject || '';
            const body = parsed.text || '';
            const caseMatch = subject.match(/#(\d+)|Case[:\s]*(\d+)/i) || body.match(/#(\d+)|Case[:\s]*(\d+)/i);
            if (caseMatch) {
              const cid = parseInt(caseMatch[1] || caseMatch[2]);
              if (cid) {
                const { data: c } = await sup.from('cases').select('id').eq('id', cid).maybeSingle();
                if (c) matchedCaseId = c.id;
              }
            }
          }

          // Store the message
          const insertData = {
            type: 'email', direction: 'inbound',
            sender: parsed.from?.value?.[0]?.address || '',
            recipient: parsed.to?.value?.[0]?.address || '',
            subject: parsed.subject || '(بدون موضوع)',
            body: parsed.text || parsed.html || '',
            message_id: parsed.messageId || msg.envelope.messageId,
            thread_id: parsed.inReplyTo || parsed.messageId || msg.envelope.messageId,
            in_reply_to: parsed.inReplyTo || '',
            references: (parsed.references || '').toString().substring(0, 500),
            created_at: (parsed.date || new Date()).toISOString(),
            is_read: msg.flags?.includes('\\Seen') || false,
          };
          if (matchedCaseId) insertData.case_id = matchedCaseId;
          if (matchedAgencyId) insertData.agency_id = matchedAgencyId;

          await sup.from('communications').insert(insertData);
          newCount++;

          // Create timeline event for matched emails
          if (matchedCaseId) {
            try {
              await sup.from('case_comments').insert({
                case_id: matchedCaseId,
                content: `📩 ${parsed.subject || '(بدون موضوع)'}`,
                user_name: parsed.from?.value?.[0]?.address || 'System',
              });
            } catch {}
          }
        }
      } finally { lock.release(); }
      await client.logout();
    } catch (e) {
      throw e; // Propagate — don't mask
    }

    return newCount;
  }
}

module.exports = new ImapService();
