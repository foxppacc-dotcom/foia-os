const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const { canAccessCase } = require('../services/caseAccess');
const gdrive = require('../services/googleDriveService');
const { notifyUsers, getCaseActivityRecipients } = require('../services/notificationService');

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://frontend-five-nu-wgj97r88rl.vercel.app';

// ============ Authenticated: case team manages its own upload links ============

// POST /api/cases/:id/upload-links — generate a new "FileFetch" link for
// this case. Tokens never expire on their own (product decision) --
// revoking is the only way to kill one, so the token itself is a full
// 32-byte random value, same strength as any other secret this codebase
// generates (caseFileStorage.js already relies on the same crypto module).
router.post('/cases/:id/upload-links', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    if (!(await canAccessCase(sup, req.user, caseId))) return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    const token = crypto.randomBytes(32).toString('hex');
    const { data, error } = await sup.from('case_upload_links').insert({ case_id: caseId, token, created_by: req.user.id }).select().single();
    if (error) return res.status(400).json({ error: /does not exist|could not find the table/i.test(error.message) ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (case_upload_links)' : error.message });
    res.status(201).json({ success: true, data: { ...data, url: `${FRONTEND_URL}/upload/${token}` } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/cases/:id/upload-links — list this case's links (active + past,
// so a manager can see the revoked ones too as an audit trail).
router.get('/cases/:id/upload-links', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    if (!(await canAccessCase(sup, req.user, caseId))) return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    const { data, error } = await sup.from('case_upload_links').select('*').eq('case_id', caseId).order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: /does not exist|could not find the table/i.test(error.message) ? 'يجب تنفيذ ترحيل قاعدة البيانات أولاً (case_upload_links)' : error.message });
    res.json({ success: true, data: (data || []).map(r => ({ ...r, url: `${FRONTEND_URL}/upload/${r.token}` })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/cases/:id/upload-links/:linkId — revoke. Scoped by case_id in
// the WHERE clause so a link belonging to a DIFFERENT case can't be revoked
// just by guessing its numeric id.
router.delete('/cases/:id/upload-links/:linkId', requireAuth, async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    if (!(await canAccessCase(sup, req.user, caseId))) return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    const { error } = await sup.from('case_upload_links').update({ revoked_at: new Date().toISOString() }).eq('id', parseInt(req.params.linkId)).eq('case_id', caseId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ Public: no login possible, token is the only credential ============
// Exported as raw handlers (not mounted on this router) -- index.js registers
// them directly on `app`, BEFORE the per-feature routers, the same way
// gdrive.js's OAuth callback and image proxy already have to (a router with
// router.use(requireAuth) mounted earlier would 401 these first otherwise).

const publicUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30,
  // Keyed by token, not IP -- a whole external agency office plausibly
  // shares one public IP, and this token is already the sole credential in
  // play, so rate-limiting per-token is the meaningful boundary here.
  keyGenerator: (req) => req.params.token || req.ip,
  message: { error: 'طلبات كثيرة جدًا -- حاول بعد قليل' },
  standardHeaders: true, legacyHeaders: false,
});

async function resolveActiveLink(sup, token) {
  if (!token) return null;
  const { data } = await sup.from('case_upload_links').select('id, case_id, revoked_at, upload_count').eq('token', token).maybeSingle();
  return data || null;
}

// Files here can legitimately run ~10GB; nothing else in the request path
// enforces an upper bound (bytes never touch our backend, so there's no
// natural body-size ceiling to lean on). Without this, a holder of a valid,
// non-revoked token could declare an arbitrary size and open resumable
// sessions indefinitely, consuming Drive storage with no limit at all.
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024 * 1024; // 12GB -- headroom above the ~10GB the feature is meant for.

// Drive's own indexing can lag a few seconds behind a just-finished upload.
// Shared by both the session handler (recognizing an already-completed
// transfer) and finalize (registering it) so neither gives up on a genuine
// success just because it asked half a second too early.
async function findExistingFileRetrying(folderId, fileName, size) {
  let existing = null;
  for (let attempt = 0; attempt < 3 && !existing; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1500));
    existing = await gdrive.findExistingFile(folderId, fileName, size);
  }
  return existing;
}

// GET /api/public/upload/:token — the ONLY thing this exposes about the case
// is its title, so the upload page can greet the sender. No other case
// field, no document list, nothing else is ever reachable through this token.
async function publicLinkInfoHandler(req, res) {
  try {
    const sup = getSupabase();
    const link = await resolveActiveLink(sup, req.params.token);
    if (!link) return res.status(404).json({ error: 'رابط غير صالح' });
    if (link.revoked_at) return res.status(410).json({ error: 'هذا الرابط لم يعد صالحًا' });
    const { data: caseRow } = await sup.from('cases').select('title').eq('id', link.case_id).maybeSingle();
    res.json({ success: true, case_title: caseRow?.title || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

// POST /api/public/upload/:token/session — mirrors gdrive.js's
// POST /gdrive/upload-session, but case_id comes from the TOKEN, never from
// the request body, and there's no requireAuth/assertCaseAccess to bypass.
async function publicUploadSessionHandler(req, res) {
  try {
    const sup = getSupabase();
    const link = await resolveActiveLink(sup, req.params.token);
    if (!link) return res.status(404).json({ error: 'رابط غير صالح' });
    if (link.revoked_at) return res.status(410).json({ error: 'هذا الرابط لم يعد صالحًا' });
    if (!(await gdrive.isConnected())) return res.status(503).json({ error: 'Google Drive غير متصل' });

    const { file_name, mime_type, size } = req.body;
    if (!file_name || !size) return res.status(400).json({ error: 'file_name, size مطلوبون' });
    if (parseInt(size) > MAX_UPLOAD_BYTES) return res.status(400).json({ error: `الملف أكبر من الحد المسموح (${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024 / 1024)} جيجابايت)` });
    const caseId = link.case_id;
    const folderId = await gdrive.ensureSubfolder(caseId, 'Incoming');

    // Files here can be up to ~10GB -- over a connection an external party
    // doesn't control (their own network, their own laptop staying awake),
    // a multi-hour transfer WILL drop at least once. Reusing an
    // in-progress drive_upload_sessions row (same mechanism the
    // authenticated /gdrive/upload-session already relies on) means a retry
    // resumes from wherever Drive actually left off instead of re-sending
    // gigabytes that already landed -- without this, one dropped connection
    // near the end of a 10GB transfer would mean starting completely over.
    const { data: existingSession } = await sup.from('drive_upload_sessions')
      .select('id, session_url, uploaded_bytes, status')
      .eq('case_id', caseId).eq('file_name', file_name).eq('file_size', parseInt(size)).eq('status', 'active').maybeSingle();
    if (existingSession && existingSession.session_url) {
      try {
        const progress = await gdrive.checkSessionProgress(existingSession.session_url, parseInt(size));
        if (progress.completed) {
          const doneFile = await findExistingFileRetrying(folderId, file_name, size);
          if (doneFile) return res.json({ success: true, existing: true, drive_file_id: doneFile.id, resume_offset: parseInt(size), completed: true });
          return res.json({ success: true, existing: true, resume_offset: parseInt(size), completed: true });
        }
        await sup.from('drive_upload_sessions').update({ uploaded_bytes: progress.offset, updated_at: new Date().toISOString() }).eq('id', existingSession.id);
        return res.json({ success: true, resumable: true, session_url: existingSession.session_url, sessionUrl: existingSession.session_url, resume_offset: progress.offset, folder_id: folderId });
      } catch (e) {
        // Session expired/gone (404/410 from Google) -- fall through and open a new one.
        await sup.from('drive_upload_sessions').update({ status: 'expired' }).eq('id', existingSession.id).catch(() => {});
      }
    }

    const existing = await findExistingFileRetrying(folderId, file_name, size);
    if (existing) return res.json({ success: true, existing: true, drive_file_id: existing.id, resume_offset: parseInt(size) });

    const sessionUrl = await gdrive.createResumableSession(file_name, mime_type, folderId, size);
    if (sessionUrl && typeof sessionUrl === 'object' && sessionUrl.__existing) {
      return res.json({ success: true, existing: true, drive_file_id: sessionUrl.__existing.id, resume_offset: parseInt(size) });
    }
    // A partial unique index (migration 035) rejects a second concurrent
    // 'active' row for the same (case_id, file_name, file_size) -- two
    // people uploading the identically-named/sized file to the same case
    // at the same moment would otherwise both open a separate Drive
    // session and both finalize into two duplicate case_documents rows. On
    // conflict, someone else's insert already won this race -- fetch and
    // hand back THEIR session instead of silently erroring.
    const { error: insertErr } = await sup.from('drive_upload_sessions').insert({
      case_id: caseId, file_name, file_size: parseInt(size),
      mime_type, category: 'incoming', folder_id: folderId,
      session_url: sessionUrl, uploaded_bytes: 0, status: 'active',
    });
    if (insertErr) {
      if (/duplicate key|unique constraint/i.test(insertErr.message)) {
        const { data: winner } = await sup.from('drive_upload_sessions')
          .select('session_url').eq('case_id', caseId).eq('file_name', file_name).eq('file_size', parseInt(size)).eq('status', 'active').maybeSingle();
        if (winner?.session_url) {
          // Ask Drive how far the WINNING session actually got -- assuming
          // 0 here would repeat this exact byte-offset mismatch bug against
          // whatever the other request has already sent.
          try {
            const progress = await gdrive.checkSessionProgress(winner.session_url, parseInt(size));
            return res.json({ success: true, resumable: !progress.completed, existing: progress.completed, session_url: winner.session_url, sessionUrl: winner.session_url, resume_offset: progress.offset, folder_id: folderId });
          } catch (e) {
            return res.json({ success: true, resumable: true, session_url: winner.session_url, sessionUrl: winner.session_url, resume_offset: 0, folder_id: folderId });
          }
        }
      } else {
        console.error('[fileFetch] save session failed:', insertErr.message);
      }
    }
    res.json({ success: true, resumable: true, session_url: sessionUrl, sessionUrl, resume_offset: 0, folder_id: folderId });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

// POST /api/public/upload/:token/finalize — mirrors gdrive.js's
// POST /gdrive/finalize. uploaded_by is left NULL (no user session exists
// for an external submitter) and upload_source is tagged so the Files tab
// can badge these distinctly from a logged-in upload.
async function publicUploadFinalizeHandler(req, res) {
  try {
    const sup = getSupabase();
    const link = await resolveActiveLink(sup, req.params.token);
    if (!link) return res.status(404).json({ error: 'رابط غير صالح' });
    if (link.revoked_at) return res.status(410).json({ error: 'هذا الرابط لم يعد صالحًا' });
    if (!(await gdrive.isConnected())) return res.status(503).json({ error: 'Google Drive غير متصل' });

    const caseId = link.case_id;
    let { drive_file_id, original_name, size } = req.body;
    if (!drive_file_id) {
      const folderId = await gdrive.ensureSubfolder(caseId, 'Incoming');
      let existing = null;
      for (let attempt = 0; attempt < 3 && !existing; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 1500));
        existing = await gdrive.findExistingFile(folderId, original_name, size);
      }
      if (!existing) return res.status(404).json({ error: 'تعذر العثور على الملف المرفوع على Google Drive — حاول مرة أخرى' });
      drive_file_id = existing.id;
    }

    const meta = await gdrive.getFileMetadata(drive_file_id);

    const { data: existingByDrive } = await sup.from('case_documents').select('id').eq('case_id', caseId).eq('drive_file_id', meta.id).maybeSingle();
    if (existingByDrive) return res.status(200).json({ success: true, data: { ...existingByDrive, duplicate: true } });

    const insertData = {
      case_id: caseId,
      filename: meta.name, original_name: original_name || meta.name,
      mime_type: meta.mimeType, size: parseInt(meta.size) || 0,
      file_type: 'document', description: 'مرفوع عبر رابط FileFetch من جهة خارجية',
      uploaded_by: null,
      drive_file_id: meta.id, storage_provider: 'google_drive',
      file_path: meta.webViewLink, url: meta.webViewLink,
      file_hash: meta.md5Checksum || null,
      upload_source: 'file_fetch_link',
    };
    let { data, error } = await sup.from('case_documents').insert(insertData).select().single();
    while (error && /column .* does not exist|Could not find the '(\w+)' column/.test(error.message)) {
      const m = error.message.match(/'(\w+)' column|column "(\w+)"/);
      const badCol = m && (m[1] || m[2]);
      if (!badCol || !(badCol in insertData)) break;
      delete insertData[badCol];
      ({ data, error } = await sup.from('case_documents').insert(insertData).select().single());
    }
    if (error) throw error;

    // Without this, the session row lingers 'active' forever -- a LATER,
    // unrelated upload attempt of a same-named/same-sized file to this same
    // case would match it via the SELECT in the session handler and
    // (correctly, but confusingly) get told the transfer is already
    // "completed" before it ever started.
    try {
      await sup.from('drive_upload_sessions').update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('case_id', caseId).eq('file_name', original_name || meta.name).eq('file_size', parseInt(size) || parseInt(meta.size) || 0).eq('status', 'active');
    } catch (e) { console.error('[fileFetch] session completion update failed:', e.message); }

    try {
      await sup.from('case_upload_links').update({
        upload_count: (link.upload_count || 0) + 1, last_used_at: new Date().toISOString(),
      }).eq('id', link.id);
    } catch (e) { console.error('[fileFetch] link stat update failed:', e.message); }

    try {
      const recipients = await getCaseActivityRecipients(sup, caseId, {});
      await notifyUsers(sup, recipients, {
        type: 'document_uploaded', title: '📎 ملف جديد من جهة خارجية',
        body: `تم رفع "${insertData.original_name}" على القضية عبر رابط FileFetch`,
        target_type: 'case', target_id: caseId,
      });
    } catch (e) { console.error('[fileFetch] finalize notification failed:', e.message); }

    res.status(201).json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

module.exports = router;
module.exports.publicUploadLimiter = publicUploadLimiter;
module.exports.publicLinkInfoHandler = publicLinkInfoHandler;
module.exports.publicUploadSessionHandler = publicUploadSessionHandler;
module.exports.publicUploadFinalizeHandler = publicUploadFinalizeHandler;
