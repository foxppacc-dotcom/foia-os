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
  windowMs: 15 * 60 * 1000, max: 100,
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
  if (!data) return null;
  // A link must stop working once its case is trashed or gone.
  const { data: caseRow } = await sup.from('cases').select('id').eq('id', data.case_id).is('deleted_at', null).maybeSingle();
  if (!caseRow) return null;
  return data;
}

// Vercel serverless functions don't share in-process memory across
// instances/cold starts, so publicUploadLimiter's in-memory store below is
// effectively decorative in production -- each instance counts
// independently and resets on every cold start. This backs the real,
// centrally-enforced boundary via migration 035's upload_link_rate_limits
// table. Fails OPEN (allows the request) if the migration hasn't been run
// yet or the check itself errors -- a missing rate limit must never be what
// breaks a real upload for an external agency.
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
// Raised from 30, then 100: the frontend's upload flow now auto-retries a
// stalled/dropped file with backoff instead of waiting for a manual click
// (see PublicUpload.jsx), which is exactly the scenario this feature exists
// for -- a large multi-GB file over an external sender's own flaky
// connection. A sustained bad connection retrying several large files at
// once could plausibly need several dozen session/finalize calls within one
// 15-minute window; 100 left too little headroom for that LEGITIMATE case
// before it started 429ing the very retries meant to make the upload
// resilient. Token remains the sole rate-limit key, so this only raises the
// ceiling for genuine bulk/retry use, not the shape of the abuse surface
// (note-spam, Drive-folder hammering) the limit exists to bound.
const RATE_LIMIT_MAX = 300;
// Was a plain read-then-write (read request_count, then UPDATE to count+1 in
// a separate statement) -- under genuinely concurrent requests (a scripted
// burst, or several files' /session calls landing at once), many requests
// read roughly the same stale count before any write lands, so the
// persisted counter barely advances no matter how many actually got
// through. Since the in-memory express-rate-limit layer next to this is
// already decorative on Vercel (each serverless instance has its own
// memory), this DB check is the ONLY real enforcement -- migration 039's
// `check_and_increment_upload_rate_limit` does the read-check-increment as
// ONE atomic UPSERT (Postgres serializes concurrent upserts on the same row
// automatically), closing that race.
async function checkRateLimit(sup, token) {
  try {
    const { data: allowed, error } = await sup.rpc('check_and_increment_upload_rate_limit', {
      p_token: token, p_window_ms: RATE_LIMIT_WINDOW_MS, p_max: RATE_LIMIT_MAX,
    });
    if (error) throw error;
    return allowed !== false;
  } catch (e) {
    // Migration not run yet, or the RPC itself errored -- a missing rate
    // limit must never be what breaks a real upload for an external agency.
    return true;
  }
}

// Files here can legitimately run ~10GB; nothing else in the request path
// enforces an upper bound (bytes never touch our backend, so there's no
// natural body-size ceiling to lean on). Without this, a holder of a valid,
// non-revoked token could declare an arbitrary size and open resumable
// sessions indefinitely, consuming Drive storage with no limit at all.
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024 * 1024; // 12GB -- headroom above the ~10GB the feature is meant for.

// Drive's own indexing can lag behind a just-finished upload -- confirmed
// live on a real multi-GB file (case #402): the transfer itself genuinely
// completed (Drive's resumable-session progress check agreed), but
// files.list didn't return it for well over 10 seconds afterward. The
// original 3 attempts / 1.5s apart (~3s total patience) wasn't NEARLY
// enough margin for that -- finalize kept 404ing, the sender kept getting
// told to retry, and every retry got the same short window and hit the same
// wall, over and over, even though the file was sitting there the whole
// time. Escalating up to ~40s of patience in ONE call (well inside Vercel's
// 60s function ceiling, with room left for the rest of finalize's own work)
// means a large file's indexing lag gets absorbed automatically instead of
// forcing the sender to manually click retry a dozen times.
// Shared with the authenticated /gdrive/finalize handler --
// see googleDriveService.js's findExistingFileRetrying for why this needs to
// wait this long (Drive indexing lag confirmed live at 10+ seconds).
async function findExistingFileRetrying(folderId, fileName, size) {
  return gdrive.findExistingFileRetrying(folderId, fileName, size);
}

// GET /api/public/upload/:token — the ONLY thing this exposes about the case
// is its title and its number (the same "#123" reference used everywhere
// else in the app, e.g. CaseHeader.jsx/Cases.jsx -- just the case's own id),
// so the upload page can greet the sender and they can quote a reference
// number back if needed. No other case field, no document list, nothing
// else is ever reachable through this token.
async function publicLinkInfoHandler(req, res) {
  try {
    const sup = getSupabase();
    const link = await resolveActiveLink(sup, req.params.token);
    if (!link) return res.status(404).json({ error: 'رابط غير صالح' });
    if (link.revoked_at) return res.status(410).json({ error: 'هذا الرابط لم يعد صالحًا' });
    if (!(await checkRateLimit(sup, req.params.token))) return res.status(429).json({ error: 'طلبات كثيرة جدًا -- حاول بعد قليل' });
    const { data: caseRow } = await sup.from('cases').select('title').eq('id', link.case_id).maybeSingle();
    res.json({ success: true, case_title: caseRow?.title || null, case_id: link.case_id });
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
    if (!(await checkRateLimit(sup, req.params.token))) return res.status(429).json({ error: 'طلبات كثيرة جدًا -- حاول بعد قليل' });
    if (!(await gdrive.isConnected())) return res.status(503).json({ error: 'Google Drive غير متصل' });

    const { file_name, mime_type, size } = req.body;
    if (!file_name || !size) return res.status(400).json({ error: 'file_name, size مطلوبون' });
    if (!(Number.isFinite(parseInt(size)) && parseInt(size) > 0)) return res.status(400).json({ error: 'size غير صالح' });
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
    // Scoped by upload_link_id too, not just case_id+name+size -- a case can
    // have more than one link over its lifetime (a replacement after
    // revoking one, or two agencies each with their own link). Without this,
    // link B could be handed link A's still-active session_url for a
    // same-named/same-sized file and append bytes into what is really
    // link A's transfer, or (see the finalize handler below) flip link A's
    // genuinely in-progress session to 'completed' out from under it.
    const { data: existingSession } = await sup.from('drive_upload_sessions')
      .select('id, session_url, uploaded_bytes, status')
      .eq('case_id', caseId).eq('file_name', file_name).eq('file_size', parseInt(size)).eq('status', 'active')
      .eq('upload_link_id', link.id).maybeSingle();
    if (existingSession && existingSession.session_url) {
      try {
        const progress = await gdrive.checkSessionProgress(existingSession.session_url, parseInt(size));
        if (progress.completed) {
          const doneFile = await findExistingFileRetrying(folderId, file_name, size);
          if (doneFile) return res.json({ success: true, existing: true, drive_file_id: doneFile.id, resume_offset: parseInt(size), completed: true });
          // Google reports this session as done, but no matching file actually
          // exists in the case's folder -- confirmed live on a stale/migrated
          // session row whose Drive session had long since expired, but whose
          // *last known* state Google still echoes back as "completed" for a
          // dead upload_id. Falling through to the same expired-session
          // recovery below (instead of claiming completed:true with nothing
          // for the client to act on) matches the identical fix already
          // applied to /gdrive/upload-session for the same underlying bug.
          throw new Error('reported completed but file not found in folder');
        }
        await sup.from('drive_upload_sessions').update({ uploaded_bytes: progress.offset, updated_at: new Date().toISOString() }).eq('id', existingSession.id);
        return res.json({ success: true, resumable: true, session_url: existingSession.session_url, sessionUrl: existingSession.session_url, resume_offset: progress.offset, folder_id: folderId });
      } catch (e) {
        // Session expired/gone (404/410 from Google) -- fall through and open
        // a new one. Supabase's query builder is a bare thenable (only
        // .then(), no .catch()/.finally()) -- .catch() chained directly on
        // it throws "not a function" INSTEAD of swallowing an error, which
        // previously turned every expired-session case (routine for a large/
        // slow/interrupted transfer) into a hard 500 here -- the session
        // never got marked 'expired', so every retry hit this exact same
        // dead end again, forever.
        try {
          await sup.from('drive_upload_sessions').update({ status: 'expired' }).eq('id', existingSession.id);
        } catch (e2) { /* best-effort -- still falls through to open a new session below */ }
      }
    }

    const existing = await findExistingFileRetrying(folderId, file_name, size);
    if (existing) return res.json({ success: true, existing: true, drive_file_id: existing.id, resume_offset: parseInt(size) });

    const sessionUrl = await gdrive.createResumableSession(file_name, mime_type, folderId, size);
    if (sessionUrl && typeof sessionUrl === 'object' && sessionUrl.__existing) {
      return res.json({ success: true, existing: true, drive_file_id: sessionUrl.__existing.id, resume_offset: parseInt(size) });
    }
    // migration 013's UNIQUE (case_id, file_name, file_size) rejects a
    // second row for this combo regardless of its status -- two people
    // uploading the identically-named/sized file to the same case at the
    // same moment would otherwise both open a separate Drive session and
    // both finalize into two duplicate case_documents rows. On conflict,
    // find out what's actually blocking us before deciding what to do.
    const { error: insertErr } = await sup.from('drive_upload_sessions').insert({
      case_id: caseId, file_name, file_size: parseInt(size),
      mime_type, category: 'incoming', folder_id: folderId,
      session_url: sessionUrl, uploaded_bytes: 0, status: 'active',
      upload_link_id: link.id,
    });
    if (insertErr) {
      if (/duplicate key|unique constraint/i.test(insertErr.message)) {
        const { data: existingRow } = await sup.from('drive_upload_sessions')
          .select('id, session_url, status').eq('case_id', caseId).eq('file_name', file_name).eq('file_size', parseInt(size)).maybeSingle();
        if (existingRow?.status === 'active' && existingRow.session_url) {
          // Someone else's insert already won this race -- ask Drive how far
          // THEIR session actually got (assuming 0 would repeat this exact
          // byte-offset mismatch bug) and hand it back instead of ours.
          try {
            const progress = await gdrive.checkSessionProgress(existingRow.session_url, parseInt(size));
            return res.json({ success: true, resumable: !progress.completed, existing: progress.completed, session_url: existingRow.session_url, sessionUrl: existingRow.session_url, resume_offset: progress.offset, folder_id: folderId });
          } catch (e) {
            // Their session died too -- fall through and reclaim the row below.
          }
        } else if (existingRow?.status === 'completed') {
          const doneFile = await findExistingFileRetrying(folderId, file_name, size);
          if (doneFile) return res.json({ success: true, existing: true, drive_file_id: doneFile.id, resume_offset: parseInt(size), completed: true });
        }
        // The blocking row is stale (expired, or an 'active'/'completed' row
        // whose session died / hasn't finished indexing on Drive's side) --
        // the unique constraint has no per-status scoping, so it would
        // otherwise block this exact (case_id, file_name, file_size) combo
        // from ever being retried again. Reclaim the row in place instead of
        // leaving our freshly-created Drive session untracked.
        //
        // The `.eq('session_url', existingRow.session_url)` makes this a
        // compare-and-swap: if a second concurrent request reclaimed the
        // SAME stale row a moment earlier, its session_url no longer
        // matches what we just read, so this UPDATE matches zero rows
        // instead of blindly overwriting their (now current) session --
        // without it, two racing requests would each stomp the other's
        // reclaim and BOTH would hand their own client a sessionUrl that
        // isn't the one actually left tracked in the DB.
        if (existingRow?.id) {
          const { data: reclaimed } = await sup.from('drive_upload_sessions').update({
            session_url: sessionUrl, uploaded_bytes: 0, status: 'active', updated_at: new Date().toISOString(),
            upload_link_id: link.id,
          }).eq('id', existingRow.id).eq('session_url', existingRow.session_url).select('id').maybeSingle();
          if (!reclaimed) {
            const { data: winner } = await sup.from('drive_upload_sessions')
              .select('session_url').eq('id', existingRow.id).maybeSingle();
            if (winner?.session_url) {
              try {
                const progress = await gdrive.checkSessionProgress(winner.session_url, parseInt(size));
                return res.json({ success: true, resumable: !progress.completed, existing: progress.completed, session_url: winner.session_url, sessionUrl: winner.session_url, resume_offset: progress.offset, folder_id: folderId });
              } catch (e) { /* their session's dead too -- fall through and use ours, untracked */ }
            }
          }
        } else {
          console.error('[fileFetch] save session failed:', insertErr.message);
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
    if (!(await checkRateLimit(sup, req.params.token))) return res.status(429).json({ error: 'طلبات كثيرة جدًا -- حاول بعد قليل' });
    if (!(await gdrive.isConnected())) return res.status(503).json({ error: 'Google Drive غير متصل' });

    const caseId = link.case_id;
    let { drive_file_id, original_name, size } = req.body;
    const folderId = await gdrive.ensureSubfolder(caseId, 'Incoming');
    if (!drive_file_id) {
      let existing = null;
      for (let attempt = 0; attempt < 3 && !existing; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 1500));
        existing = await gdrive.findExistingFile(folderId, original_name, size);
      }
      if (!existing) return res.status(404).json({ error: 'تعذر العثور على الملف المرفوع على Google Drive — حاول مرة أخرى' });
      drive_file_id = existing.id;
    }

    const meta = await gdrive.getFileMetadata(drive_file_id);
    // A client-supplied drive_file_id must actually live in THIS link's own
    // case folder -- otherwise a valid, non-revoked token for case A could be
    // used to graft an arbitrary Drive file (e.g. one belonging to case B,
    // whose id leaked via a shared link) into case A's document list.
    if (!(meta.parents || []).includes(folderId)) return res.status(403).json({ error: 'الملف غير موجود في مجلد هذه القضية' });
    // MAX_UPLOAD_BYTES was only ever checked against the client-DECLARED size
    // at session creation -- a client could under-declare `size` there and
    // then simply stream more chunks than declared, since the backend never
    // sees the bytes. This is the one point where Drive's own authoritative
    // size is available, so it's the real enforcement point.
    if (parseInt(meta.size) > MAX_UPLOAD_BYTES) {
      await gdrive.deleteFile(meta.id).catch(() => {});
      return res.status(413).json({ error: `الملف أكبر من الحد المسموح (${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024 / 1024)} جيجابايت)` });
    }

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
      upload_link_id: link.id,
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
      // Scoped by upload_link_id too -- without it, finalizing a file through
      // THIS link could flip a DIFFERENT link's still-genuinely-in-progress
      // same-named/same-sized session to 'completed' out from under it.
      await sup.from('drive_upload_sessions').update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('case_id', caseId).eq('file_name', original_name || meta.name).eq('file_size', parseInt(size) || parseInt(meta.size) || 0)
        .eq('status', 'active').eq('upload_link_id', link.id);
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

// GET /api/public/upload/:token/status — what THIS specific link has already
// uploaded (so reopening the page later still shows prior uploads) and what
// it left mid-transfer (so a person can tell which file to re-select to
// resume after a dropped connection or a fully closed tab). Scoped strictly
// by upload_link_id, never case_id alone -- a case can have more than one
// link over its lifetime, and this must never leak what a DIFFERENT link
// (or an internally-uploaded document) put on the same case. Same
// case-title-only privacy boundary as publicLinkInfoHandler otherwise.
async function publicUploadStatusHandler(req, res) {
  try {
    const sup = getSupabase();
    const link = await resolveActiveLink(sup, req.params.token);
    if (!link) return res.status(404).json({ error: 'رابط غير صالح' });
    if (link.revoked_at) return res.status(410).json({ error: 'هذا الرابط لم يعد صالحًا' });
    if (!(await checkRateLimit(sup, req.params.token))) return res.status(429).json({ error: 'طلبات كثيرة جدًا -- حاول بعد قليل' });

    const [{ data: completed }, { data: inProgress }] = await Promise.all([
      sup.from('case_documents').select('id, original_name, size, created_at')
        .eq('upload_link_id', link.id).is('deleted_at', null).order('created_at', { ascending: false }),
      sup.from('drive_upload_sessions').select('file_name, file_size, uploaded_bytes, updated_at')
        .eq('upload_link_id', link.id).eq('status', 'active').order('updated_at', { ascending: false }),
    ]);
    res.json({ success: true, completed: completed || [], inProgress: inProgress || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

// POST /api/public/upload/:token/note — the only way for the case team to
// hear back from whoever's on the other end of this link (no account, no
// email thread necessarily attached). Lands as a case_comments row with no
// user_id, same convention documentCenter.js's own auto-generated "📄
// {file}" system comments already use -- TeamDiscussion.jsx already renders
// a null-user comment authored as "النظام", no frontend change needed there.
async function publicUploadNoteHandler(req, res) {
  try {
    const sup = getSupabase();
    const link = await resolveActiveLink(sup, req.params.token);
    if (!link) return res.status(404).json({ error: 'رابط غير صالح' });
    if (link.revoked_at) return res.status(410).json({ error: 'هذا الرابط لم يعد صالحًا' });
    if (!(await checkRateLimit(sup, req.params.token))) return res.status(429).json({ error: 'طلبات كثيرة جدًا -- حاول بعد قليل' });

    const content = String(req.body?.content || '').trim();
    if (!content) return res.status(400).json({ error: 'الملاحظة فارغة' });
    if (content.length > 2000) return res.status(400).json({ error: 'الملاحظة طويلة جدًا (٢٠٠٠ حرف كحد أقصى)' });

    const { error } = await sup.from('case_comments').insert({
      case_id: link.case_id,
      content: `📨 ملاحظة من الجهة الرافعة (عبر رابط خارجي):\n${content}`,
    });
    if (error) throw error;

    try {
      const recipients = await getCaseActivityRecipients(sup, link.case_id, {});
      await notifyUsers(sup, recipients, {
        type: 'case_comment', title: '💬 ملاحظة جديدة من جهة خارجية',
        body: content.slice(0, 200),
        target_type: 'case', target_id: link.case_id,
      });
    } catch (e) { console.error('[fileFetch] note notification failed:', e.message); }

    res.status(201).json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

// POST /api/public/upload/:token/upload-file — receives the whole file
// directly (multer disk storage, never buffered in memory) and uploads it
// to Drive server-to-server, exactly mirroring the authenticated
// /gdrive/upload-file route added for the same reason: having the sender's
// own BROWSER PUT chunks directly to Drive's resumable endpoint turned out
// to fail unpredictably (confirmed live -- a real attempt got a generic
// cross-origin `net::ERR_FAILED` reaching googleapis.com directly, on a
// session a direct server-to-server PUT of the same bytes completed
// instantly). This removes that dependency for external senders too: their
// browser only ever needs to reach our own domain.
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const uploadTmpDir = '/tmp/foia-uploads';
fs.mkdirSync(uploadTmpDir, { recursive: true });
const publicUploadToDisk = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadTmpDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

async function publicUploadFileHandler(req, res) {
  const tempPath = req.file && req.file.path;
  const cleanup = () => { if (tempPath) fs.unlink(tempPath, () => {}); };
  try {
    const sup = getSupabase();
    const link = await resolveActiveLink(sup, req.params.token);
    if (!link) { cleanup(); return res.status(404).json({ error: 'رابط غير صالح' }); }
    if (link.revoked_at) { cleanup(); return res.status(410).json({ error: 'هذا الرابط لم يعد صالحًا' }); }
    if (!(await checkRateLimit(sup, req.params.token))) { cleanup(); return res.status(429).json({ error: 'طلبات كثيرة جدًا -- حاول بعد قليل' }); }
    if (!(await gdrive.isConnected())) { cleanup(); return res.status(503).json({ error: 'Google Drive غير متصل' }); }
    if (!req.file) { cleanup(); return res.status(400).json({ error: 'الملف مطلوب' }); }
    if (req.file.size > MAX_UPLOAD_BYTES) { cleanup(); return res.status(400).json({ error: `الملف أكبر من الحد المسموح (${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024 / 1024)} جيجابايت)` }); }

    const caseId = link.case_id;
    const original_name = req.body.original_name || req.file.originalname;
    const folderId = await gdrive.ensureSubfolder(caseId, 'Incoming');
    const meta = await gdrive.uploadFileFromPath(tempPath, original_name, req.file.mimetype, folderId, req.file.size);
    cleanup(); // Drive has confirmed the upload (or already had this exact file) -- the local copy has no reason to exist anymore.

    const { data: existingByDrive } = await sup.from('case_documents').select('id').eq('case_id', caseId).eq('drive_file_id', meta.id).maybeSingle();
    if (existingByDrive) return res.status(200).json({ success: true, data: { ...existingByDrive, duplicate: true } });

    const insertData = {
      case_id: caseId,
      filename: meta.name, original_name: original_name || meta.name,
      mime_type: meta.mimeType, size: parseInt(meta.size) || req.file.size,
      file_type: 'document', description: 'مرفوع عبر رابط FileFetch من جهة خارجية',
      uploaded_by: null,
      drive_file_id: meta.id, storage_provider: 'google_drive',
      file_path: meta.webViewLink, url: meta.webViewLink,
      file_hash: meta.md5Checksum || null,
      upload_source: 'file_fetch_link',
      upload_link_id: link.id,
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
    } catch (e) { console.error('[fileFetch] upload-file notification failed:', e.message); }

    res.status(201).json({ success: true, data });
  } catch (err) {
    cleanup();
    res.status(500).json({ error: err.message });
  }
}

// Multer errors (e.g. LIMIT_FILE_SIZE) throw before the handler's own
// try/catch ever runs -- wraps publicUploadFileHandler with the same clean-
// JSON MulterError handling already used elsewhere (e.g. forum.js), since
// this router is mounted directly on `app` in index.js, not through this
// file's own router with its own error middleware.
async function publicUploadFileRoute(req, res) {
  // Reject unknown/revoked tokens and trashed cases BEFORE multer writes the
  // body to disk -- otherwise anyone could POST gigabytes to a random token and
  // fill the VPS disk (the limiter is keyed by token, so a fresh token is a fresh bucket).
  try {
    const link = await resolveActiveLink(getSupabase(), req.params.token);
    if (!link || link.revoked_at) return res.status(404).json({ error: 'رابط الرفع غير صالح أو منتهي' });
  } catch (e) { return res.status(500).json({ error: e.message }); }
  publicUploadToDisk.single('file')(req, res, (err) => {
    if (err && err.name === 'MulterError') {
      const message = err.code === 'LIMIT_FILE_SIZE' ? `الملف أكبر من الحد المسموح (${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024 / 1024)} جيجابايت)`
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'عدد الملفات أكبر من الحد المسموح'
        : err.message;
      return res.status(400).json({ error: message });
    }
    if (err) return res.status(500).json({ error: err.message });
    publicUploadFileHandler(req, res);
  });
}

module.exports = router;
module.exports.publicUploadLimiter = publicUploadLimiter;
module.exports.publicUploadFileRoute = publicUploadFileRoute;
module.exports.publicLinkInfoHandler = publicLinkInfoHandler;
module.exports.publicUploadSessionHandler = publicUploadSessionHandler;
module.exports.publicUploadFinalizeHandler = publicUploadFinalizeHandler;
module.exports.publicUploadStatusHandler = publicUploadStatusHandler;
module.exports.publicUploadNoteHandler = publicUploadNoteHandler;
