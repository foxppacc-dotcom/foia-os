const nodemailer = require('nodemailer');
const { getSupabase } = require('../supabase');
const { decrypt } = require('./crypto');

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
  async sendEmail(accountId, { to, cc, bcc, subject, html, text, inReplyTo, references, attachments = [] }) {
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
      bcc,
      subject,
      html: html || text,
      text: text || html?.replace(/<[^>]*>/g, ''),
      inReplyTo,
      references,
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
   * Fetch emails from IMAP for a given account.
   * Delegates to mailPoller — the single shared IMAP engine — so this and
   * /api/imap/poll never run divergent fetch/matching logic against the same mailbox.
   */
  async fetchInbox(accountId, maxEmails = 20) {
    const sup = getSupabase();
    const { data: account, error } = await sup.from('email_accounts').select('*').eq('id', accountId).maybeSingle();
    if (error || !account || !account.imap_host) return [];

    const mailPoller = require('./mailPoller');
    const messages = await mailPoller.pollAccount(account);
    return messages.slice(0, maxEmails).map(m => ({
      messageId: m.messageId,
      subject: m.subject,
      from: m.from,
      to: m.to,
      cc: '',
      date: m.date,
      text: m.text,
      html: m.html,
      attachments: m.attachments.map(a => ({ filename: a.filename, contentType: a.contentType, size: a.size })),
    }));
  }

  /**
   * Fetch + store incoming emails as communications, auto-linking to a case.
   * Delegates matching/dedup/insert to mailPoller.processMessages so this and
   * /api/imap/poll share one insertion path — no more duplicate communications.
   */
  async processIncomingEmails(accountId, caseId = null) {
    const sup = getSupabase();
    const { data: account, error } = await sup.from('email_accounts').select('*').eq('id', accountId).maybeSingle();
    if (error || !account || !account.imap_host) return { emails_fetched: 0, communications_created: 0 };

    const mailPoller = require('./mailPoller');
    const messages = await mailPoller.pollAccount(account);
    const { count, errors } = await mailPoller.processMessages(accountId, messages, caseId);
    return { emails_fetched: messages.length, communications_created: count, errors };
  }
}

module.exports = new EmailService();
