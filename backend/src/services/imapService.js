const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { decrypt } = require('./crypto');
const crypto = require('crypto');

const now = () => { const t = process.hrtime.bigint(); return Number(t / 1_000_000n); };

class ImapService {
  /**
   * Compare SMTP vs IMAP credentials without exposing passwords.
   * Returns hashes, lengths, equality, and full IMAP server error.
   */
  async compareCredentials(account) {
    const result = {
      account: account.email,
      smtp: { exists: false, length: 0, hash: null, decryptError: null },
      imap: { exists: false, length: 0, hash: null, decryptError: null },
      passwordsEqual: null,
      smtpTest: null,
      imapTest: null,
    };

    // Decrypt SMTP password
    try {
      if (account.smtp_pass) {
        const p = decrypt(account.smtp_pass);
        if (p && p.length > 0) {
          result.smtp.exists = true;
          result.smtp.length = p.length;
          result.smtp.hash = crypto.createHash('sha256').update(p).digest('hex').substring(0, 8);
          result.smtp.invisibleChars = JSON.stringify(p);
        } else {
          result.smtp.decryptError = 'Decrypt returned empty/null';
        }
      } else {
        result.smtp.decryptError = 'smtp_pass field is null/undefined in DB';
      }
    } catch (e) {
      result.smtp.decryptError = e.message;
    }

    // Decrypt IMAP password
    try {
      if (account.imap_pass) {
        const p = decrypt(account.imap_pass);
        if (p && p.length > 0) {
          result.imap.exists = true;
          result.imap.length = p.length;
          result.imap.hash = crypto.createHash('sha256').update(p).digest('hex').substring(0, 8);
          result.imap.invisibleChars = JSON.stringify(p);
        } else {
          result.imap.decryptError = 'Decrypt returned empty/null';
        }
      } else {
        result.imap.decryptError = 'imap_pass field is null/undefined in DB';
      }
    } catch (e) {
      result.imap.decryptError = e.message;
    }

    // Compare
    if (result.smtp.exists && result.imap.exists) {
      result.passwordsEqual = (result.smtp.hash === result.imap.hash);
    }

    // Log SMTP/IMAP user config
    result.smtpUser = account.smtp_user || account.email;
    result.imapUser = account.imap_user || account.email;
    result.usersEqual = (result.smtpUser === result.imapUser);
    result.smtpHost = account.smtp_host;
    result.imapHost = account.imap_host;
    result.smtpPort = account.smtp_port;
    result.imapPort = account.imap_port;

    // Test IMAP login with the IMAP decrypted password
    if (result.imap.exists) {
      const imapPass = decrypt(account.imap_pass);
      result.imapTest = await this._testImapLogin(account, imapPass);
    }

    return result;
  }

  async _testImapLogin(account, pass) {
    const client = new ImapFlow({
      host: account.imap_host || 'imap.gmail.com',
      port: account.imap_port || 993,
      secure: true,
      auth: { user: account.imap_user || account.email, pass },
      logger: false,
      verifyConnection: true,
    });

    const detail = { success: false, errorCode: null, errorMessage: null, rawError: null, stage: null };
    const t0 = Date.now();

    try {
      await client.connect();
      detail.success = true;
      await client.logout();
    } catch (e) {
      detail.duration = Date.now() - t0;
      detail.errorMessage = e.message;
      detail.rawError = e.code || (e.response ? e.response.substring(0, 200) : null);
      detail.stage = e.received ? 'AUTH_RESPONSE' : 'CONNECT';

      // Extract the IMAP server response code
      if (e.response) {
        const resp = e.response.toString();
        detail.serverResponse = resp.substring(0, 300);
        // Try to extract AUTHENTICATIONFAILED or similar
        const match = resp.match(/\[([A-Z]+)\]/);
        if (match) detail.errorCode = match[1];
      }

      // Classify the error
      if (e.message.includes('AUTHENTICATIONFAILED') || e.message.includes('Invalid credentials')) {
        detail.errorCode = 'AUTHENTICATIONFAILED';
      } else if (e.message.includes('too many') || e.message.includes('rate')) {
        detail.errorCode = 'RATE_LIMITED';
      } else if (e.message.includes('connection') || e.message.includes('timeout')) {
        detail.errorCode = 'CONNECTION_FAILED';
      }

      try { await client.logout(); } catch {}
    }

    return detail;
  }

  async diagnose(account) {
    const timings = {};
    const report = { account: account.email, decrypt: null, connection: null, authentication: null, mailbox: null, search: null, fetch: null, timings, overall: false };

    try {
      const t0 = Date.now();
      if (!account.imap_pass) throw new Error('No IMAP password stored');
      const p = decrypt(account.imap_pass);
      if (!p || p.length < 2) throw new Error('Empty password');
      timings.decrypt = Date.now() - t0;
      report.decrypt = { success: true, error: null };
    } catch (e) {
      timings.decrypt = 0;
      report.decrypt = { success: false, error: e.message };
      report.overall = false; return report;
    }

    const imapPass = decrypt(account.imap_pass);
    const client = new ImapFlow({
      host: account.imap_host || 'imap.gmail.com',
      port: account.imap_port || 993,
      secure: true,
      auth: { user: account.imap_user || account.email, pass: imapPass },
      logger: false,
      verifyConnection: true,
    });

    let tStart = Date.now();
    try {
      await client.connect();
      timings.connect = Date.now() - tStart;
      report.connection = { success: true, error: null };
      report.authentication = { success: true, error: null };
    } catch (e) {
      timings.connect = Date.now() - tStart;
      report.connection = { success: false, error: e.message, code: e.code || null, serverResponse: e.response?.toString().substring(0,200) || null };
      report.overall = false; return report;
    }

    try {
      const lock = await client.getMailboxLock('INBOX');
      timings.mailboxLock = Date.now() - tStart;
      report.mailbox = { success: true, folder: 'INBOX', exists: client.mailbox?.exists, unseen: client.mailbox?.unseen, error: null };
      report.search = { success: true, unseen: client.mailbox?.unseen || 0, error: null };

      let fetchMsgs = 0;
      tStart = Date.now();
      try {
        for await (const msg of client.fetch('1:3', { uid: true, envelope: true, flags: true })) {
          fetchMsgs++;
          if (fetchMsgs >= 3) break;
        }
        timings.fetch = Date.now() - tStart;
        report.fetch = { success: true, messagesInMailbox: client.mailbox?.exists || 0, messagesExamined: fetchMsgs, error: null };
        report.overall = true;
      } catch (e) {
        timings.fetch = Date.now() - tStart;
        report.fetch = { success: false, error: e.message };
      }
      lock.release();
    } catch (e) {
      timings.mailboxLock = Date.now() - (tStart || Date.now());
      report.mailbox = { success: false, error: e.message };
    }

    try { await client.logout(); } catch {}
    return report;
  }

  async testConnectivity(account) {
    const steps = {};
    const imapPass = decrypt(account.imap_pass);
    const client = new ImapFlow({
      host: account.imap_host || 'imap.gmail.com',
      port: account.imap_port || 993,
      secure: true,
      auth: { user: account.imap_user || account.email, pass: imapPass },
      logger: false,
    });

    const t0 = Date.now();
    try {
      await client.connect();
      steps.total = Date.now() - t0;
      steps.result = 'connected';
    } catch (e) {
      steps.total = Date.now() - t0;
      steps.result = 'failed';
      steps.error = e.message;
    }

    try { await client.logout(); } catch {}
    return steps;
  }

  async pollAccount(account) { return 0; }

  /**
   * Check message counts in INBOX vs Spam vs All Mail -- mailPoller only
   * ever looks at INBOX, so a message that landed in Spam would silently
   * never be fetched.
   */
  async checkFolders(account) {
    const imapPass = decrypt(account.imap_pass);
    const client = new ImapFlow({
      host: account.imap_host || 'imap.gmail.com',
      port: account.imap_port || 993,
      secure: true,
      auth: { user: account.imap_user || account.email, pass: imapPass },
      logger: false,
    });
    const result = {};
    await client.connect();

    for (const folderName of ['INBOX', '[Gmail]/Spam', '[Gmail]/All Mail']) {
      try {
        const lock = await client.getMailboxLock(folderName);
        try {
          const status = client.mailbox;
          const recent = [];
          if (status.exists > 0) {
            const from = Math.max(1, status.exists - 4);
            for await (const msg of client.fetch({ seq: `${from}:*` }, { envelope: true })) {
              recent.push({ date: msg.envelope.date, subject: msg.envelope.subject, from: msg.envelope.from?.[0]?.address });
            }
          }
          result[folderName] = { exists: status.exists, recent };
        } finally { lock.release(); }
      } catch (e) {
        result[folderName] = { error: e.message };
      }
    }

    await client.logout();
    return result;
  }
}

module.exports = new ImapService();
