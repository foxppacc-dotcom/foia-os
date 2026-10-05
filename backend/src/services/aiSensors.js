// Deterministic "sensors" for the recurring AI tasks. Each one scans the live data
// (no LLM) and returns the candidates that need attention, with the facts the
// model will later judge. A candidate that stops matching on a later run means the
// situation was handled -- the runner resolves its finding automatically.
//
// candidate = { key, kind, severity, title, details, case_id, request_id,
//               communication_id, agency_id, facts, priority }
const { fetchAll, chunk, daysBetween, todayStr, getListMap, isBounce, clip } = require('./aiTaskCommon');

const DAY = 86400000;
const addDays = (dateStr, n) => new Date(new Date(dateStr).getTime() + n * DAY).toISOString().slice(0, 10);
const parseMeta = (m) => { if (!m) return {}; if (typeof m !== 'string') return m; try { return JSON.parse(m); } catch { return {}; } };

async function loadCaseMap(sup, caseIds) {
  const map = new Map();
  for (const ids of chunk([...new Set(caseIds.filter(Boolean))], 150)) {
    const { data } = await sup.from('cases').select('id, title, status, deleted_at, in_intake_review').in('id', ids);
    for (const c of data || []) map.set(c.id, c);
  }
  return map;
}
const caseIsLive = (c) => c && !c.deleted_at && !c.in_intake_review && c.status !== 'closed';

async function loadAgencyMap(sup, agencyIds) {
  const map = new Map();
  for (const ids of chunk([...new Set(agencyIds.filter(Boolean))], 150)) {
    const { data } = await sup.from('agencies').select('id, name_en, name_ar, email, portal_url').in('id', ids);
    for (const a of data || []) map.set(a.id, a);
  }
  return map;
}

async function loadCommsForCases(sup, caseIds, select) {
  const rows = [];
  for (const ids of chunk([...new Set(caseIds)], 120)) {
    const part = await fetchAll(() => sup.from('communications').select(select).in('case_id', ids).is('deleted_at', null).order('id'));
    rows.push(...part);
  }
  return rows;
}

const agencyLabel = (a) => (a ? (a.name_en || a.name_ar) : 'جهة غير محددة');

// ======================================================================
// 1) stale_requests -- old requests nobody answered
// ======================================================================
async function staleRequests(sup, cfg = {}) {
  const fallbackDays = parseInt(cfg.fallback_days) || 14;
  const cooldownDays = parseInt(cfg.followup_cooldown_days) || 7;
  const listMap = await getListMap(sup);
  const skipLists = new Set([...listMap.terminal, ...listMap.payment, ...listMap.confirmation]);
  const today = todayStr();

  const reqs = await fetchAll(() => sup.from('requests')
    .select('id, case_id, agency_id, status, reply_outcome, classification_id, sent_date, expected_response_date, channel_method, email_account_id, overdue_ack_by, created_at')
    .is('deleted_at', null).order('id'));

  let pool = reqs
    .filter(r => r.reply_outcome === 'pending' && !skipLists.has(r.classification_id) && !r.overdue_ack_by)
    .map(r => ({ ...r, due: r.expected_response_date || (r.sent_date ? addDays(r.sent_date, fallbackDays) : null) }))
    .filter(r => r.due && r.due < today);

  const caseMap = await loadCaseMap(sup, pool.map(r => r.case_id));
  pool = pool.filter(r => caseIsLive(caseMap.get(r.case_id)));
  const agencyMap = await loadAgencyMap(sup, pool.map(r => r.agency_id));

  const comms = await loadCommsForCases(sup, pool.map(r => r.case_id), 'id, case_id, request_id, agency_id, direction, created_at, subject, sender');
  const byCase = new Map();
  for (const c of comms) { if (!byCase.has(c.case_id)) byCase.set(c.case_id, []); byCase.get(c.case_id).push(c); }
  const reqCountByCase = new Map();
  for (const r of reqs) reqCountByCase.set(r.case_id, (reqCountByCase.get(r.case_id) || 0) + 1);

  const candidates = [];
  let skippedFollowedUp = 0, skippedReplied = 0;
  for (const r of pool) {
    const list = byCase.get(r.case_id) || [];
    const sentFrom = r.sent_date || '0000-00-00';
    const mine = (c) => c.request_id === r.id || (c.agency_id != null && c.agency_id === r.agency_id) || (c.request_id == null && c.agency_id == null);
    const inbound = list.filter(c => c.direction === 'inbound' && mine(c) && String(c.created_at).slice(0, 10) >= sentFrom);
    const bounces = inbound.filter(isBounce);
    const realReplies = inbound.filter(c => !isBounce(c));
    // a single-request case: any non-bounce inbound on it is that agency's reply
    const replied = realReplies.length > 0 && (realReplies.some(c => c.request_id === r.id || (c.agency_id != null && c.agency_id === r.agency_id)) || reqCountByCase.get(r.case_id) === 1);
    if (replied) { skippedReplied++; continue; }

    const outbound = list.filter(c => c.direction === 'outbound' && mine(c) && String(c.created_at).slice(0, 10) >= sentFrom)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const lastOut = outbound[0];
    if (lastOut && daysBetween(lastOut.created_at, new Date()) < cooldownDays && outbound.length > 1) { skippedFollowedUp++; continue; }

    const agency = agencyMap.get(r.agency_id);
    const cs = caseMap.get(r.case_id);
    const daysWaiting = r.sent_date ? daysBetween(r.sent_date, today) : null;
    const daysOverdue = daysBetween(r.due, today);
    const severity = daysOverdue >= 30 ? 'critical' : daysOverdue >= 14 ? 'warning' : 'info';
    const notes = [];
    if (bounces.length) notes.push(`وصلت رسالة ارتداد/فشل تسليم (${clip(bounces[0].subject, 80)}) — غالبًا العنوان خاطئ.`);
    if (r.channel_method === 'portal') notes.push('الإرسال عبر البوابة وليس الإيميل.');
    else if (!agency?.email) notes.push('لا يوجد إيميل مسجّل للجهة.');
    candidates.push({
      key: `req:${r.id}:stale`, kind: bounces.length ? 'stale_bounced' : 'stale_no_reply', severity,
      title: `${agencyLabel(agency)} — لا رد على الطلب #${r.id} (${clip(cs?.title, 60)})`,
      details: `${daysWaiting != null ? `مرّ ${daysWaiting} يومًا على الإرسال، ` : ''}موعد الرد المتوقع ${r.due} (تأخر ${daysOverdue} يومًا) ولم يصل أي رد.${notes.length ? ' ' + notes.join(' ') : ''}`,
      case_id: r.case_id, request_id: r.id, agency_id: r.agency_id,
      facts: {
        sent_date: r.sent_date, due: r.due, days_waiting: daysWaiting, days_overdue: daysOverdue,
        channel: r.channel_method, agency_name: agencyLabel(agency), agency_email: agency?.email || null, has_portal: !!agency?.portal_url,
        outbound_count: outbound.length, last_outbound: lastOut ? { date: String(lastOut.created_at).slice(0, 10), subject: clip(lastOut.subject, 100) } : null,
        bounced: bounces.length > 0, bounce_subject: bounces[0] ? clip(bounces[0].subject, 100) : null,
        email_account_id: r.email_account_id, case_title: cs?.title,
      },
      priority: daysOverdue,
    });
  }
  candidates.sort((a, b) => b.priority - a.priority);
  return { candidates, stats: { scanned: reqs.length, overdue_pool: pool.length, skipped_replied: skippedReplied, skipped_followed_up: skippedFollowedUp } };
}

// ======================================================================
// 2) payment_requests -- before paying, make sure we know what we pay for
// ======================================================================
async function paymentRequests(sup, cfg = {}) {
  const listMap = await getListMap(sup);
  const byOutcome = await fetchAll(() => sup.from('requests').select('id, case_id, agency_id, reply_outcome, classification_id, sent_date, email_account_id').is('deleted_at', null).eq('reply_outcome', 'payment_requested').order('id'));
  let byList = [];
  if (listMap.payment.length) byList = await fetchAll(() => sup.from('requests').select('id, case_id, agency_id, reply_outcome, classification_id, sent_date, email_account_id').is('deleted_at', null).in('classification_id', listMap.payment).order('id'));
  const seen = new Map();
  for (const r of [...byOutcome, ...byList]) seen.set(r.id, r);
  let pool = [...seen.values()];

  const caseMap = await loadCaseMap(sup, pool.map(r => r.case_id));
  pool = pool.filter(r => caseIsLive(caseMap.get(r.case_id)));
  const agencyMap = await loadAgencyMap(sup, pool.map(r => r.agency_id));
  const comms = await loadCommsForCases(sup, pool.map(r => r.case_id), 'id, case_id, request_id, agency_id, direction, created_at, subject, sender, metadata');

  const candidates = [];
  for (const r of pool) {
    const inbound = comms.filter(c => c.case_id === r.case_id && c.direction === 'inbound' && !isBounce(c)
      && (c.request_id === r.id || (c.agency_id != null && c.agency_id === r.agency_id) || c.agency_id == null))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const last = inbound[0];
    const atts = last ? (parseMeta(last.metadata).attachments || []).map(a => a.filename).filter(Boolean) : [];
    const agency = agencyMap.get(r.agency_id);
    const cs = caseMap.get(r.case_id);
    const age = last ? daysBetween(last.created_at, new Date()) : null;
    candidates.push({
      key: `req:${r.id}:payment`, kind: 'payment_check', severity: age != null && age > 7 ? 'critical' : 'warning',
      title: `${agencyLabel(agency)} — طلب دفع على القضية «${clip(cs?.title, 60)}»: تحقق قبل الدفع`,
      details: last ? `آخر رد من الجهة بتاريخ ${String(last.created_at).slice(0, 10)}${atts.length ? ` ومعه ${atts.length} مرفق` : ''}. يلزم التحقق من الفيديوهات والدقائق وطريقة الدفع والاستلام قبل أي دفع.`
        : 'الطلب في حالة «مطلوب دفع» لكن لا يوجد رد وارد مسجّل على القضية — راجع مصدر طلب الدفع.',
      case_id: r.case_id, request_id: r.id, agency_id: r.agency_id, communication_id: last?.id || null,
      facts: { agency_name: agencyLabel(agency), last_reply: last ? { id: last.id, date: String(last.created_at).slice(0, 10), subject: clip(last.subject, 120) } : null, attachments: atts, case_title: cs?.title },
      priority: age || 0,
    });
  }
  candidates.sort((a, b) => b.priority - a.priority);
  return { candidates, stats: { payment_requests: pool.length } };
}

// ======================================================================
// 3) confirmation_pending -- "please confirm the records you want" replies
// ======================================================================
const ASK_RE = /\b(please|kindly)?\s*(confirm|verify|clarify|specify|identify)\b/i;
const CONTEXT_RE = /(records?|videos?|footage|reports?|request(ed)?|which|incident|date of birth|dob|case number|full name|spelling)/i;
const CITIZEN_RE = /(citizen|resident of|proof of (citizenship|residen)|residency)/i;

async function confirmationPending(sup, cfg = {}) {
  const graceHours = parseInt(cfg.grace_hours) || 24;
  const now = Date.now();
  const since = new Date(now - 45 * DAY).toISOString();
  const until = new Date(now - graceHours * 3600 * 1000).toISOString();
  const rows = await fetchAll(() => sup.from('communications')
    .select('id, case_id, request_id, agency_id, created_at, subject, sender, body, metadata')
    .eq('direction', 'inbound').not('case_id', 'is', null).is('deleted_at', null).not('is_archived', 'is', true)
    .gte('created_at', since).lte('created_at', until).order('id'));

  const asking = rows.filter(c => {
    if (isBounce(c)) return false;
    const text = `${c.subject || ''}\n${String(c.body || '').slice(0, 3500)}`;
    return CITIZEN_RE.test(text) || (ASK_RE.test(text) && CONTEXT_RE.test(text));
  });

  const caseMap = await loadCaseMap(sup, asking.map(c => c.case_id));
  const live = asking.filter(c => caseIsLive(caseMap.get(c.case_id)));
  const outbound = await loadCommsForCases(sup, live.map(c => c.case_id), 'id, case_id, agency_id, direction, created_at');
  const agencyMap = await loadAgencyMap(sup, live.map(c => c.agency_id));

  const candidates = [];
  for (const c of live) {
    const answered = outbound.some(o => o.case_id === c.case_id && o.direction === 'outbound' && new Date(o.created_at) > new Date(c.created_at)
      && (c.agency_id == null || o.agency_id == null || o.agency_id === c.agency_id));
    if (answered) continue;
    const hours = Math.floor((now - new Date(c.created_at)) / 3600000);
    const cs = caseMap.get(c.case_id);
    const agency = agencyMap.get(c.agency_id);
    candidates.push({
      key: `comm:${c.id}:confirm`, kind: 'confirmation_pending', severity: hours > 96 ? 'critical' : 'warning',
      title: `${agency ? agencyLabel(agency) + ' — ' : ''}رد يطلب تأكيدًا على القضية «${clip(cs?.title, 60)}» ولم يُرَدّ عليه`,
      details: `وصل الرد منذ ${hours} ساعة ويبدو أنه يطلب تأكيد/توضيح السجلات المطلوبة، ولا يوجد رد صادر بعده.`,
      case_id: c.case_id, request_id: c.request_id || null, agency_id: c.agency_id || null, communication_id: c.id,
      facts: { subject: clip(c.subject, 140), sender: c.sender, received: String(c.created_at).slice(0, 16), hours_waiting: hours, case_title: cs?.title, excerpt: clip(c.body, 500) },
      priority: hours,
    });
  }
  candidates.sort((a, b) => b.priority - a.priority);
  return { candidates, stats: { inbound_scanned: rows.length, asking_confirmation: asking.length } };
}

// ======================================================================
// 4) orphan_replies -- inbound mail that never found a case
// ======================================================================
const NOISE_RE = /(unsubscribe|newsletter|webinar|mailchimp|no-?reply@(google|facebook|microsoft|linkedin|apple|amazon|paypal)|notification@|security alert)/i;
const FOIA_RE = /(records? request|public records|open records|foia|public information|request\s*(#|no\.?|number|id)|your request|incident|bodycam|body camera|video|report)/i;
const GOVISH_RE = /(police|sheriff|\bpd\b|county|city of|state of|\.gov\b|\.us\b|records)/i;

async function orphanReplies(sup, cfg = {}) {
  const minAgeHours = parseInt(cfg.min_age_hours) || 2;
  // Is mail that matched no case being retried at all? Nothing else re-runs the matcher.
  // (re-run at most every rescan_hours -- it replays the matcher over every unlinked message)
  let rescan = null;
  try {
    const { getSetting, setSetting } = require('./aiTaskCommon');
    const last = await getSetting(sup, 'last_orphan_rescan', {});
    const everyMs = (parseInt(cfg.rescan_hours) || 6) * 3600 * 1000;
    if (!last.at || Date.now() - new Date(last.at).getTime() >= everyMs) {
      await setSetting(sup, 'last_orphan_rescan', { at: new Date().toISOString() });
      rescan = await require('./mailPoller').rescanUnmatched(60);
    } else rescan = { skipped: 'recent' };
  } catch (e) { rescan = { error: e.message }; }

  const now = Date.now();
  const since = new Date(now - 60 * DAY).toISOString();
  const until = new Date(now - minAgeHours * 3600 * 1000).toISOString();
  const rows = await fetchAll(() => sup.from('communications')
    .select('id, created_at, subject, sender, recipient, email_account_id, metadata')
    .eq('direction', 'inbound').is('case_id', null).is('deleted_at', null).not('is_archived', 'is', true)
    .gte('created_at', since).lte('created_at', until).order('id', { ascending: false }));

  const { data: agencies } = await sup.from('agencies').select('id, name_en, name_ar, email').is('deleted_at', null);
  const domainToAgency = new Map();
  for (const a of agencies || []) {
    for (const e of String(a.email || '').split(/[;,\s]+/)) { const d = e.split('@')[1]?.toLowerCase(); if (d) domainToAgency.set(d, a); }
  }
  const candidates = [];
  let noise = 0;
  for (const c of rows) {
    const from = String(c.sender || '');
    const text = `${from} ${c.subject || ''}`;
    if (NOISE_RE.test(text) || isBounce(c)) { noise++; continue; }
    const domain = (from.match(/@([^\s>]+)/) || [])[1]?.toLowerCase();
    const agency = domain ? domainToAgency.get(domain) : null;
    let score = 0;
    if (agency) score += 3;
    if (GOVISH_RE.test(text)) score += 2;
    if (FOIA_RE.test(text)) score += 2;
    if (score < 2) continue;
    const hours = Math.floor((now - new Date(c.created_at)) / 3600000);
    const meta = parseMeta(c.metadata);
    candidates.push({
      key: `comm:${c.id}:orphan`, kind: 'orphan_reply', severity: hours > 24 * 7 ? 'critical' : hours > 48 ? 'warning' : 'info',
      title: `رد بلا قضية${agency ? ' من ' + agencyLabel(agency) : ''}: «${clip(c.subject, 80)}»`,
      details: `وصل منذ ${Math.floor(hours / 24) ? Math.floor(hours / 24) + ' يوم' : hours + ' ساعة'} من ${clip(from, 80)} ولم يُربط بأي قضية في النظام.`,
      case_id: null, communication_id: c.id, agency_id: agency?.id || null,
      facts: { subject: clip(c.subject, 160), sender: from, received: String(c.created_at).slice(0, 16), agency_match: agency ? agencyLabel(agency) : null, possible_matches: meta.possible_matches || null, attachments: (meta.attachments || []).length, score },
      priority: score * 1000 + Math.min(hours, 999),
    });
  }
  candidates.sort((a, b) => b.priority - a.priority);
  const oldest = rows.length ? Math.floor((now - new Date(rows[rows.length - 1].created_at)) / DAY) : 0;
  return { candidates, stats: { orphan_total: rows.length, noise_filtered: noise, relevant: candidates.length, oldest_days: oldest, rescan } };
}

// ======================================================================
// 5) unhandled_replies -- a reply arrived and nobody did anything about it
// ======================================================================
async function unhandledReplies(sup, cfg = {}) {
  const graceHours = parseInt(cfg.grace_hours) || 24;
  const now = Date.now();
  const since = new Date(now - 45 * DAY).toISOString();
  const until = new Date(now - graceHours * 3600 * 1000).toISOString();
  const listMap = await getListMap(sup);

  const rows = await fetchAll(() => sup.from('communications')
    .select('id, case_id, request_id, agency_id, created_at, subject, sender, metadata')
    .eq('direction', 'inbound').not('case_id', 'is', null).is('reviewed_by', null).is('deleted_at', null).not('is_archived', 'is', true)
    .gte('created_at', since).lte('created_at', until).order('id'));
  const inboundRows = rows.filter(c => !isBounce(c));

  const caseMap = await loadCaseMap(sup, inboundRows.map(c => c.case_id));
  const live = inboundRows.filter(c => caseIsLive(caseMap.get(c.case_id)));
  const caseIds = [...new Set(live.map(c => c.case_id))];

  // "handled" signals after the reply: a classify action, an outbound email, an uploaded
  // document, a team comment.
  const signals = new Map(); // caseId -> [ms timestamps]
  const add = (caseId, ts) => { if (!signals.has(caseId)) signals.set(caseId, []); signals.get(caseId).push(new Date(ts).getTime()); };
  for (const ids of chunk(caseIds, 150)) {
    const [acts, outs, docs, cmts] = await Promise.all([
      fetchAll(() => sup.from('activity_logs').select('target_id, created_at').eq('target_type', 'case').eq('action_type', 'classify').in('target_id', ids).gte('created_at', since).order('id')),
      fetchAll(() => sup.from('communications').select('case_id, created_at').eq('direction', 'outbound').in('case_id', ids).is('deleted_at', null).gte('created_at', since).order('id')),
      fetchAll(() => sup.from('case_documents').select('case_id, created_at, uploaded_by').in('case_id', ids).is('deleted_at', null).not('uploaded_by', 'is', null).gte('created_at', since).order('id')),
      fetchAll(() => sup.from('case_comments').select('case_id, created_at').in('case_id', ids).is('deleted_at', null).gte('created_at', since).order('id')),
    ]);
    acts.forEach(a => add(a.target_id, a.created_at));
    outs.forEach(a => add(a.case_id, a.created_at));
    docs.forEach(a => add(a.case_id, a.created_at));
    cmts.forEach(a => add(a.case_id, a.created_at));
  }
  const reqIds = [...new Set(live.map(c => c.request_id).filter(Boolean))];
  const reqMap = new Map();
  for (const ids of chunk(reqIds, 150)) {
    const { data } = await sup.from('requests').select('id, classification_id, reply_outcome, agency_id').in('id', ids);
    for (const r of data || []) reqMap.set(r.id, r);
  }
  const agencyMap = await loadAgencyMap(sup, live.map(c => c.agency_id));

  const candidates = [];
  for (const c of live) {
    const t = new Date(c.created_at).getTime();
    if ((signals.get(c.case_id) || []).some(ts => ts > t)) continue; // someone did something after the reply
    const hours = Math.floor((now - t) / 3600000);
    const cs = caseMap.get(c.case_id);
    const req = c.request_id ? reqMap.get(c.request_id) : null;
    const meta = parseMeta(c.metadata);
    const agency = agencyMap.get(c.agency_id);
    candidates.push({
      key: `comm:${c.id}:unhandled`, kind: 'unhandled_reply', severity: hours > 24 * 7 ? 'critical' : hours > 72 ? 'warning' : 'info',
      title: `${agency ? agencyLabel(agency) + ' — ' : ''}رد على «${clip(cs?.title, 60)}» لم يتعامل معه أحد`,
      details: `وصل الرد منذ ${hours >= 48 ? Math.floor(hours / 24) + ' يومًا' : hours + ' ساعة'} («${clip(c.subject, 80)}») ولا يوجد بعده أي تعامل: لا مراجعة ولا تصنيف ولا رد ولا رفع مستندات ولا تعليق.`,
      case_id: c.case_id, request_id: c.request_id || null, agency_id: c.agency_id || null, communication_id: c.id,
      facts: {
        subject: clip(c.subject, 160), sender: c.sender, received: String(c.created_at).slice(0, 16), hours_since_reply: hours,
        attachments: (meta.attachments || []).map(a => a.filename).filter(Boolean),
        request: req ? { id: req.id, list: listMap._nameById[req.classification_id] || 'غير مصنّف', reply_outcome: req.reply_outcome } : null,
        case_title: cs?.title,
      },
      priority: hours,
    });
  }
  candidates.sort((a, b) => b.priority - a.priority);
  return { candidates, stats: { unreviewed_inbound: rows.length, live_cases: caseIds.length, unhandled: candidates.length } };
}

const SENSORS = {
  stale_requests: staleRequests,
  payment_requests: paymentRequests,
  confirmation_pending: confirmationPending,
  orphan_replies: orphanReplies,
  unhandled_replies: unhandledReplies,
};

module.exports = { SENSORS };
