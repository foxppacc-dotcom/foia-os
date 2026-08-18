const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, requirePermission, hasPermission } = require("../middleware/auth");
router.use(requireAuth);
const { getSupabase } = require('../supabase');
const { logActivity } = require('../services/activityLogger');
const { scopeCasesQuery, canAccessCase, requireCaseAccess } = require('../services/caseAccess');
const { notifyUsers, getCaseRecipients, getUsersWithPermission, getCaseActivityRecipients } = require('../services/notificationService');
const multer = require('multer');
const gdrive = require('../services/googleDriveService');
const caseFileStorage = require('../services/caseFileStorage');
// Comment attachments (team discussion) -- memoryStorage + Drive upload,
// same convention as case_documents' own upload route.
const commentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// The only notification types that actually need a human's attention on a
// SPECIFIC case (used both to compute the القضايا activity badge and to
// scope what "mark this case's notifications read" is allowed to touch) --
// shared so the two can never drift apart, which they briefly did (the
// mark-read route used to clear every case notification indiscriminately,
// silently disappearing case_created/case_status_changed from the general
// bell even though the badge/popover never showed them).
const CASE_BADGE_TYPES = ['case_comment', 'case_comment_mention', 'email_received', 'document_uploaded'];

// Cached (per server instance) rather than re-checked every request, and
// re-checked lazily instead of a hard .not() filter baked into the query
// unconditionally -- migrations/027 (in_intake_review) may not have run yet
// in this environment, and this route is the whole القضايا list, not
// something that should 500 outright just because an optional new column
// isn't there yet.
let inIntakeColumnExists = null;
async function hasInIntakeReviewColumn(sup) {
  if (inIntakeColumnExists !== null) return inIntakeColumnExists;
  const { error } = await sup.from('cases').select('in_intake_review').limit(1);
  inIntakeColumnExists = !error;
  return inIntakeColumnExists;
}

// GET /api/cases — list all cases
router.get('/cases', requirePermission('cases', 'view'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { status, priority, search, assigned_to, agency_ids, employee_ids, classification_ids, date_from, date_to, limit, offset } = req.query;

    let query = sup
      .from('cases')
      .select('*', { count: 'exact' });

    // القضايا only ever shows cases that have been promoted out of
    // استقبال ذكي's triage queue (or were created directly via this same
    // route's own POST, which never sets the flag at all) -- a case still
    // sitting in intake review is a different section entirely.
    if (await hasInIntakeReviewColumn(sup)) query = query.not('in_intake_review', 'is', true);

    // status/priority accept a comma-separated list (e.g. "open,in_progress")
    // so the filter panel can multi-select either -- .in() with a single
    // value behaves identically to .eq(), so this doesn't change existing
    // single-value callers.
    if (status) query = query.in('status', status.split(',').map(s => s.trim()).filter(Boolean));
    if (priority) query = query.in('priority', priority.split(',').map(s => s.trim()).filter(Boolean));
    if (assigned_to) query = query.eq('assigned_to', assigned_to);
    if (date_from) query = query.gte('created_at', date_from);
    // date_to is a plain "YYYY-MM-DD" -- compared as-is it would exclude
    // every case created that day itself (same fix already applied to the
    // Inbox date-range filter).
    if (date_to) query = query.lt('created_at', `${date_to}T23:59:59.999`);

    // Agencies and employees aren't columns on `cases` itself (an agency is
    // linked via `requests`, an employee via `case_assignees`) -- resolve
    // each to a set of matching case ids first, then intersect them with
    // AND (a case must match every active filter category, not just one)
    // before applying to the main query.
    let candidateCaseIds = null; // null = no restriction from this filter group yet
    const intersect = (ids) => {
      const set = new Set(ids);
      candidateCaseIds = candidateCaseIds === null ? set : new Set([...candidateCaseIds].filter(id => set.has(id)));
    };
    if (search) {
      // Resolved via separate single-column ilike queries instead of a
      // hand-rolled .or("title.ilike.%x%,...") string -- PostgREST parses
      // that string's own commas/parens as ITS filter-grammar syntax, so a
      // search term that happens to contain either (e.g. "Smith, John")
      // broke the ENTIRE query with a 500 instead of just not matching.
      // Covers the case's own title/client_name/uuid/id, an uploaded
      // document's filename, a linked email's subject/sender/recipient (the
      // agency's own address is usually the RECIPIENT on an outbound email,
      // not the sender -- missing that was a reported gap: searching an
      // agency's registered email found nothing), the agency's own email,
      // its case-specific channel email, and each request's reference
      // number. Portal confirmation numbers are covered for free since
      // documentCenter.js's portal-submission logger embeds "رقم التأكيد:
      // {confirmation_number}" directly into the synthesized communication's
      // subject.
      //
      // Promise.allSettled, not Promise.all: an earlier version used
      // Promise.all across ~13 parallel sub-queries (including team-comment
      // text and checklist notes, trimmed back out below) -- a single
      // transient failure on ANY one of them rejected the whole batch and
      // took the entire cases list down with a 500 ("تعذر تحميل القضايا"),
      // reported live while testing this exact search. Each source below is
      // now independent: one failing just contributes nothing instead of
      // failing the whole request, and is logged so a real, recurring
      // problem with one source doesn't disappear silently either.
      const term = `%${search}%`;
      const sources = [
        ['title', () => sup.from('cases').select('id').ilike('title', term).then(r => ({ ...r, key: 'id' }))],
        ['client_name', () => sup.from('cases').select('id').ilike('client_name', term).then(r => ({ ...r, key: 'id' }))],
        ['uuid', () => sup.from('cases').select('id').ilike('uuid', term).then(r => ({ ...r, key: 'id' }))],
        ['document name', () => sup.from('case_documents').select('case_id').ilike('original_name', term).then(r => ({ ...r, key: 'case_id' }))],
        ['comm subject', () => sup.from('communications').select('case_id').ilike('subject', term).then(r => ({ ...r, key: 'case_id' }))],
        ['comm sender', () => sup.from('communications').select('case_id').ilike('sender', term).then(r => ({ ...r, key: 'case_id' }))],
        ['comm recipient', () => sup.from('communications').select('case_id').ilike('recipient', term).then(r => ({ ...r, key: 'case_id' }))],
        ['agency email', async () => {
          const { data } = await sup.from('agencies').select('id').ilike('email', term);
          const agencyIds = (data || []).map(a => a.id);
          if (!agencyIds.length) return { data: [], key: 'case_id' };
          return { ...(await sup.from('requests').select('case_id').in('agency_id', agencyIds)), key: 'case_id' };
        }],
        ['channel email', () => sup.from('case_agency_channels').select('case_id').ilike('email', term).then(r => ({ ...r, key: 'case_id' }))],
        ['request reference number', () => sup.from('requests').select('case_id').ilike('reference_number', term).then(r => ({ ...r, key: 'case_id' }))],
      ];
      const settled = await Promise.allSettled(sources.map(([, run]) => run()));
      const matchedIds = [];
      settled.forEach((result, i) => {
        const [label] = sources[i];
        if (result.status === 'rejected') {
          console.error(`[cases search] "${label}" source failed:`, result.reason?.message || result.reason);
          return;
        }
        const { data, error, key } = result.value;
        if (error) { console.error(`[cases search] "${label}" source errored:`, error.message); return; }
        (data || []).forEach(r => matchedIds.push(r[key]));
      });
      // Case number: not text, so ilike can't match it directly -- fetch every
      // id once and compare as a string instead, only when the search term
      // actually contains a digit (skips the wasted round-trip otherwise).
      if (/\d/.test(search)) {
        try {
          const { data: allIds } = await sup.from('cases').select('id');
          (allIds || []).forEach(c => { if (String(c.id).includes(search.trim())) matchedIds.push(c.id); });
        } catch (e) { console.error('[cases search] case-number source failed:', e.message); }
      }
      intersect(matchedIds);
    }
    if (agency_ids) {
      const ids = agency_ids.split(',').map(s => parseInt(s)).filter(Number.isFinite);
      if (ids.length) {
        const { data: rows } = await sup.from('requests').select('case_id').in('agency_id', ids);
        intersect((rows || []).map(r => r.case_id));
      }
    }
    if (employee_ids) {
      const ids = employee_ids.split(',').map(s => parseInt(s)).filter(Number.isFinite);
      if (ids.length) {
        const { data: rows } = await sup.from('case_assignees').select('case_id').in('user_id', ids);
        intersect((rows || []).map(r => r.case_id));
      }
    }
    // Classification isn't a column on `cases` either -- it's derived per-case
    // from the case's `requests.classification_id` values, same as the badge
    // computed further down. 'not_started' is a synthetic id (matches the
    // "لم يبدأ بعد" badge) meaning the case has NO classified request at all
    // -- including cases with zero requests -- so it can't be resolved with a
    // plain .in() the way a real pipeline_lists id can.
    if (classification_ids) {
      const rawIds = classification_ids.split(',').map(s => s.trim()).filter(Boolean);
      const notStartedSelected = rawIds.includes('not_started');
      const realIds = rawIds.filter(id => id !== 'not_started').map(id => parseInt(id)).filter(Number.isFinite);
      const matched = new Set();
      if (realIds.length) {
        const { data: rows } = await sup.from('requests').select('case_id').in('classification_id', realIds);
        (rows || []).forEach(r => matched.add(r.case_id));
      }
      if (notStartedSelected) {
        const { data: classifiedRows } = await sup.from('requests').select('case_id').not('classification_id', 'is', null);
        const classifiedCaseIds = new Set((classifiedRows || []).map(r => r.case_id));
        const { data: allCaseIdRows } = await sup.from('cases').select('id');
        (allCaseIdRows || []).forEach(c => { if (!classifiedCaseIds.has(c.id)) matched.add(c.id); });
      }
      intersect([...matched]);
    }
    if (candidateCaseIds !== null) {
      if (candidateCaseIds.size === 0) return res.json({ data: [], total: 0 });
      query = query.in('id', [...candidateCaseIds]);
    }
    // Real pagination for Cases.jsx (offset can legitimately be 0 for page
    // 1 -- `if (offset)` treated 0 as falsy and silently skipped .range()
    // for the very first page, falling through to the flat 1000-row cap
    // below instead of an actual 100-row page). Callers that don't paginate
    // at all (CaseGDrive/MailLogs/PhoneLogs, populating a "pick a case"
    // dropdown) still get the same uncapped-up-to-1000 behavior as before by
    // simply not passing these params.
    const pageLimit = limit ? parseInt(limit) : 1000;
    const pageOffset = offset !== undefined ? parseInt(offset) : 0;
    query = query.range(pageOffset, pageOffset + pageLimit - 1);
    query = query.order('created_at', { ascending: false });

    // Case visibility scope: a role without cases.view_all only sees cases
    // it's assigned to / created, not the whole organization's caseload.
    query = await scopeCasesQuery(sup, query, req.user);
    if (!query) return res.json({ data: [], total: 0 });

    const { data: cases, count, error } = await query;
    if (error) throw error;

    // request_count/classified_count per case in ONE extra round trip instead
    // of 2 sequential count queries per case (was 2N+1 total; PostgREST calls
    // are HTTP round trips, so that scaled linearly with the caseload — a
    // few hundred cases meant 1000+ sequential requests just to list them).
    const caseIds = (cases || []).map(c => c.id);
    const countsByCase = {};
    const classIdsByCase = {};
    if (caseIds.length) {
      const { data: requestRows } = await sup.from('requests').select('case_id, classification_id').in('case_id', caseIds);
      for (const r of requestRows || []) {
        if (!countsByCase[r.case_id]) countsByCase[r.case_id] = { request_count: 0, classified_count: 0 };
        countsByCase[r.case_id].request_count++;
        if (r.classification_id != null) countsByCase[r.case_id].classified_count++;
        if (r.classification_id != null) {
          if (!classIdsByCase[r.case_id]) classIdsByCase[r.case_id] = new Set();
          classIdsByCase[r.case_id].add(r.classification_id);
        }
      }
    }

    // Per-case unread-activity badge -- deliberately narrow to things that
    // actually need a human's attention on THIS case (a note/mention from a
    // teammate, an email arriving, a file landing -- whether in the general
    // discussion or a checklist item's own notes, same case_comment(_mention)
    // notification either way). Explicitly excludes routine/administrative
    // notifications like "case created" or "status changed" -- those still
    // reach the general bell, just don't clutter every case row with a red
    // badge for something that isn't actually asking for attention.
    const unreadByCase = {};
    if (caseIds.length) {
      const { data: unreadRows } = await sup.from('notifications')
        .select('target_id, type, title, body, created_at').eq('user_id', req.user.id).eq('target_type', 'case')
        .eq('is_read', false).in('target_id', caseIds).in('type', CASE_BADGE_TYPES)
        .order('created_at', { ascending: false });
      for (const n of unreadRows || []) {
        if (!unreadByCase[n.target_id]) unreadByCase[n.target_id] = [];
        unreadByCase[n.target_id].push({ type: n.type, title: n.title, body: n.body, created_at: n.created_at });
      }
    }

    // Surface the case's current classification (which pipeline list its
    // request(s) are in) so it's visible outside the case itself, not only
    // on the Pipeline board -- a case with no requests, or whose requests
    // haven't been classified yet, shows the same "لم يبدأ بعد" a fresh
    // request is now classified as by default (see POST /cases).
    const { data: allLists } = await sup.from('pipeline_lists').select('id, name_ar, name_en, color');
    const listById = Object.fromEntries((allLists || []).map(l => [l.id, l]));
    const notStarted = (allLists || []).find(l => l.name_en === 'Not Started');

    const result = (cases || []).map(c => {
      const distinctClassIds = [...(classIdsByCase[c.id] || [])];
      let classification_name = notStarted?.name_ar || 'لم يبدأ بعد';
      let classification_color = notStarted?.color || '#6B7280';
      let classification_mixed = false;
      if (distinctClassIds.length === 1) {
        const list = listById[distinctClassIds[0]];
        if (list) { classification_name = list.name_ar; classification_color = list.color; }
      } else if (distinctClassIds.length > 1) {
        classification_mixed = true;
        classification_name = 'تصنيفات متعددة';
        classification_color = '#8B5CF6';
      }
      return {
        ...c,
        assigned_user_name: c.users_cases_assigned_to_fkey?.name || null,
        created_by_name: c.users_cases_created_by_fkey?.name || null,
        request_count: countsByCase[c.id]?.request_count || 0,
        classified_count: countsByCase[c.id]?.classified_count || 0,
        unread_notification_count: (unreadByCase[c.id] || []).length,
        unread_notifications: unreadByCase[c.id] || [],
        classification_name, classification_color, classification_mixed,
        users_cases_assigned_to_fkey: undefined,
        users_cases_created_by_fkey: undefined
      };
    });

    res.json({ data: result, total: count || 0 });
  } catch (err) {
    console.error('[GET /cases] failed:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/cases/:id/notifications/read — dismiss THIS case's activity badge
// from the القضايا list without having to open the full case (opening the
// case already does this too, via case_detail.routes.js's dashboard route --
// this lets the badge's own "why" popover double as "seen it, dismiss it").
// Scoped to the SAME CASE_BADGE_TYPES the badge/popover actually display --
// without this, it silently mark-read OTHER unread case notifications too
// (case_created, case_status_changed) that the popover never showed, making
// them vanish from the general bell with the user never having seen them.
router.put('/cases/:id/notifications/read', requireCaseAccess('id'), async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    const { error } = await sup.from('notifications').update({ is_read: true })
      .eq('user_id', req.user.id).eq('target_type', 'case').eq('target_id', caseId).eq('is_read', false)
      .in('type', CASE_BADGE_TYPES);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/cases/:id — full case detail
router.get('/cases/:id', requirePermission('cases', 'view'), async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    if (isNaN(caseId)) return res.status(400).json({ error: 'Invalid case ID' });

    if (!(await canAccessCase(sup, req.user, caseId))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }

    const { data: caseRow, error } = await sup
      .from('cases')
      .select(`*`)
      .eq('id', caseId)
      .maybeSingle();

    if (error) throw error;
    if (!caseRow) return res.status(404).json({ error: 'Case not found' });

    // Six independent reads keyed only on caseId -- previously six sequential
    // `await`s, one after another, when none of them depend on the others'
    // results. dashboard.js and case_detail.routes.js's /dashboard endpoint
    // both already batch their equivalent queries via Promise.all (with a
    // comment to that effect); this endpoint was the one left serial.
    const [
      { data: requests },
      { data: communications },
      { data: documents },
      { data: comments },
      { data: phoneLogs },
      { data: mailLogs },
    ] = await Promise.all([
      sup.from('requests')
        .select(`*, agencies!left(name_ar, name_en, state, email, phone), pipeline_lists!left(name_ar, name_en, color, list_number), email_accounts!left(email, name)`)
        .eq('case_id', caseId).order('created_at', { ascending: false }),
      sup.from('communications')
        .select(`*, requests!left(agencies!inner(name_en))`)
        .eq('case_id', caseId).order('created_at', { ascending: false }),
      sup.from('case_documents').select(`*, users!left(name)`).eq('case_id', caseId).order('created_at', { ascending: false }),
      sup.from('case_comments').select(`*, users!left(name)`).eq('case_id', caseId).order('created_at', { ascending: false }),
      sup.from('phone_logs').select('*').eq('case_id', caseId).order('created_at', { ascending: false }),
      sup.from('mail_logs').select('*').eq('case_id', caseId).order('created_at', { ascending: false }),
    ]);

    const requestsMapped = (requests || []).map(r => ({
      ...r,
      agency_name_ar: r.agencies?.name_ar || null,
      agency_name_en: r.agencies?.name_en || null,
      agency_state: r.agencies?.state || null,
      agency_email: r.agencies?.email || null,
      agency_phone: r.agencies?.phone || null,
      classification_name_ar: r.pipeline_lists?.name_ar || null,
      classification_name_en: r.pipeline_lists?.name_en || null,
      classification_color: r.pipeline_lists?.color || null,
      list_number: r.pipeline_lists?.list_number || null,
      account_email: r.email_accounts?.email || null,
      account_name: r.email_accounts?.name || null,
      agencies: undefined,
      pipeline_lists: undefined,
      email_accounts: undefined
    }));

    const communicationsMapped = (communications || []).map(c => ({
      ...c,
      agency_name: c.requests?.agencies?.name_en || null,
      requests: undefined
    }));

    const documentsMapped = (documents || []).map(d => ({
      ...d,
      uploaded_by_name: d.users?.name || null,
      users: undefined
    }));

    const commentsMapped = (comments || []).map(c => ({
      ...c,
      user_name: c.users?.name || null,
      users: undefined
    }));

    res.json({
      ...caseRow,
      assigned_user_name: caseRow.users_cases_assigned_to_fkey?.name || null,
      created_by_name: caseRow.users_cases_created_by_fkey?.name || null,
      users_cases_assigned_to_fkey: undefined,
      users_cases_created_by_fkey: undefined,
      requests: requestsMapped,
      communications: communicationsMapped,
      documents: documentsMapped,
      comments: commentsMapped,
      phoneLogs: phoneLogs || [],
      mailLogs: mailLogs || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cases — create a case with agencies
router.post('/cases', requirePermission('cases', 'create'), async (req, res) => {
  try {
    const sup = getSupabase();
    const { title, description, priority, client_name, assigned_to, deadline, agencies,
      defendant_name, source_agency_name, story_hook, article_url, case_summary } = req.body;

    if (!title) return res.status(400).json({ error: 'عنوان القضية مطلوب' });

    const { v4: uuidv4 } = require('uuid');
    const uuid = uuidv4();
    const now = new Date().toISOString();

    // 1. Create the case
    const { data: caseRow, error: caseError } = await sup
      .from('cases')
      .insert({
        uuid,
        title,
        description: description || '',
        status: 'open',
        priority: priority || 'medium',
        client_name: client_name || null,
        created_by: req.user?.id || null,
        assigned_to: assigned_to || null,
        deadline: deadline || null,
        defendant_name: defendant_name || null,
        source_agency_name: source_agency_name || null,
        story_hook: story_hook || null,
        article_url: article_url || null,
        case_summary: case_summary || null,
        created_at: now,
        updated_at: now
      })
      .select()
      .single();

    if (caseError) throw caseError;
    const caseId = caseRow.id;

    // 2. Create requests for each agency
    if (agencies && Array.isArray(agencies) && agencies.length > 0) {
      // Every new request should start visibly classified as "لم يبدأ بعد"
      // (Not Started) rather than left unclassified (classification_id
      // null), so it shows up on the Pipeline board immediately instead of
      // being invisible until someone manually classifies it. Looked up by
      // name rather than hardcoding an id -- pipeline_lists ids are
      // environment-specific (seeded rows, not fixed ids), and the frontend
      // used to auto-classify to a hardcoded classification_id: 1 which
      // doesn't exist in this environment's pipeline_lists table at all,
      // silently failing PUT /requests/:id/classification's own
      // "Invalid classification_id" check on every single case creation.
      const { data: notStartedList } = await sup.from('pipeline_lists')
        .select('id').eq('name_en', 'Not Started').maybeSingle();
      for (const agency of agencies) {
        const { error: reqErr } = await sup
          .from('requests')
          .insert({
            case_id: caseId,
            agency_id: agency.agency_id || agency.id || null,
            status: 'pending',
            channel_method: 'email',
            sent_date: agency.sent_date || null,
            notes: agency.notes || null,
            classification_id: notStartedList?.id || null,
            created_at: now
          });
        // Best-effort: the case itself is already created at this point, so
        // one bad agency_id shouldn't fail the whole request -- but this
        // was previously never checked at all, meaning the case could end
        // up with fewer (or zero) attached agencies than requested with no
        // error anywhere. The response below re-fetches requests fresh, so
        // it always reflects what actually landed regardless.
        if (reqErr) console.error(`[cases] request insert failed for agency ${agency.agency_id || agency.id}:`, reqErr.message);
      }

      // Add comment about agencies
      const { error: commentErr } = await sup
        .from('case_comments')
        .insert({
          case_id: caseId,
          user_id: req.user?.id || null,
          content: `📋 تم إنشاء القضية وإضافة ${agencies.length} جهة`,
          created_at: now
        });
      if (commentErr) console.error('[cases] case_comments insert failed:', commentErr.message);
    } else {
      const { error: commentErr } = await sup
        .from('case_comments')
        .insert({
          case_id: caseId,
          user_id: req.user?.id || null,
          content: '📋 تم إنشاء القضية',
          created_at: now
        });
      if (commentErr) console.error('[cases] case_comments insert failed:', commentErr.message);
    }

    // 3. Activity log
    logActivity({
      user_id: req.user?.id,
      user_name: req.user?.name,
      action_type: 'create',
      target_type: 'case',
      target_id: caseId,
      target_title: title,
      details: `تم إنشاء القضية مع ${agencies?.length || 0} جهة`
    });

    // 4. Return full case
    const { data: newCase } = await sup
      .from('cases')
      .select('*')
      .eq('id', caseId)
      .single();

    const { data: newRequests } = await sup
      .from('requests')
      .select(`*, agencies!left(name_ar, name_en)`)
      .eq('case_id', caseId);

    const newRequestsMapped = (newRequests || []).map(r => ({
      ...r,
      agency_name_ar: r.agencies?.name_ar || null,
      agency_name_en: r.agencies?.name_en || null,
      agencies: undefined
    }));

    // Notify the assignee (if one was set at creation), plus anyone whose
    // role grants "see every case" -- supervisors should know a new case
    // exists even if they weren't personally assigned to it, without a
    // hardcoded "admins only" list. Best-effort: a notify failure must never
    // fail the response for a case that was already created successfully.
    try {
      const supervisorIds = await getUsersWithPermission(sup, 'cases', 'view_all', { excludeUserId: req.user?.id });
      const assigneeIds = assigned_to && parseInt(assigned_to) !== req.user?.id ? [parseInt(assigned_to)] : [];
      await notifyUsers(sup, [...new Set([...supervisorIds, ...assigneeIds])], {
        type: 'case_created', title: '📁 قضية جديدة', body: `${req.user?.name || 'أحد الموظفين'} أنشأ القضية "${title}"`,
        target_type: 'case', target_id: caseId,
      });
    } catch (e) { console.error('[cases] create notification failed:', e.message); }

    if (newCase) {
      newCase.assigned_user_name = newCase.users_cases_assigned_to_fkey?.name || null;
      delete newCase.users_cases_assigned_to_fkey;
    }

    res.status(201).json({ ...newCase, requests: newRequestsMapped });
  } catch (err) {
    console.error('Error creating case:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/cases/:id
router.put('/cases/:id', requirePermission('cases', 'edit'), requireCaseAccess('id'), async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);

    const { data: existing } = await sup.from('cases').select('*').eq('id', caseId).single();
    if (!existing) return res.status(404).json({ error: 'Case not found' });

    const { title, description, status, priority, client_name, assigned_to, deadline,
      defendant_name, source_agency_name, story_hook, article_url, case_summary } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (priority !== undefined) updates.priority = priority;
    if (client_name !== undefined) updates.client_name = client_name;
    if (assigned_to !== undefined) updates.assigned_to = assigned_to;
    if (deadline !== undefined) updates.deadline = deadline;
    if (defendant_name !== undefined) updates.defendant_name = defendant_name;
    if (source_agency_name !== undefined) updates.source_agency_name = source_agency_name;
    if (story_hook !== undefined) updates.story_hook = story_hook;
    if (article_url !== undefined) updates.article_url = article_url;
    if (case_summary !== undefined) updates.case_summary = case_summary;
    updates.updated_at = new Date().toISOString();

    // supabase-js resolves {data, error} rather than throwing -- an ignored
    // error here would silently report success on a rejected update, same
    // class of bug just fixed in users.js's PUT /users/:id.
    const { error: updateError } = await sup.from('cases').update(updates).eq('id', caseId);
    if (updateError) return res.status(400).json({ error: updateError.message });

    const { data: updated } = await sup.from('cases').select('*').eq('id', caseId).single();

    // Notify on the two changes that matter most to someone NOT already
    // watching every field: getting newly assigned, and the case moving to
    // a different status. Both are best-effort -- the update itself already
    // succeeded above regardless of what happens here.
    try {
      if (updates.assigned_to !== undefined && parseInt(updates.assigned_to) !== existing.assigned_to
          && parseInt(updates.assigned_to) !== req.user?.id && updates.assigned_to) {
        await notifyUsers(sup, [parseInt(updates.assigned_to)], {
          type: 'case_assigned', title: '📌 تم تعيينك مسؤولاً عن قضية', body: `${req.user?.name || 'أحد الموظفين'} أوكل لك القضية "${existing.title}"`,
          target_type: 'case', target_id: caseId,
        });
      }
      if (updates.status !== undefined && updates.status !== existing.status) {
        const recipients = await getCaseRecipients(sup, caseId, { excludeUserId: req.user?.id });
        await notifyUsers(sup, recipients, {
          type: 'case_status_changed', title: '🔄 تحديث حالة القضية', body: `${req.user?.name || 'أحد الموظفين'} حدّث حالة القضية "${existing.title}" إلى: ${updates.status}`,
          target_type: 'case', target_id: caseId,
        });
      }
    } catch (e) { console.error('[cases] update notification failed:', e.message); }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cases/:id
router.delete('/cases/:id', requirePermission('cases', 'delete'), requireCaseAccess('id'), async (req, res) => {
  const sup = getSupabase();
  const id = parseInt(req.params.id);

  const { data: c } = await sup.from('cases').select('id, title').eq('id', id).single();
  if (!c) return res.status(404).json({ error: 'Case not found' });

  const { error } = await sup.from('cases').delete().eq('id', id);
  if (error) return res.status(500).json({ success: false, error: error.message });

  logActivity({
    user_id: req.user?.id,
    user_name: req.user?.name,
    action_type: 'delete',
    target_type: 'case',
    target_id: id,
    target_title: c.title,
    details: 'تم حذف القضية'
  });

  res.json({ success: true, message: '✅ تم حذف القضية' });
});

// POST /api/cases/:id/comments — add a team-discussion comment, optionally
// with an attached image/file (uploaded to Drive, same as case documents) or
// a plain link (no upload, just a URL the poster pastes). multer only
// activates for multipart/form-data bodies -- a plain JSON, text-only
// comment (no file) still works via express.json() untouched, so the
// frontend can post either way through the same route.
router.post('/cases/:id/comments', commentUpload.single('file'), async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    // Never checked before (pre-existing gap, not introduced by the
    // attachment work) -- a role restricted to only its assigned cases
    // could still post/read team-discussion comments on ANY case just by
    // knowing its id, same class of issue already fixed on gdrive.js's
    // case-scoped routes this session.
    if (!(await canAccessCase(sup, req.user, caseId))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }
    const { content, link_url, link_label, reply_to_id, record_type } = req.body;
    if (!content && !req.file && !link_url) return res.status(400).json({ error: 'content أو مرفق أو رابط مطلوب' });
    // null (general "نقاش الفريق") vs a checklist record_type (e.g.
    // 'body_cam') are two SEPARATE note threads sharing this one table --
    // normalize '' to null so both call sites agree on what "no scope" means.
    const recordType = record_type || null;

    // mentioned_user_ids arrives as a JSON-stringified array (multipart
    // form fields are all strings -- no native array support), same
    // reasoning as parsing metadata JSON blobs elsewhere in this file.
    let mentionedIds = [];
    if (req.body.mentioned_user_ids) {
      try {
        const parsed = JSON.parse(req.body.mentioned_user_ids);
        if (Array.isArray(parsed)) mentionedIds = parsed.map(n => parseInt(n)).filter(Number.isFinite);
      } catch { /* malformed input -- ignore rather than fail the whole comment */ }
    }

    let replyToId = null;
    if (reply_to_id) {
      const parsedReplyId = parseInt(reply_to_id);
      if (parsedReplyId) {
        // Replying only makes sense to a comment on the SAME case AND the
        // SAME scope (general discussion vs this specific checklist item) --
        // confirm rather than trust the client, so a reply_to_id can't be
        // used to leak a comment id from a case (or a different checklist
        // item's thread) this user can't otherwise see.
        const { data: target } = await sup.from('case_comments').select('id, case_id, record_type').eq('id', parsedReplyId).maybeSingle();
        if (target && target.case_id === caseId && (target.record_type || null) === recordType) replyToId = parsedReplyId;
      }
    }

    const now = new Date().toISOString();
    const insertData = {
      case_id: caseId, user_id: req.user?.id || null,
      content: content || '', created_at: now,
      reply_to_id: replyToId, mentioned_user_ids: mentionedIds, record_type: recordType,
    };

    if (req.file) {
      if (!(await gdrive.isConnected())) {
        return res.status(503).json({ error: 'حساب Google Drive غير متصل — لازم يتم ربطه قبل إرفاق ملف' });
      }
      try {
        const driveFields = await caseFileStorage.saveCaseFile({
          caseId, buffer: req.file.buffer, fileName: req.file.originalname, mimeType: req.file.mimetype, category: 'attachments',
        });
        const isImage = (req.file.mimetype || '').startsWith('image/');
        // file_path is Drive's webViewLink -- opens Drive's HTML viewer page,
        // not raw image bytes, so an <img src=...> tag never renders it (just
        // a broken-image icon). A direct drive.google.com/uc?export=view link
        // does serve raw bytes, but the CDN it redirects to sends
        // `Cross-Origin-Resource-Policy: same-site`, which the browser
        // enforces and blocks once embedded cross-origin from our own app --
        // it only appeared to work when the link was opened directly.
        // Routing through our own backend (/api/gdrive/image/:fileId) makes
        // the request same-origin instead. Only swap it in for images; other
        // file types still want the normal Drive viewer link when clicked.
        insertData.attachment_url = isImage ? `/api/gdrive/image/${driveFields.drive_file_id}` : driveFields.file_path;
        insertData.attachment_type = isImage ? 'image' : 'file';
        insertData.attachment_name = req.file.originalname;

        // Any file attached anywhere in the case -- general discussion or a
        // specific checklist item's notes -- counts as a real case document,
        // not just something buried in a comment thread. Best-effort: a
        // failure here doesn't fail the comment itself, matching how the
        // Drive upload above already degrades (comment still posts even if
        // this secondary bookkeeping insert doesn't).
        try {
          const ext = (req.file.originalname.match(/\.[^.]+$/) || [''])[0].toLowerCase();
          const fileType = isImage ? 'image'
            : ['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext) ? 'video'
            : ['.mp3', '.wav', '.ogg', '.flac'].includes(ext) ? 'audio' : 'document';
          const { error: docErr } = await sup.from('case_documents').insert({
            case_id: caseId,
            filename: req.file.originalname, original_name: req.file.originalname,
            mime_type: req.file.mimetype, size: req.file.size,
            file_type: fileType, uploaded_by: req.user?.id,
            source: 'discussion',
            description: recordType ? `مرفق من قائمة التدقيق: ${recordType}` : 'مرفق من نقاش الفريق',
            ...driveFields, url: driveFields.file_path,
          });
          if (docErr) console.error('[comments] case_documents auto-link failed:', docErr.message);
        } catch (docErr) { console.error('[comments] case_documents auto-link threw:', docErr.message); }
      } catch (uploadErr) {
        return res.status(500).json({ error: 'فشل رفع المرفق: ' + uploadErr.message });
      }
    } else if (link_url) {
      insertData.attachment_url = link_url;
      insertData.attachment_type = 'link';
      insertData.attachment_name = link_label || link_url;
    }

    // The migration adding attachment_url/type/name may not have been run
    // yet in this environment -- retry without those columns rather than
    // failing the whole comment (matches the same self-healing pattern used
    // for case_documents/agencies inserts elsewhere in this codebase).
    let { data: comment, error } = await sup.from('case_comments').insert(insertData).select(`*, users!left(name)`).single();
    while (error && /column .* does not exist|Could not find the '(\w+)' column/.test(error.message)) {
      const m = error.message.match(/'(\w+)' column|column "(\w+)"/);
      const badCol = m && (m[1] || m[2]);
      if (!badCol || !(badCol in insertData)) break;
      delete insertData[badCol];
      ({ data: comment, error } = await sup.from('case_comments').insert(insertData).select(`*, users!left(name)`).single());
    }
    if (error) throw error;

    comment.user_name = comment.users?.name || null;
    delete comment.users;

    try {
      const bodyText = content ? (content.length > 120 ? content.slice(0, 120) + '…' : content) : (insertData.attachment_name ? `📎 ${insertData.attachment_name}` : 'تعليق جديد');
      // Mentioned team members get a distinct, higher-signal notification --
      // excluded from the general broadcast below so a directly-addressed
      // person doesn't see the same comment reported to them twice.
      if (mentionedIds.length) {
        await notifyUsers(sup, mentionedIds.filter(id => id !== req.user?.id), {
          type: 'case_comment_mention', title: `📣 ${req.user?.name || 'أحد الموظفين'} وجّه لك ملاحظة`, body: bodyText,
          target_type: 'case', target_id: caseId,
        });
      }
      // Badge-eligible activity also reaches supervisors (cases.view_all),
      // not just this case's own team -- so a manager overseeing every case
      // sees the same red badge on ANY case with recent activity, not only
      // the handful they happen to be personally attached to.
      const recipients = (await getCaseActivityRecipients(sup, caseId, { excludeUserId: req.user?.id }))
        .filter(id => !mentionedIds.includes(id));
      await notifyUsers(sup, recipients, {
        type: 'case_comment', title: `💬 ${req.user?.name || 'أحد الموظفين'} أضاف تعليقًا جديدًا`, body: bodyText,
        target_type: 'case', target_id: caseId,
      });
    } catch (e) { console.error('[comments] notification failed:', e.message); }

    res.status(201).json(comment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cases/:id/comments/:commentId — three ways in: the author
// within 60s of posting (typo/second-thoughts window, not a permanent
// edit-undo), an admin at any time, or a role explicitly granted
// case_comments/delete_any from الصلاحيات (for e.g. a manager who should be
// able to moderate a case's discussion without being a full admin).
router.delete('/cases/:id/comments/:commentId', async (req, res) => {
  try {
    const sup = getSupabase();
    const caseId = parseInt(req.params.id);
    const commentId = parseInt(req.params.commentId);
    if (!(await canAccessCase(sup, req.user, caseId))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }

    const { data: comment } = await sup.from('case_comments').select('id, case_id, user_id, created_at').eq('id', commentId).maybeSingle();
    if (!comment || comment.case_id !== caseId) return res.status(404).json({ error: 'التعليق غير موجود' });

    const isOwnWithinWindow = comment.user_id === req.user?.id && (Date.now() - new Date(comment.created_at).getTime()) <= 60 * 1000;
    const canDeleteAny = await hasPermission(sup, req.user, 'case_comments', 'delete_any');
    if (!isOwnWithinWindow && !canDeleteAny) {
      return res.status(403).json({ error: 'لا يمكن حذف هذا التعليق — يمكن حذف تعليقك خلال دقيقة واحدة من نشره فقط' });
    }

    const { error } = await sup.from('case_comments').delete().eq('id', commentId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/requests/:id/classification — move request to different pipeline list
router.put('/requests/:id/classification', async (req, res) => {
  try {
    const sup = getSupabase();
    const requestId = parseInt(req.params.id);
    const { classification_id } = req.body;

    if (!classification_id) return res.status(400).json({ error: 'classification_id مطلوب' });

    const { data: existing } = await sup.from('requests').select('*').eq('id', requestId).single();
    if (!existing) return res.status(404).json({ error: 'Request not found' });
    // :id here is the REQUEST id, not a case id -- resolve the request's own
    // case_id (already fetched above) and check THAT, since requirePermission
    // (not even present on this route at all before) only confirms a role
    // CAN classify requests in general, never that this specific case is
    // one the user is allowed to touch.
    if (!(await canAccessCase(sup, req.user, existing.case_id))) {
      return res.status(403).json({ error: 'Forbidden — هذه القضية غير مسندة إليك' });
    }

    const { data: list } = await sup.from('pipeline_lists').select('id').eq('id', classification_id).single();
    if (!list) return res.status(400).json({ error: 'Invalid classification_id' });

    const { error: classifyErr } = await sup
      .from('requests')
      .update({ classification_id, status: 'classified' })
      .eq('id', requestId);
    if (classifyErr) return res.status(400).json({ error: classifyErr.message });

    // Add timeline entry
    const { data: listName } = await sup.from('pipeline_lists').select('name_ar').eq('id', classification_id).single();
    const classificationLabel = listName?.name_ar || 'تصنيف ' + classification_id;
    await sup
      .from('case_comments')
      .insert({
        case_id: existing.case_id,
        content: `📌 تم تصنيف الرد: "${classificationLabel}"`,
        created_at: new Date().toISOString()
      });

    // Activity log
    const { data: agency } = await sup.from('agencies').select('name_en').eq('id', existing.agency_id).single();
    logActivity({
      user_id: req.user?.id,
      user_name: req.user?.name,
      action_type: 'classify',
      target_type: 'request',
      target_id: requestId,
      target_title: `طلب #${requestId} ← ${classificationLabel}`,
      details: agency ? `الجهة: ${agency.name_en}` : ''
    });

    const { data: updated } = await sup
      .from('requests')
      .select(`*, agencies!left(name_ar, name_en), pipeline_lists!left(name_ar, name_en, color, list_number)`)
      .eq('id', requestId)
      .single();

    if (updated) {
      updated.agency_name_ar = updated.agencies?.name_ar || null;
      updated.agency_name_en = updated.agencies?.name_en || null;
      updated.classification_name_ar = updated.pipeline_lists?.name_ar || null;
      updated.classification_name_en = updated.pipeline_lists?.name_en || null;
      updated.classification_color = updated.pipeline_lists?.color || null;
      updated.list_number = updated.pipeline_lists?.list_number || null;
      delete updated.agencies;
      delete updated.pipeline_lists;
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== EXCEL UPLOAD — BULK CASES ====================
const multer2 = require('multer');
const XLSX2 = require('xlsx');
const path2 = require('path');

// xlsx can parse straight from the in-memory buffer (XLSX.read, not
// XLSX.readFile) -- no disk write needed at all, so this sidesteps Vercel's
// read-only filesystem entirely instead of silently failing to persist
// anything under the deployed bundle's uploads/ dir like it used to.
const uploadCases = multer2({
  storage: multer2.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path2.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) cb(null, true);
    else cb(new Error('يرجى رفع ملف Excel'));
  }
});

// POST /api/cases/upload — رفع Excel بقضايا
router.post('/cases/upload', requireAuth, uploadCases.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });

    const workbook = XLSX2.read(req.file.buffer, { type: 'buffer' });
    const data = XLSX2.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });

    if (data.length === 0) return res.json({ success: true, imported: 0, message: 'الملف فارغ' });

    const sup = getSupabase();
    const { v4: uuidv4 } = require('uuid');
    const now = new Date().toISOString();

    // Detect columns
    const colMap = {};
    const sample = data[0];
    for (const key of Object.keys(sample)) {
      const k = key.toLowerCase().trim();
      if (k === 'title' || k === 'عنوان' || k === 'case' || k === 'case title' || k === 'العنوان') colMap.title = key;
      else if (k === 'description' || k === 'وصف' || k === 'details' || k === 'تفاصيل') colMap.description = key;
      else if (k === 'priority' || k === 'أولوية' || k === 'priority') colMap.priority = key;
      else if (k === 'client_name' || k === 'client' || k === 'عميل' || k === 'العميل' || k === 'اسم العميل') colMap.client_name = key;
      else if (k === 'agencies' || k === 'جهات' || k === 'agencies list' || k === 'الجهات' || k === 'agency') colMap.agencies = key;
      else if (k === 'notes' || k === 'ملاحظات' || k === 'notes') colMap.notes = key;
    }

    if (!colMap.title) {
      return res.status(400).json({ error: 'لم يتم العثور على عمود عنوان القضية (title)' });
    }

    // Process all rows
    let imported = 0;
    for (const row of data) {
      const title = String(row[colMap.title] || '').trim();
      if (!title) continue;

      const uuid = uuidv4();
      const priority = row[colMap.priority]
        ? (String(row[colMap.priority]).toLowerCase().includes('high') || String(row[colMap.priority]).includes('عاجل')
          ? 'high'
          : String(row[colMap.priority]).toLowerCase().includes('low') || String(row[colMap.priority]).includes('منخفض')
            ? 'low'
            : 'medium')
        : 'medium';

      const { data: caseResult, error: caseErr } = await sup
        .from('cases')
        .insert({
          uuid,
          title,
          description: String(row[colMap.description] || '').trim(),
          status: 'open',
          priority,
          client_name: row[colMap.client_name] ? String(row[colMap.client_name]).trim() : null,
          created_by: req.user?.id || null,
          created_at: now,
          updated_at: now
        })
        .select()
        .single();

      if (caseErr) throw caseErr;
      const caseId = caseResult.id;

      // Parse agencies column (semicolon separated)
      const agenciesStr = row[colMap.agencies] ? String(row[colMap.agencies]) : '';
      const agencyNames = agenciesStr.split(';').map(s => s.trim()).filter(Boolean);
      let agencyCount = 0;

      for (const name of agencyNames) {
        // Try to match by name_en (fuzzy)
        const { data: agenciesEn } = await sup
          .from('agencies')
          .select('id')
          .ilike('name_en', `%${name}%`)
          .limit(1);

        if (agenciesEn && agenciesEn.length > 0) {
          const { error: reqErr } = await sup.from('requests').insert({
            case_id: caseId,
            agency_id: agenciesEn[0].id,
            status: 'pending',
            notes: String(row[colMap.notes] || '').trim(),
            created_at: now
          });
          // Was never checked -- agencyCount++ and the imported comment
          // below both ran regardless, so a bad-import summary could
          // overstate how many agencies actually got attached to the case.
          if (reqErr) console.error(`[cases/upload] request insert failed for case ${caseId}, agency "${name}":`, reqErr.message);
          else agencyCount++;
        } else {
          // Try name_ar
          const { data: agenciesAr } = await sup
            .from('agencies')
            .select('id')
            .ilike('name_ar', `%${name}%`)
            .limit(1);

          if (agenciesAr && agenciesAr.length > 0) {
            const { error: reqErr } = await sup.from('requests').insert({
              case_id: caseId,
              agency_id: agenciesAr[0].id,
              status: 'pending',
              notes: String(row[colMap.notes] || '').trim(),
              created_at: now
            });
            if (reqErr) console.error(`[cases/upload] request insert failed for case ${caseId}, agency "${name}":`, reqErr.message);
            else agencyCount++;
          }
        }
      }

      const { error: commentErr } = await sup.from('case_comments').insert({
        case_id: caseId,
        content: `📋 تم استيراد القضية عن طريق Excel — ${agencyCount} جهة`,
        created_at: now
      });
      if (commentErr) console.error(`[cases/upload] case_comments insert failed for case ${caseId}:`, commentErr.message);
      imported++;
    }

    // Archive the import file itself to Drive for record-keeping (non-blocking)
    try {
      const gdrive = require('../services/googleDriveService');
      const folderId = await gdrive.ensureSystemFolder('Imports');
      await gdrive.uploadBytes(req.file.buffer, req.file.originalname, req.file.mimetype, folderId);
    } catch (uploadErr) {
      console.warn('Case import file Drive archive warning:', uploadErr.message);
    }

    res.json({
      success: true,
      imported,
      total_rows: data.length,
      message: `✅ تم استيراد ${imported} قضية من ${data.length}`
    });
  } catch (err) {
    console.error('Cases upload error:', err);
    res.status(500).json({ error: err.message || 'فشل رفع الملف' });
  }
});

// multer (commentUpload/bulk-import) throws inside its own middleware layer,
// BEFORE any route handler's try/catch runs -- an oversized attachment on a
// نقاش الفريق/قائمة التدقيق comment produced Express's default non-JSON
// error page instead of this app's normal {error: "..."} shape, so the
// frontend's res.json().catch(()=>({})) swallowed it into a generic
// fallback message instead of the real "too large" reason. Same pattern as
// documentCenter.js's own handler; registered last so it only intercepts
// errors from this router's own middleware/routes.
router.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'حجم الملف أكبر من الحد المسموح (100 ميجابايت)'
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'عدد الملفات أكبر من الحد المسموح'
      : err.message;
    return res.status(400).json({ error: message });
  }
  next(err);
});

module.exports = router;
