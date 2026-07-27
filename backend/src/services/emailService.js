const nodemailer = require('nodemailer');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { getSupabase } = require('../supabase');

/**
 * Real Email Service for FOIA OS
 * Supports multiple SMTP/IMAP accounts, send & receive
 */

class EmailService {
  constructor() {
    this.transporters = new Map();
  }

  /**
   * Get or create a nodemailer transporter for an email account
   */
  getTransporter(account) {
    const key = `smtp_${account.id}`;
    if (this.transporters.has(key)) return this.transporters.get(key);

    // Decrypt password — DB stores AES-256-GCM encrypted value
    const { decrypt } = require('./crypto');
    const smtpPass = decrypt(account.smtp_pass);

    const transporter = nodemailer.createTransport({
      host: account.smtp_host || 'smtp.gmail.com',
      port: account.smtp_port || 587,
      secure: account.smtp_port === 465,
      auth: {
        user: account.smtp_user || account.email,
        pass: smtpPass,
      },
      tls: { rejectUnauthorized: false },
    });

    this.transporters.set(key, transporter);
    return transporter;
  }

  /**
   * Send an email via the specified account
   */
  async sendEmail(accountId, { to, cc, subject, html, text, attachments = [] }) {
    const sup = getSupabase();
    const { data: account, error } = await sup
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .maybeSingle();

    if (error || !account) throw new Error(`Email account #${accountId} not found`);
    if (!account.is_active) throw new Error(`Email account #${accountId} is inactive`);

    // Check daily limit
    if (account.sent_today >= account.daily_limit) {
      throw new Error(`Daily limit reached for ${account.email} (${account.sent_today}/${account.daily_limit})`);
    }

    const transporter = this.getTransporter(account);

    const info = await transporter.sendMail({
      from: `"${account.name}" <${account.email}>`,
      to,
      cc,
      subject,
      html: html || text,
      text: text || html?.replace(/<[^>]*>/g, ''),
      attachments: attachments.map(a => ({
        filename: a.filename,
        path: a.path,
        content: a.content,
      })),
    });

    // Increment sent_today
    await sup
      .from('email_accounts')
      .update({ sent_today: (account.sent_today || 0) + 1 })
      .eq('id', accountId);

    return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
  }

  /**
   * Fetch unread emails from IMAP for a given account
   * Returns parsed emails ready to be stored as communications
   */
  async fetchInbox(accountId, maxEmails = 20) {
    return new Promise((resolve, reject) => {
      const sup = getSupabase();
      sup
        .from('email_accounts')
        .select('*')
        .eq('id', accountId)
        .maybeSingle()
        .then(({ data: account, error }) => {
          if (error || !account || !account.imap_host) {
            return resolve([]);
          }

          const imap = new Imap({
            user: account.imap_user || account.email,
            password: account.imap_pass,
            host: account.imap_host,
            port: account.imap_port || 993,
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
          });

          const emails = [];

          imap.once('ready', () => {
            imap.openBox('INBOX', false, (err, box) => {
              if (err) { imap.end(); return reject(err); }

              // Search for unseen (unread) emails only, or recent ones
              imap.search(['UNSEEN'], (err, results) => {
                if (err) { imap.end(); return reject(err); }
                if (!results || results.length === 0) {
                  imap.end();
                  return resolve([]);
                }

                // Take only first N
                const fetchIds = results.slice(0, maxEmails);
                const f = imap.fetch(fetchIds, { bodies: '', struct: true });

                f.on('message', (msg, seqno) => {
                  let buffer = '';

                  msg.on('body', (stream, info) => {
                    stream.on('data', chunk => { buffer += chunk.toString('utf8'); });
                  });

                  msg.once('end', async () => {
                    try {
                      const parsed = await simpleParser(buffer);
                      emails.push({
                        messageId: parsed.messageId,
                        subject: parsed.subject || '(بدون موضوع)',
                        from: parsed.from?.text || '',
                        to: parsed.to?.text || '',
                        cc: parsed.cc?.text || '',
                        date: parsed.date || new Date(),
                        text: parsed.text || '',
                        html: parsed.html || '',
                        attachments: (parsed.attachments || []).map(a => ({
                          filename: a.filename,
                          contentType: a.contentType,
                          size: a.size,
                        })),
                      });
                    } catch (e) {
                      // skip malformed
                    }
                  });
                });

                f.once('end', () => {
                  imap.end();
                  resolve(emails);
                });

                f.once('error', err => {
                  imap.end();
                  reject(err);
                });
              });
            });
          });

          imap.once('error', err => reject(err));
          imap.once('end', () => { /* cleanup */ });

          imap.connect();
        })
        .catch(err => reject(err));
    });
  }

  /**
   * Convert fetched emails into communications and auto-link to cases
   */
  async processIncomingEmails(accountId, caseId = null) {
    const sup = getSupabase();
    const emails = await this.fetchInbox(accountId);

    let created = 0;

    for (const email of emails) {
      // Try to auto-match to a case by subject or content
      let targetCaseId = caseId;

      if (!targetCaseId) {
        // Try to match by subject: look for UUID or case ID patterns
        const caseMatch = email.subject?.match(/\[FOIA\s*[#:]\s*(\d+)\]/i);
        if (caseMatch) {
          targetCaseId = parseInt(caseMatch[1]);
        }

        // If no match, try searching by email subject in case titles
        if (!targetCaseId) {
          const subjectWords = (email.subject || '').replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 3);
          if (subjectWords.length > 0) {
            const likeConditions = subjectWords.map(w => `title.ilike.%${w}%`);

            let query = sup.from('cases').select('id');
            for (const word of subjectWords) {
              query = query.ilike('title', `%${word}%`);
            }
            const { data: matchedCases } = await query.limit(1);

            if (matchedCases && matchedCases.length > 0) targetCaseId = matchedCases[0].id;
          }
        }
      }

      // Still no match? Create an unlinked communication (goes to inbox)
      if (!targetCaseId) {
        await sup.from('communications').insert({
          case_id: null,
          type: 'email',
          direction: 'inbound',
          subject: email.subject,
          body: email.text?.substring(0, 5000) || '',
          sender: email.from || '',
          recipient: email.to || '',
          metadata: JSON.stringify({ messageId: email.messageId, cc: email.cc, account_id: accountId }),
          created_at: email.date?.toISOString() || new Date().toISOString()
        });
      } else {
        // Link to the existing case
        await sup.from('communications').insert({
          case_id: targetCaseId,
          type: 'email',
          direction: 'inbound',
          subject: email.subject,
          body: email.text?.substring(0, 5000) || '',
          sender: email.from || '',
          recipient: email.to || '',
          metadata: JSON.stringify({ messageId: email.messageId, cc: email.cc, account_id: accountId }),
          created_at: email.date?.toISOString() || new Date().toISOString()
        });

        // Add a comment
        await sup.from('case_comments').insert({
          case_id: targetCaseId,
          content: `📩 بريد وارد: "${email.subject}"`,
          created_at: new Date().toISOString()
        });

        // Auto-update pending request status
        const { data: pendingRequest } = await sup
          .from('requests')
          .select('id')
          .eq('case_id', targetCaseId)
          .eq('status', 'pending')
          .limit(1)
          .maybeSingle();

        if (pendingRequest) {
          await sup
            .from('requests')
            .update({ status: 'responded', response_date: new Date().toISOString().split('T')[0] })
            .eq('id', pendingRequest.id);
        }
      }

      created++;
    }

    return { emails_fetched: emails.length, communications_created: created };
  }
}

module.exports = new EmailService();
