// FOIA OS v2 — Operational Search Service
// Infrastructure service. Not a Domain Engine.
// Consumes data from business engines. No business logic ownership.
// Search + retrieval layer for the entire platform.

// ── Operational query patterns ──
const OPERATIONAL_QUERIES = {
  'blocked': { filter: { status: 'blocked' }, label: 'المتطلبات المسدودة' },
  'critical': { filter: { priority: 'critical' }, label: 'المتطلبات الحرجة' },
  'mine': { filter: { owner: 'assigned_to_me' }, label: 'مخصص لي' },
  'today': { filter: { date: 'today' }, label: 'مطلوب اليوم' },
  'overdue': { filter: { date: 'overdue' }, label: 'متأخر' },
  'follow_up': { filter: { status: 'follow_up_needed' }, label: 'متابعة مطلوبة' },
  'verification': { filter: { status: 'evidence_received' }, label: 'بانتظار التوثيق' },
  'police': { filter: { source: 'police' }, label: 'الشرطة' },
  'court': { filter: { source: 'court' }, label: 'المحكمة' },
  'ministry': { filter: { source: 'ministry' }, label: 'الوزارة' },
};

// ── Context actions per result type/status ──
const CONTEXT_ACTIONS = {
  requirement_defined: [{ label: 'إرسال طلب', color: 'info', action: 'send' }],
  requirement_awaiting_response: [{ label: 'متابعة', color: 'warning', action: 'follow_up' }],
  requirement_awaiting_response_overdue: [{ label: 'متابعة', color: 'danger', action: 'follow_up' }, { label: 'تصعيد', color: 'danger', action: 'escalate' }],
  requirement_evidence_received: [{ label: 'توثيق', color: 'accent', action: 'verify' }],
  requirement_blocked: [{ label: 'حل العائق', color: 'danger', action: 'resolve' }],
  requirement_satisfied: [{ label: 'عرض', color: 'success', action: 'view' }],
  document_any: [{ label: 'عرض', color: 'accent', action: 'view' }],
  communication_any: [{ label: 'عرض المحادثة', color: 'info', action: 'view' }],
  source_any: [{ label: 'فتح المصدر', color: 'warning', action: 'open' }],
};

export class OperationalSearchService {
  constructor() {
    this._history = [];
    this._saved = [];
    this._recent = [];
  }

  // Check if query is an operational command
  isOperationalQuery(q) {
    return !!OPERATIONAL_QUERIES[q.toLowerCase().trim()];
  }

  getOperationalLabel(q) {
    return OPERATIONAL_QUERIES[q.toLowerCase().trim()]?.label || q;
  }

  getContextActions(result) {
    const key = `${result.type}_${result.status}`;
    const fallback = `${result.type}_any`;
    return CONTEXT_ACTIONS[key] || CONTEXT_ACTIONS[fallback] || [];
  }

  search(query = '', context = {}) {
    const q = query.toLowerCase().trim();
    if (!q) return { results: [], total: 0, categories: {}, operationalQuery: null };

    // Check for operational query
    const opQuery = OPERATIONAL_QUERIES[q];
    const results = [];
    const seen = new Set();

    const addResult = (item, type, category, score, status, priority) => {
      const key = `${type}_${item.id || item.record_type || item.subject || Math.random()}`;
      if (seen.has(key)) return;
      seen.add(key);
      const actions = this.getContextActions({ type, status: status || item.status || item.evidence_stage });
      results.push({
        id: item.id || item.record_type || item.subject,
        type, category,
        title: item.question || item.title || item.name || item.recordMeta?.label || item.record_type || item.subject || item.file_name || '',
        subtitle: item.sourceName || item.agency_name || item.sender || item.recipient || '',
        status: status || item.status || item.evidence_stage || '',
        priority: priority || item.priority || '',
        investigationId: item.case_id || context.investigationId,
        investigationTitle: context.investigationTitle || '',
        owner: item.assignedTo || item.assigned_to || '',
        daysWaiting: item.daysWaiting || item.days_waiting || 0,
        sourceName: item.sourceName || item.source_agency_name || item.agency_name || '',
        score,
        actions,
        isBlocked: (status || item.status || item.evidence_stage) === 'blocked',
        needsFollowUp: (status || item.status || item.evidence_stage) === 'follow_up_needed' || (status || item.status || item.evidence_stage) === 'awaiting_response',
        needsVerification: (status || item.status || item.evidence_stage) === 'evidence_received',
      });
    };

    const shouldInclude = (field) => {
      if (opQuery) return true; // Operational queries match everything
      return (field || '').toLowerCase().includes(q);
    };

    // Requirements / Evidence
    (context.requirements || []).forEach(ir => {
      const label = ir.recordMeta?.label || ir.record_type || '';
      const question = `الحصول على ${label}`;
      let score = 0;
      if (opQuery || shouldInclude(label)) score += 50;
      if (opQuery || shouldInclude(question)) score += 40;
      if (opQuery || shouldInclude(ir.sourceName)) score += 30;
      if (opQuery || shouldInclude(ir.notes)) score += 20;
      const stage = ir.evidence_stage || '';
      if (opQuery?.filter?.status && opQuery.filter.status === stage) score += 100;
      if (opQuery?.filter?.priority && opQuery.filter.priority === ir.priority) score += 100;
      if (opQuery?.filter?.source && shouldInclude(ir.sourceName)) score += 100;
      if (score > 0) addResult({ ...ir, question }, 'requirement', 'متطلبات المعلومات', score, stage, ir.priority);
    });

    // Documents
    (context.documents || []).forEach(doc => {
      const name = doc.file_name || doc.name || '';
      let score = 0;
      if (opQuery || shouldInclude(name)) score += 50;
      if (opQuery || shouldInclude(doc.description)) score += 30;
      if (opQuery || shouldInclude(doc.file_type)) score += 20;
      if (score > 0) addResult(doc, 'document', 'المستندات', score);
    });

    // Communications
    (context.communications || []).forEach(comm => {
      let score = 0;
      if (opQuery || shouldInclude(comm.subject)) score += 50;
      if (opQuery || shouldInclude(comm.body)) score += 40;
      if (opQuery || shouldInclude(comm.sender)) score += 30;
      if (opQuery || shouldInclude(comm.recipient)) score += 30;
      if (score > 0) addResult(comm, 'communication', 'الاتصالات', score);
    });

    // Sources
    (context.agencies || []).forEach(ag => {
      let score = 0;
      if (opQuery || shouldInclude(ag.name)) score += 50;
      if (opQuery || shouldInclude(ag.type)) score += 30;
      if (opQuery || shouldInclude(ag.city)) score += 20;
      if (score > 0) addResult(ag, 'source', 'المصادر', score);
    });

    results.sort((a, b) => b.score - a.score);

    const categories = {};
    results.forEach(r => {
      if (!categories[r.category]) categories[r.category] = [];
      categories[r.category].push(r);
    });

    this._history.unshift({ query: q, timestamp: new Date().toISOString(), resultCount: results.length });
    if (this._history.length > 50) this._history.pop();

    return {
      results,
      total: results.length,
      categories,
      operationalQuery: opQuery ? { type: q, label: opQuery.label } : null,
    };
  }

  // ── Duplicate detection ──
  detectDuplicates(requirements = [], documents = []) {
    const dups = [];
    const srcMap = {};
    requirements.forEach(ir => {
      const s = ir.sourceName || 'unknown';
      if (!srcMap[s]) srcMap[s] = [];
      srcMap[s].push(ir);
    });
    Object.entries(srcMap).forEach(([s, irs]) => {
      if (irs.length > 1) dups.push({ type: 'similar_requirement', source: s, count: irs.length, reason: `${irs.length} متطلبات من ${s}` });
    });
    const fileMap = {};
    (documents || []).forEach(d => {
      const n = (d.file_name || d.name || '').toLowerCase();
      if (!n) return;
      if (!fileMap[n]) fileMap[n] = [];
      fileMap[n].push(d);
    });
    Object.entries(fileMap).forEach(([n, d]) => {
      if (d.length > 1) dups.push({ type: 'duplicate_document', fileName: n, count: d.length, reason: `الملف "${n}" مكرر ${d.length} مرات` });
    });
    return dups;
  }

  // ── Proactive Retrieval ──
  getRelevantNow(context = {}) {
    const items = [];
    const seen = new Set();
    const currentSource = context.currentSource || '';
    const currentInvestigationId = context.investigationId;

    const add = (item, type, reason, relevance, actions) => {
      const key = `${type}_${item.id || item.record_type || Math.random()}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ ...item, _type: type, _reason: reason, _relevance: relevance, _actions: actions || this.getContextActions({ type, status: item.status || item.evidence_stage }) });
    };

    // Same source used in other investigations
    if (currentSource) {
      (context.allRequirements || []).forEach(ir => {
        if (ir.sourceName === currentSource && ir.case_id !== currentInvestigationId) {
          add(ir, 'related_requirement', `نفس المصدر مستخدم في تحقيق آخر`, 90);
        }
      });
    }

    // New communications (today)
    (context.communications || []).forEach(comm => {
      if (comm.direction === 'inbound') {
        const isToday = comm.created_at && new Date(comm.created_at).toDateString() === new Date().toDateString();
        if (isToday) add(comm, 'new_communication', 'وصل رد جديد هذا الصباح', 95);
      }
    });

    // Newly uploaded documents (last 24h)
    (context.documents || []).forEach(doc => {
      if (doc.created_at) {
        const age = (new Date() - new Date(doc.created_at)) / (1000 * 60 * 60);
        if (age < 24) add(doc, 'new_document', 'تم رفع مستند جديد', 85);
      }
    });

    // Newly verified evidence
    (context.requirements || []).forEach(ir => {
      if (ir.evidence_stage === 'verified') add(ir, 'verified_evidence', 'اكتمل توثيق الدليل', 80);
    });

    // Duplicate documents
    const fileMap = {};
    (context.documents || []).forEach(d => {
      const n = (d.file_name || d.name || '').toLowerCase();
      if (!n) return;
      if (!fileMap[n]) fileMap[n] = [];
      fileMap[n].push(d);
    });
    Object.entries(fileMap).forEach(([name, docs]) => {
      if (docs.length > 1) {
        const hasOtherCase = docs.some(d => d.case_id !== currentInvestigationId);
        if (hasOtherCase) add(docs[0], 'duplicate_document', `الملف "${name}" موجود في عدة تحقيقات`, 75);
      }
    });

    // Source with low response rate
    if (currentSource && context.sourceMetrics?.[currentSource]) {
      const sm = context.sourceMetrics[currentSource];
      if (sm.responseRate < 0.5) add({ sourceName: currentSource, responseRate: sm.responseRate }, 'slow_source', `معدل استجابة ${Math.round(sm.responseRate * 100)}% — بطيء`, 70);
    }

    // Previous denial from this source
    if (currentSource) {
      (context.requirements || []).forEach(ir => {
        if (ir.sourceName === currentSource && ir.evidence_stage === 'rejected') {
          add(ir, 'previous_denial', `طلب سابق مرفوض من هذا المصدر`, 85);
        }
      });
    }

    // Similar requests (same record_type, different investigations)
    const typeMap = {};
    (context.allRequirements || []).forEach(ir => {
      const rt = ir.record_type || '';
      if (!typeMap[rt]) typeMap[rt] = [];
      typeMap[rt].push(ir);
    });
    Object.entries(typeMap).forEach(([type, irs]) => {
      if (irs.length > 1) {
        const otherCase = irs.find(ir => ir.case_id !== currentInvestigationId);
        if (otherCase) add(otherCase, 'similar_request', `طلب مشابه "${type}" في تحقيق آخر`, 65);
      }
    });

    // Sort by relevance score
    items.sort((a, b) => (b._relevance || 0) - (a._relevance || 0));
    return items.slice(0, 8);
  }
  getHistory(limit = 10) { return this._history.slice(0, limit); }
  clearHistory() { this._history = []; }
  saveSearch(name, query) { this._saved.push({ id: `ss_${Date.now()}`, name, query, createdAt: new Date().toISOString() }); }
  getSavedSearches() { return [...this._saved]; }
  deleteSavedSearch(id) { this._saved = this._saved.filter(s => s.id !== id); }
  addRecent(inv) { this._recent = this._recent.filter(r => r.id !== inv.id); this._recent.unshift({ ...inv, timestamp: new Date().toISOString() }); if (this._recent.length > 10) this._recent.pop(); }
  getRecent() { return [...this._recent]; }
}

export const searchService = new OperationalSearchService();
