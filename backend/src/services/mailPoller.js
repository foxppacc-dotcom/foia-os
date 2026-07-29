const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { getSupabase } = require('../supabase');
const { decrypt } = require('./crypto');

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
          messages.push({
            messageId: parsed.messageId || msg.envelope.messageId,
            inReplyTo: parsed.inReplyTo || '',
            references: parsed.references || '',
            from: parsed.from?.value?.[0]?.address || '',
            to: parsed.to?.value?.[0]?.address || '',
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
          this.messageIdCache.add(parsed.messageId);
        }
      } finally { lock.release(); }
      await client.logout();

      return messages;
    } catch (err) {
      console.error(`IMAP poll error for ${account.email}:`, err.message);
      return [];
    }
  }

  async processMessages(accountId, messages, forceCaseId = null) {
    const sup = getSupabase();
    let newCount = 0;

    for (const msg of messages) {
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

      // Insert communication record
      const insertData = {
        type: 'email', direction: 'inbound',
        sender: msg.from, recipient: msg.to,
        subject: msg.subject, body: msg.text || msg.html,
        message_id: msg.messageId,
        thread_id: msg.inReplyTo || msg.messageId,
        created_at: msg.date.toISOString(),
        is_read: false,
        metadata: { attachments: msg.attachments.length, flags: msg.flags },
      };
      if (matchedCaseId) insertData.case_id = matchedCaseId;
      if (matchedAgencyId) insertData.agency_id = matchedAgencyId;

      await sup.from('communications').insert(insertData);
      newCount++;

      // Create timeline event + notify assignees for matched emails
      if (matchedCaseId) {
        await sup.from('activity_logs').insert({
          action_type: 'email_received',
          target_type: 'case',
          target_id: matchedCaseId,
          target_title: `📩 ${msg.subject}`,
          user_name: msg.from,
          created_at: msg.date.toISOString(),
        }).catch(() => {});

        await this.notifyCaseUsers(sup, matchedCaseId, msg.subject, msg.from).catch(() => {});
      }
    }

    return newCount;
  }

  async notifyCaseUsers(sup, caseId, subject, from) {
    const { data: assignees } = await sup.from('case_assignees').select('user_id').eq('case_id', caseId);
    const { data: caseRow } = await sup.from('cases').select('created_by').eq('id', caseId).maybeSingle();
    const userIds = new Set((assignees || []).map(a => a.user_id));
    if (caseRow?.created_by) userIds.add(caseRow.created_by);
    for (const userId of userIds) {
      await sup.from('notifications').insert({
        user_id: userId,
        type: 'email_received',
        title: '📩 رد جديد من جهة',
        body: `${from}: ${subject}`,
      }).catch(() => {});
    }
  }

  async pollAll() {
    const sup = getSupabase();
    const { data: accounts } = await sup.from('email_accounts').select('*').eq('is_active', true);
    let total = 0;
    for (const acct of accounts || []) {
      try {
        const messages = await this.pollAccount(acct);
        const count = await this.processMessages(acct.id, messages);
        if (count > 0) console.log(`IMAP: ${count} new messages from ${acct.email}`);
        total += count;
      } catch (e) { console.error(`IMAP error for ${acct.email}:`, e.message); }
    }
    return total;
  }
}

module.exports = new MailPoller();
