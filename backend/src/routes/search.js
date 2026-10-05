const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const { canViewAllCases, getVisibleCaseIds } = require('../services/caseAccess');

// GET /api/search?q=... — global header search across cases, documents,
// communications, and agencies. Each category is resolved independently
// (Promise.allSettled, not Promise.all) so one slow/broken source never
// takes the whole search down -- same reasoning already applied to the
// cases-list's own multi-source search filter in cases.js.
router.get('/search', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ success: true, cases: [], documents: [], communications: [], agencies: [] });

    const sup = getSupabase();
    const term = `%${q}%`;
    const RESULT_LIMIT = 6;

    // A restricted role (cases.view_all = false) must never see another
    // case's title/documents/correspondence through search either -- the
    // same boundary already enforced on صندوق البريد this session.
    const viewAllCases = await canViewAllCases(sup, req.user.role);
    const visibleCaseIds = viewAllCases ? null : new Set(await getVisibleCaseIds(sup, req.user.id));
    const caseIsVisible = (caseId) => viewAllCases || (caseId != null && visibleCaseIds.has(caseId));

    const [casesResult, docsResult, commsResult, agenciesResult] = await Promise.allSettled([
      (async () => {
        // Two separate single-column ilike calls, not a hand-rolled
        // .or("title.ilike.x,client_name.ilike.x") string -- PostgREST
        // parses that string with its OWN filter grammar, so a query
        // containing a comma or parenthesis would break the whole clause
        // instead of just not matching (same pitfall cases.js's own search
        // already works around this same way).
        const baseQuery = () => {
          let q2 = sup.from('cases').select('id, title, client_name').is('deleted_at', null);
          if (!viewAllCases) q2 = visibleCaseIds.size ? q2.in('id', [...visibleCaseIds]) : q2.eq('id', -1);
          return q2;
        };
        const [byTitle, byClient, byDefendant, bySourceAgency] = await Promise.all([
          baseQuery().ilike('title', term).limit(RESULT_LIMIT * 2),
          baseQuery().ilike('client_name', term).limit(RESULT_LIMIT * 2),
          baseQuery().ilike('defendant_name', term).limit(RESULT_LIMIT * 2),
          baseQuery().ilike('source_agency_name', term).limit(RESULT_LIMIT * 2),
        ]);
        if (byTitle.error) throw byTitle.error;
        if (byClient.error) throw byClient.error;
        // A case is also found through the AGENCY it was sent to (by the agency's name),
        // not only by its own title/client.
        let byAgencyRows = [];
        {
          const [en, ar] = await Promise.all([
            sup.from('agencies').select('id').ilike('name_en', term).is('deleted_at', null).limit(20),
            sup.from('agencies').select('id').ilike('name_ar', term).is('deleted_at', null).limit(20),
          ]);
          const agencyIds = [...new Set([...(en.data || []), ...(ar.data || [])].map(a => a.id))];
          if (agencyIds.length) {
            const { data: reqRows } = await sup.from('requests').select('case_id').in('agency_id', agencyIds).is('deleted_at', null).limit(200);
            const caseIdsViaAgency = [...new Set((reqRows || []).map(r => r.case_id).filter(Boolean))];
            if (caseIdsViaAgency.length) {
              const { data } = await baseQuery().in('id', caseIdsViaAgency).limit(RESULT_LIMIT * 2);
              byAgencyRows = data || [];
            }
          }
        }
        // A numeric query also matches by case id substring (ids aren't
        // text, so this can't be folded into the ilike queries above) --
        // merged in and re-limited together so a case matching more than
        // one way isn't duplicated.
        let extra = [];
        if (/\d/.test(q)) {
          const { data: idRows } = await baseQuery();
          extra = (idRows || []).filter(c => String(c.id).includes(q));
        }
        const seen = new Map();
        [...(byTitle.data || []), ...(byClient.data || []), ...(byDefendant.data || []), ...(bySourceAgency.data || []), ...byAgencyRows, ...extra].forEach(c => seen.set(c.id, c));
        return [...seen.values()].slice(0, RESULT_LIMIT);
      })(),
      (async () => {
        const { data, error } = await sup.from('case_documents').select('id, original_name, case_id')
          .ilike('original_name', term).is('deleted_at', null).limit(RESULT_LIMIT * 3);
        if (error) throw error;
        const rows = (data || []).filter(d => caseIsVisible(d.case_id)).slice(0, RESULT_LIMIT);
        if (!rows.length) return [];
        const caseIds = [...new Set(rows.map(r => r.case_id).filter(Boolean))];
        const { data: cases } = caseIds.length ? await sup.from('cases').select('id, title').in('id', caseIds) : { data: [] };
        const titleById = Object.fromEntries((cases || []).map(c => [c.id, c.title]));
        return rows.map(r => ({ ...r, case_title: r.case_id ? titleById[r.case_id] : null }));
      })(),
      (async () => {
        const { data, error } = await sup.from('communications').select('id, subject, case_id')
          .ilike('subject', term).is('deleted_at', null).order('created_at', { ascending: false }).limit(RESULT_LIMIT * 3);
        if (error) throw error;
        const rows = (data || []).filter(c => caseIsVisible(c.case_id)).slice(0, RESULT_LIMIT);
        if (!rows.length) return [];
        const caseIds = [...new Set(rows.map(r => r.case_id).filter(Boolean))];
        const { data: cases } = caseIds.length ? await sup.from('cases').select('id, title').in('id', caseIds) : { data: [] };
        const titleById = Object.fromEntries((cases || []).map(c => [c.id, c.title]));
        return rows.map(r => ({ ...r, case_title: r.case_id ? titleById[r.case_id] : null }));
      })(),
      // Agencies are a shared directory, not per-case data -- no
      // case-visibility scoping needed.
      (async () => {
        const [en, ar] = await Promise.all([
          sup.from('agencies').select('id, name_ar, name_en').ilike('name_en', term).is('deleted_at', null).limit(RESULT_LIMIT),
          sup.from('agencies').select('id, name_ar, name_en').ilike('name_ar', term).is('deleted_at', null).limit(RESULT_LIMIT),
        ]);
        const seen = new Map();
        for (const a of [...(en.data || []), ...(ar.data || [])]) if (!seen.has(a.id)) seen.set(a.id, { id: a.id, name: a.name_ar || a.name_en });
        return [...seen.values()].slice(0, RESULT_LIMIT);
      })(),
    ]);

    const unwrap = (settled, label) => {
      if (settled.status === 'fulfilled') return Array.isArray(settled.value) ? settled.value : (settled.value?.data || []);
      console.error(`[search] "${label}" source failed:`, settled.reason?.message || settled.reason);
      return [];
    };

    res.json({
      success: true,
      cases: unwrap(casesResult, 'cases'),
      documents: unwrap(docsResult, 'documents'),
      communications: unwrap(commsResult, 'communications'),
      agencies: unwrap(agenciesResult, 'agencies'),
    });
  } catch (ex) {
    res.status(500).json({ error: ex.message });
  }
});

module.exports = router;
