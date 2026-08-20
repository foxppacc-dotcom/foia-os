import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Plus, Search, Upload, Building2, Trash2, Filter, Users, ChevronLeft, ChevronRight, ChevronDown, Bell } from 'lucide-react';

const ACTIVITY_TYPE_LABEL = {
  case_comment: '💬 تعليق جديد في نقاش الفريق',
  case_comment_mention: '📣 تم توجيه ملاحظة إليك',
  email_received: '📩 بريد جديد وصل للقضية',
  document_uploaded: '📎 تم رفع ملف على القضية',
};

const STATUS_STYLES = {
  open: { bg: '#3B82F6', label: '🟦 مفتوحة' },
  in_progress: { bg: '#F59E0B', label: '🟡 قيد التنفيذ' },
  in_production: { bg: '#8B5CF6', label: '🎬 في الإنتاج' },
  closed: { bg: '#10B981', label: '🟢 مغلقة' },
};

const PRIORITY_OPTIONS = [
  { key: 'high', label: '🔴 عاجل' },
  { key: 'medium', label: '🟡 متوسط' },
  { key: 'low', label: '🟢 منخفض' },
];

const STATUS_OPTIONS = Object.entries(STATUS_STYLES).map(([key, st]) => ({ key, label: st.label }));

const AGENCY_TYPE_LABELS = { federal: 'فيدرالي', state: 'ولاية', municipal: 'بلدية', sheriff: 'شريف' };

const PAGE_SIZE = 100;
const MONTH_NAMES = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

// Clickable popup calendar -- native <input type="date"> renders its
// numerals/segment order from the BROWSER'S OWN locale regardless of
// dir/lang on the element (Chrome keeps showing Arabic-Indic digits /
// reversed order), same issue already worked around in Inbox.jsx.
function CalendarPopup({ value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => {
    const d = value ? new Date(value + 'T00:00:00') : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const ref = useRef(null);

  useEffect(() => {
    if (!value) return;
    const d = new Date(value + 'T00:00:00');
    setViewDate({ year: d.getFullYear(), month: d.getMonth() });
  }, [value]);

  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const daysInMonth = new Date(viewDate.year, viewDate.month + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewDate.year, viewDate.month, 1).getDay();
  const pick = (day) => {
    const mm = String(viewDate.month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    onChange(`${viewDate.year}-${mm}-${dd}`);
    setOpen(false);
  };
  const prevMonth = () => setViewDate(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 });
  const nextMonth = () => setViewDate(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 });
  const displayValue = value ? new Date(value + 'T00:00:00').toLocaleDateString('en-GB') : placeholder;
  const selectedStr = `${viewDate.year}-${String(viewDate.month + 1).padStart(2, '0')}`;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="px-2 py-1.5 rounded-lg border text-xs min-w-[80px] text-center whitespace-nowrap"
        style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: value ? 'var(--text-primary)' : 'var(--text-muted)' }}
        dir="ltr">
        {displayValue}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 p-2 rounded-xl shadow-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', width: '210px' }} dir="ltr">
          <div className="flex items-center justify-between mb-2 px-0.5">
            <button type="button" onClick={prevMonth} className="p-0.5 rounded" style={{ color: 'var(--text-secondary)' }}><ChevronLeft className="w-3.5 h-3.5" /></button>
            <span className="text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>{MONTH_NAMES[viewDate.month]} {viewDate.year}</span>
            <button type="button" onClick={nextMonth} className="p-0.5 rounded" style={{ color: 'var(--text-secondary)' }}><ChevronRight className="w-3.5 h-3.5" /></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i} className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{d}</span>)}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => <span key={'e' + i} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dayStr = `${selectedStr}-${String(day).padStart(2, '0')}`;
              const isSelected = value === dayStr;
              return (
                <button type="button" key={day} onClick={() => pick(day)}
                  className="w-6 h-6 rounded text-[10px] ds-transition-colors"
                  style={{ background: isSelected ? 'var(--accent)' : 'transparent', color: isSelected ? 'white' : 'var(--text-primary)' }}>
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// The "زرار سكرول" multi-select requested for agencies/employees: a button
// showing how many are picked, opening a searchable, scrollable checkbox
// list -- reused for both filters instead of two near-identical components.
function MultiSelectPopover({ label, icon, options, selectedIds, onChange, getId, getLabel, showSearch = true }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const filtered = options.filter(o => !search || getLabel(o).toLowerCase().includes(search.toLowerCase()));
  const toggle = (id) => onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  const summary = selectedIds.length === 0 ? null
    : selectedIds.length === 1 ? (getLabel(options.find(o => getId(o) === selectedIds[0])) || '1')
    : `${selectedIds.length} مختارة`;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs min-w-[84px] justify-between whitespace-nowrap"
        style={{ background: 'var(--bg-secondary)', borderColor: selectedIds.length ? 'var(--accent)' : 'var(--border)', color: 'var(--text-primary)' }}>
        <span className="flex items-center gap-1 min-w-0">
          <span className="shrink-0">{icon}</span>
          <span className="truncate" style={{ color: summary ? 'var(--text-primary)' : 'var(--text-muted)' }}>{summary || label}</span>
        </span>
        <ChevronDown className="w-3 h-3 shrink-0 transition-transform" style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1.5 rounded-xl overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', width: '230px', boxShadow: 'var(--shadow-md, 0 8px 24px rgba(0,0,0,0.18))' }}>
          <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</span>
            {selectedIds.length > 0 && (
              <button onClick={() => onChange([])} className="text-[11px]" style={{ color: 'var(--accent)' }}>مسح</button>
            )}
          </div>
          {showSearch && (
            <div className="p-2 pb-0">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث..."
                className="w-full px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>
          )}
          <div className="max-h-56 overflow-y-auto p-1.5 space-y-0.5">
            {filtered.length === 0 ? (
              <p className="text-xs text-center py-3" style={{ color: 'var(--text-muted)' }}>لا نتائج</p>
            ) : filtered.map(o => {
              const checked = selectedIds.includes(getId(o));
              return (
                <label key={getId(o)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs"
                  style={{ background: checked ? 'var(--accent-subtle, rgba(212,168,67,0.1))' : 'transparent', color: 'var(--text-primary)' }}
                  onMouseEnter={e => { if (!checked) e.currentTarget.style.background = 'var(--bg-tertiary)'; }}
                  onMouseLeave={e => { if (!checked) e.currentTarget.style.background = 'transparent'; }}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(getId(o))} className="w-3.5 h-3.5 shrink-0" style={{ accentColor: 'var(--accent)' }} />
                  <span className="truncate">{getLabel(o)}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Cases() {
  const [cases, setCases] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0); // 0-indexed internally, shown as page+1
  const [pageInput, setPageInput] = useState('1');
  const [loading, setLoading] = useState(true);
  // Separate from `loading` above -- that one flips true/false on EVERY
  // fetchCases() call, including the debounced search-as-you-type refetch.
  // The whole page used to early-return a spinner whenever `loading` was
  // true, which unmounted the search input (and everything else) on every
  // keystroke's debounced refetch -- losing focus mid-typing, so each
  // character required clicking back into the box before the next one could
  // be typed. This one is only ever true before the FIRST fetch resolves.
  const [initialLoading, setInitialLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [agencies, setAgencies] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [canViewAllCases, setCanViewAllCases] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [form, setForm] = useState({
    priority: 'medium',
    defendant_name: '', source_agency_name: '', story_hook: '', article_url: '', case_summary: '',
    selectedAgencies: []
  });
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Advanced filter panel: status/priority/agencies/employees/date range.
  // Staged in `pendingFilters` and only take effect once "تطبيق الفلترة" is
  // pressed (copied into `appliedFilters`, which fetchCases actually reads)
  // -- each filter category narrows the result set with AND (a case must
  // satisfy every active filter, not just one), and within a category
  // (e.g. two agencies) selections combine with OR, matching how the
  // backend resolves them.
  const blankCaseFilters = { status: [], priority: [], agencyIds: [], employeeIds: [], classificationIds: [], dateFrom: '', dateTo: '' };
  const [pendingFilters, setPendingFilters] = useState(blankCaseFilters);
  const [appliedFilters, setAppliedFilters] = useState(blankCaseFilters);

  // Seeds filters straight from the URL's query string -- the entry point
  // for the AI assistant's navigate_to_page tool, which sends the browser
  // here with e.g. /cases?status=open,in_progress. Guarded by a ref (not
  // `[]`) so navigating /cases?a -> /cases?b while already on this route
  // (no remount) still re-applies, but the in-page "تطبيق الفلترة" button
  // (which never touches the URL) never re-triggers this.
  const seededSearchRef = useRef(null);
  useEffect(() => {
    const qs = searchParams.toString();
    if (!qs || qs === seededSearchRef.current) return;
    seededSearchRef.current = qs;
    const seeded = {
      status: (searchParams.get('status') || '').split(',').filter(Boolean),
      priority: (searchParams.get('priority') || '').split(',').filter(Boolean),
      agencyIds: (searchParams.get('agency_ids') || '').split(',').filter(Boolean).map(Number),
      employeeIds: (searchParams.get('employee_ids') || '').split(',').filter(Boolean).map(Number),
      classificationIds: (searchParams.get('classification_ids') || '').split(',').filter(Boolean),
      dateFrom: searchParams.get('date_from') || '',
      dateTo: searchParams.get('date_to') || '',
    };
    setPendingFilters(seeded);
    setAppliedFilters(seeded);
    setSearchTerm(searchParams.get('search') || '');
    setPage(0);
  }, [searchParams]);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [classifications, setClassifications] = useState([]);
  const [activityPopoverCaseId, setActivityPopoverCaseId] = useState(null);
  const [activityPopoverNotifications, setActivityPopoverNotifications] = useState([]);

  const fetchCases = () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    if (searchTerm) params.set('search', searchTerm);
    if (appliedFilters.status.length) params.set('status', appliedFilters.status.join(','));
    if (appliedFilters.priority.length) params.set('priority', appliedFilters.priority.join(','));
    if (appliedFilters.agencyIds.length) params.set('agency_ids', appliedFilters.agencyIds.join(','));
    if (appliedFilters.employeeIds.length) params.set('employee_ids', appliedFilters.employeeIds.join(','));
    if (appliedFilters.classificationIds.length) params.set('classification_ids', appliedFilters.classificationIds.join(','));
    if (appliedFilters.dateFrom) params.set('date_from', appliedFilters.dateFrom);
    if (appliedFilters.dateTo) params.set('date_to', appliedFilters.dateTo);
    api.get(`/cases?${params}`).then(d => {
      // Thousands of cases means fetching them all up front (the old
      // behavior, capped at 1000) stops scaling -- this now fetches one
      // 100-row page at a time from the server instead, so search also has
      // to run server-side (see the `search` param above) rather than only
      // filtering whatever happened to already be in memory.
      setCases(Array.isArray(d) ? d : d.data || []);
      setTotal(Array.isArray(d) ? d.length : d.total || 0);
      setFetchError('');
      setLoading(false);
      setInitialLoading(false);
    // Previously left `cases` at [] on any failure -- rendered as "لا توجد
    // قضايا" (no cases exist), indistinguishable from a genuinely empty
    // caseload. The backend already returns a specific error message
    // (res.json({error: err.message})) -- surfacing it here instead of a
    // fixed generic string, since a search that intermittently 500s needs
    // the ACTUAL reason visible to diagnose, not just "try refreshing".
    }).catch((e) => { setFetchError(`تعذر تحميل القضايا — ${e.message || 'حاول تحديث الصفحة'}`); setLoading(false); setInitialLoading(false); });
  };

  const fetchAgencies = () => {
    api.get('/agencies?limit=500').then(d => {
      setAgencies(d?.data || []);
    }).catch(() => {});
  };

  useEffect(() => { fetchCases(); }, [page, appliedFilters]);
  // Debounced: a search term that refetches the server on every keystroke
  // would hammer the API once the caseload is in the thousands. Skips its
  // own first run (component mount) -- otherwise every page load fired a
  // second, redundant fetch 350ms after the [page] effect's initial one.
  const searchMounted = useRef(false);
  useEffect(() => {
    if (!searchMounted.current) { searchMounted.current = true; return; }
    const t = setTimeout(() => {
      if (page !== 0) setPage(0); // triggers the [page] effect's fetch
      else fetchCases();
    }, 350);
    return () => clearTimeout(t);
  }, [searchTerm]);
  useEffect(() => { setPageInput(String(page + 1)); }, [page]);
  useEffect(() => {
    if (activityPopoverCaseId == null) return;
    const onClick = (e) => { if (!e.target.closest('[data-activity-popover]')) { setActivityPopoverCaseId(null); setActivityPopoverNotifications([]); } };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [activityPopoverCaseId]);
  // Opening the "why" popover IS the acknowledgment -- the badge clears once
  // it's read, exactly like opening the case itself already does. The
  // notifications list is snapshotted into its own state BEFORE clearing the
  // case's count, so the popover keeps showing what it was showing even
  // after the trigger button (gated on count > 0) disappears from the row.
  // Only zeroed locally once the server confirms (same reasoning as
  // Topbar.jsx's own notification-read handling) -- clearing it optimistically
  // before the request settles left a window where a concurrent fetchCases()
  // (page/filter change, create/delete) could land with the still-old count
  // and make the badge flash back after the user had just dismissed it.
  const openActivityPopover = async (caseId, notifications) => {
    setActivityPopoverCaseId(caseId);
    setActivityPopoverNotifications(notifications);
    try {
      await api.put(`/cases/${caseId}/notifications/read`);
      setCases(prev => prev.map(c => c.id === caseId ? { ...c, unread_notification_count: 0 } : c));
    } catch {}
  };
  useEffect(() => {
    api.get('/permissions/mine').then(d => setCanViewAllCases(d.canViewAllCases !== false)).catch(() => {});
  }, []);
  // Agencies/employees/classifications populate the filter panel's scrollable
  // pickers -- fetched once up front rather than only when opening the "new
  // case" form.
  useEffect(() => {
    fetchAgencies();
    api.get('/users').then(d => setEmployees(d.data || [])).catch(() => {});
    // 'not_started' is a synthetic option matching the "لم يبدأ بعد" badge
    // shown for cases with no classified request yet -- not a real
    // pipeline_lists row, so it's prepended here rather than coming from the
    // API (same case the backend's classification_ids filter special-cases).
    api.get('/pipeline-lists').then(d => {
      const lists = (Array.isArray(d) ? d : d.data || []).filter(l => l.name_en !== 'Not Started');
      setClassifications([{ id: 'not_started', name_ar: 'لم يبدأ بعد' }, ...lists]);
    }).catch(() => {});
  }, []);

  const applyCaseFilters = () => { setPage(0); setAppliedFilters(pendingFilters); };
  const clearCaseFilters = () => { setPendingFilters(blankCaseFilters); setPage(0); setAppliedFilters(blankCaseFilters); };
  const caseFiltersDirty = JSON.stringify(pendingFilters) !== JSON.stringify(appliedFilters);
  const activeCaseFilterCount = appliedFilters.status.length + appliedFilters.priority.length
    + appliedFilters.agencyIds.length + appliedFilters.employeeIds.length + appliedFilters.classificationIds.length
    + (appliedFilters.dateFrom ? 1 : 0) + (appliedFilters.dateTo ? 1 : 0);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const goToPage = () => {
    const n = parseInt(pageInput);
    if (Number.isFinite(n) && n >= 1 && n <= totalPages) setPage(n - 1);
    else setPageInput(String(page + 1));
  };

  const toggleAgency = (agencyId) => {
    setForm(prev => {
      const exists = prev.selectedAgencies.find(a => a === agencyId);
      return {
        ...prev,
        selectedAgencies: exists
          ? prev.selectedAgencies.filter(a => a !== agencyId)
          : [...prev.selectedAgencies, agencyId]
      };
    });
  };

  const createCase = async () => {
    if (!form.defendant_name.trim()) return;
    try {
      // معلومات تسجيل القضية replaced the old عنوان/وصف/عميل fields entirely --
      // اسم المتهم is now the case's effective title (everything downstream --
      // the cases list, search, mailPoller's title-matching -- reads
      // cases.title, so it still needs a meaningful value), and ملخص القضية
      // doubles as the description.
      const res = await api.post('/cases', {
        title: form.defendant_name,
        description: form.case_summary,
        priority: form.priority,
        defendant_name: form.defendant_name,
        source_agency_name: form.source_agency_name,
        story_hook: form.story_hook,
        article_url: form.article_url,
        case_summary: form.case_summary,
        agencies: form.selectedAgencies.map(id => ({ agency_id: id }))
      });
      // POST /cases now classifies every new request as "لم يبدأ بعد" (Not
      // Started) itself -- this used to do it here instead, via a second
      // round trip to PUT /requests/:id/classification with a hardcoded
      // classification_id: 1 that doesn't exist in pipeline_lists (real ids
      // are seeded, not fixed at 1), so that endpoint's own validation
      // rejected it with a 400 on every single case creation. Since these
      // calls were awaited inside the same try block (not their own
      // try/catch), Promise.all rejecting on that 400 propagated up and hit
      // the catch below -- showing "❌ فشل إنشاء القضية" even though the case
      // itself had already been created successfully.
      setShowForm(false);
      setForm({ priority: 'medium', defendant_name: '', source_agency_name: '', story_hook: '', article_url: '', case_summary: '', selectedAgencies: [] });
      fetchCases();
    } catch (e) {
      alert('❌ فشل إنشاء القضية: ' + e.message);
    }
  };

  const handleDelete = async (caseId) => {
    if (!confirm('🗑️ هل أنت متأكد من حذف القضية #' + caseId + '؟')) return;
    try {
      await api.delete(`/cases/${caseId}`);
      fetchCases();
    } catch (e) {
      alert('❌ فشل الحذف: ' + e.message);
    }
  };

  const handleCasesUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/cases/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('foia_token') },
        body: formData
      });
      const data = await res.json();
      alert(data.message || `✅ تم استيراد ${data.imported} قضية`);
      fetchCases();
    } catch (err) {
      alert('❌ فشل الرفع: ' + err.message);
    }
    e.target.value = '';
  };

  // Search now runs server-side (see fetchCases's `search` param) since
  // pagination means `cases` only ever holds the current page, not the
  // whole caseload to filter client-side against.
  const filteredCases = cases;

  if (initialLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-10 h-10 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
    </div>
  );

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>🗂️ القضايا</h1>
          <p style={{ color: 'var(--text-muted)' }}>
            {cases.length} قضية
            {!canViewAllCases && <span className="mr-2 text-xs px-2 py-0.5 rounded-lg" style={{ background: 'var(--accent-subtle, rgba(212,168,67,0.12))', color: 'var(--accent)' }}>القضايا المسندة إليك فقط</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Upload Excel */}
          <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium cursor-pointer transition-all border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            <Upload className="w-4 h-4" />
            رفع Excel
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleCasesUpload} className="hidden" />
          </label>
          <button onClick={() => { setShowForm(true); fetchAgencies(); }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold transition-all"
            style={{ background: 'var(--accent)', color: '#1A1A2E' }}>
            <Plus className="w-4 h-4" />
            قضية جديدة
          </button>
        </div>
      </div>

      {/* Search + filter toggle */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-muted)' }} />
          <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="🔍 ابحث برقم القضية أو العنوان..."
            className="w-full px-12 py-3 rounded-xl border focus:outline-none"
            style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
        </div>
        <button onClick={() => setShowFilterPanel(o => !o)}
          className="flex items-center gap-2 px-4 py-3 rounded-xl border font-medium shrink-0"
          style={{ background: showFilterPanel || activeCaseFilterCount > 0 ? 'var(--accent)' : 'var(--bg-secondary)', borderColor: 'var(--border)', color: showFilterPanel || activeCaseFilterCount > 0 ? 'var(--text-inverse, #1A1A2E)' : 'var(--text-primary)' }}>
          <Filter className="w-4 h-4" />
          فلترة
          {activeCaseFilterCount > 0 && (
            <span className="px-1.5 rounded-full text-[10px] font-bold" style={{ background: 'var(--text-inverse, #1A1A2E)', color: 'var(--accent)' }}>{activeCaseFilterCount}</span>
          )}
        </button>
      </div>

      {/* Advanced filter panel -- flexible: each category (status, priority,
          agencies, employees, date range) can be used alone or combined with
          the rest; nothing is applied until "تطبيق الفلترة" is pressed. */}
      {showFilterPanel && (
        <div className="p-2.5 rounded-2xl border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
          {/* One single row -- every filter type uses the same compact
              dropdown/popover control for a consistent, professional look,
              and "تطبيق الفلترة" lives at the tail of the same row instead of
              its own bordered section below, so the whole panel stays a
              single compact strip. No overflow-x-auto here: each popover's
              dropdown is absolutely positioned and pops OUT of this row's
              bounds -- overflow-x-auto on the parent clips overflow-y too
              (a CSS rule: setting one axis to auto/scroll forces the other
              off "visible"), which was cutting every open dropdown off
              instead of letting it float freely like before. */}
          <div className="flex items-center gap-1.5">
            <MultiSelectPopover label="الحالة" icon="📊"
              options={STATUS_OPTIONS} selectedIds={pendingFilters.status}
              onChange={ids => setPendingFilters(p => ({ ...p, status: ids }))}
              getId={s => s.key} getLabel={s => s.label} showSearch={false} />

            <MultiSelectPopover label="الأولوية" icon="⭐"
              options={PRIORITY_OPTIONS} selectedIds={pendingFilters.priority}
              onChange={ids => setPendingFilters(p => ({ ...p, priority: ids }))}
              getId={p => p.key} getLabel={p => p.label} showSearch={false} />

            <MultiSelectPopover label="الجهات" icon={<Building2 className="w-3.5 h-3.5" />}
              options={agencies} selectedIds={pendingFilters.agencyIds}
              onChange={ids => setPendingFilters(p => ({ ...p, agencyIds: ids }))}
              getId={a => a.id} getLabel={a => a.name_ar || a.name_en || `#${a.id}`} />

            <MultiSelectPopover label="الموظفون" icon={<Users className="w-3.5 h-3.5" />}
              options={employees} selectedIds={pendingFilters.employeeIds}
              onChange={ids => setPendingFilters(p => ({ ...p, employeeIds: ids }))}
              getId={u => u.id} getLabel={u => u.name || u.email} />

            <MultiSelectPopover label="التصنيف" icon="🏷️"
              options={classifications} selectedIds={pendingFilters.classificationIds}
              onChange={ids => setPendingFilters(p => ({ ...p, classificationIds: ids }))}
              getId={c => c.id} getLabel={c => c.name_ar || c.name_en || `#${c.id}`} />

            <div className="w-px h-6 shrink-0" style={{ background: 'var(--border)' }} />

            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[11px] shrink-0" style={{ color: 'var(--text-muted)' }}>من</span>
              <CalendarPopup value={pendingFilters.dateFrom} onChange={d => setPendingFilters(p => ({ ...p, dateFrom: d }))} placeholder="تاريخ" />
              <span className="text-[11px] shrink-0" style={{ color: 'var(--text-muted)' }}>إلى</span>
              <CalendarPopup value={pendingFilters.dateTo} onChange={d => setPendingFilters(p => ({ ...p, dateTo: d }))} placeholder="تاريخ" />
            </div>

            <div className="w-px h-6 shrink-0" style={{ background: 'var(--border)' }} />

            {/* Result count reflects the last APPLIED filters (not whatever's
                still pending/unconfirmed in the popovers) -- only shown once
                at least one filter is actually active. */}
            {activeCaseFilterCount > 0 && !caseFiltersDirty && (
              <span className="text-[11px] font-medium shrink-0 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                🔎 {total}
              </span>
            )}
            {(activeCaseFilterCount > 0 || caseFiltersDirty) && (
              <button onClick={clearCaseFilters} className="text-[11px] underline shrink-0 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>مسح</button>
            )}
            <button onClick={applyCaseFilters}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 whitespace-nowrap"
              style={{ background: 'var(--accent)', color: 'var(--text-inverse, #1A1A2E)' }}>
              <Filter className="w-3 h-3" /> تطبيق الفلترة
            </button>
          </div>
        </div>
      )}

      {/* Create Form */}
      {showForm && (
        <div className="p-6 rounded-2xl border animate-slideUp"
          style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-md)' }}>
          <h2 className="font-semibold mb-4" style={{ color: 'var(--accent)' }}>📝 قضية جديدة</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
            <div className="space-y-4">
              {/* معلومات تسجيل القضية -- replaces the old عنوان/وصف/عميل fields;
                  اسم المتهم is now the case's effective title. Each field has
                  a persistent label (not just a placeholder) with its own row. */}
              <div className="flex items-center gap-3">
                <label className="w-28 shrink-0 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>اسم المتهم *</label>
                <input value={form.defendant_name} onChange={e => setForm({...form, defendant_name: e.target.value})}
                  className="flex-1 px-4 py-3 rounded-xl border focus:outline-none"
                  style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
              </div>
              <div className="flex items-center gap-3">
                <label className="w-28 shrink-0 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>اسم الوكالة</label>
                <input value={form.source_agency_name} onChange={e => setForm({...form, source_agency_name: e.target.value})}
                  className="flex-1 px-4 py-3 rounded-xl border focus:outline-none"
                  style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
              </div>
              <div className="flex items-center gap-3">
                <label className="w-28 shrink-0 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>الهوك</label>
                <input value={form.story_hook} onChange={e => setForm({...form, story_hook: e.target.value})}
                  className="flex-1 px-4 py-3 rounded-xl border focus:outline-none"
                  style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
              </div>
              <div className="flex items-center gap-3">
                <label className="w-28 shrink-0 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>رابط المقال</label>
                <input value={form.article_url} onChange={e => setForm({...form, article_url: e.target.value})}
                  className="flex-1 px-4 py-3 rounded-xl border focus:outline-none"
                  style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
              </div>
              <div className="flex items-start gap-3">
                <label className="w-28 shrink-0 text-sm font-medium pt-3" style={{ color: 'var(--text-primary)' }}>ملخص القضية</label>
                <textarea value={form.case_summary} onChange={e => setForm({...form, case_summary: e.target.value})}
                  rows={4}
                  className="flex-1 px-4 py-3 rounded-xl border resize-y focus:outline-none"
                  style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)', minHeight: '6rem' }} />
              </div>
            </div>
            {/* Agencies Selection + Priority */}
            <div>
              <p className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                اختر الجهات المستهدفه ({form.selectedAgencies.length})
              </p>
              <div className="rounded-xl border max-h-60 overflow-y-auto"
                style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)' }}>
                {agencies.length === 0 ? (
                  <div className="p-4 text-center">
                    <p style={{ color: 'var(--text-muted)' }}>لا توجد جهات بعد</p>
                    <button onClick={() => navigate('/agencies')}
                      style={{ color: 'var(--accent)' }}>
                      اذهب لصفحة الجهات ←
                    </button>
                  </div>
                ) : agencies.map(a => (
                  <label key={a.id}
                    className="flex items-start gap-3 px-3 py-3 border-b cursor-pointer transition-all"
                    style={{ borderColor: 'var(--border)' }}
                    onMouseOver={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                    <input type="checkbox" checked={form.selectedAgencies.includes(a.id)}
                      onChange={() => toggleAgency(a.id)}
                      className="w-5 h-5 rounded accent-[#D4A843] mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {a.name_ar || a.name_en}
                        </p>
                        {a.type && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                            {AGENCY_TYPE_LABELS[a.type] || a.type}
                          </span>
                        )}
                      </div>
                      {a.name_ar && a.name_en && (
                        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{a.name_en}</p>
                      )}
                      <div className="flex items-center gap-x-3 gap-y-0.5 text-[11px] mt-1 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                        {(a.city || a.state) && <span>📍 {[a.city, a.state].filter(Boolean).join('، ')}</span>}
                        {a.email && <span className="truncate">✉️ {a.email}</span>}
                        {a.phone && <span>☎️ {a.phone}</span>}
                        {a.average_response_days != null && <span>⏱ متوسط الرد: {a.average_response_days} يوم</span>}
                      </div>
                    </div>
                    {form.selectedAgencies.includes(a.id) && (
                      <span className="px-2 py-1 rounded shrink-0" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
                        ✅ مختار
                      </span>
                    )}
                  </label>
                ))}
              </div>

              {/* الأهمية -- placed below الجهات per request */}
              <div className="flex items-center gap-3 mt-4">
                <label className="shrink-0 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>الأهمية</label>
                <select value={form.priority} onChange={e => setForm({...form, priority: e.target.value})}
                  className="flex-1 px-4 py-3 rounded-xl border"
                  style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                  <option value="low">🟢 منخفض</option>
                  <option value="medium">🟡 متوسط</option>
                  <option value="high">🔴 عاجل</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)}
              className="px-4 py-2.5 rounded-xl font-medium border"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              إلغاء
            </button>
            <button onClick={createCase}
              className="px-5 py-2.5 rounded-xl font-semibold"
              style={{ background: 'var(--accent)', color: '#1A1A2E' }}>
              ✨ إنشاء القضية
            </button>
          </div>
        </div>
      )}

      {/* Cases Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : fetchError ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-lg" style={{ color: '#ef4444' }}>⚠️ {fetchError}</p>
          <button onClick={() => { setLoading(true); fetchCases(); }} className="mt-4 px-5 py-2.5 rounded-xl font-semibold"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
            إعادة المحاولة
          </button>
        </div>
      ) : filteredCases.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-lg" style={{ color: 'var(--text-secondary)' }}>📂 لا توجد قضايا</p>
          <p className="mt-2" style={{ color: 'var(--text-muted)' }}>أضف قضية جديدة أو ارفع ملف Excel</p>
          <div className="flex gap-3 mt-4">
            <button onClick={() => { setShowForm(true); fetchAgencies(); }}
              className="px-5 py-3 rounded-xl font-semibold"
              style={{ background: 'var(--accent)', color: '#1A1A2E' }}>
              ➕ إضافة قضية
            </button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--border)', boxShadow: 'var(--shadow-sm)' }}>
          <table className="w-full">
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)' }}>
                <th className="px-4 py-3.5 text-right font-medium" style={{ color: 'var(--text-muted)' }}>#</th>
                <th className="px-4 py-3.5 text-right font-medium" style={{ color: 'var(--text-muted)' }}>📌 العنوان / التصنيف</th>
                <th className="px-4 py-3.5 text-right font-medium" style={{ color: 'var(--text-muted)' }}>🏛️ الجهات</th>
                <th className="px-4 py-3.5 text-right font-medium" style={{ color: 'var(--text-muted)' }}>📊 الحالة</th>
                <th className="px-4 py-3.5 text-right font-medium" style={{ color: 'var(--text-muted)' }}>⭐ الأولوية</th>
                <th className="px-4 py-3.5 text-right font-medium" style={{ color: 'var(--text-muted)' }}>📅 التاريخ</th>
                <th className="px-4 py-3.5 text-center font-medium" style={{ color: 'var(--text-muted)' }}>⚙️</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {filteredCases.map(c => {
                const st = STATUS_STYLES[c.status] || { bg: '#6B7280', label: c.status };
                return (
                  <tr key={c.id}
                    className="cursor-pointer"
                    style={{ borderColor: 'var(--border)', transition: 'background-color 0.15s ease' }}
                    onMouseOver={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}>

                    <td className="px-4 py-3.5 font-mono font-bold" style={{ color: 'var(--accent)' }}>#{c.id}</td>

                    <td className="px-4 py-3.5"
                      onClick={() => navigate(`/cases/${c.id}`)}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{c.title}</span>
                        {/* Classification is the first thing after the title,
                            deliberately theme-invariant (black text / white
                            chip) rather than color-by-list, so it reads as a
                            crisp, unambiguous status label at a glance. */}
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{ background: '#FFFFFF', color: '#111111', border: '1px solid #E5E7EB', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
                          🏷️ {c.classification_name || 'لم يبدأ بعد'}
                        </span>
                        {/* Only things that actually need attention -- a
                            teammate's note/mention, a new email, or a
                            newly-uploaded file, whether in نقاش الفريق or a
                            checklist item's own notes. Deliberately excludes
                            routine notices like "case created" or "status
                            changed" (those stay in the general bell only).
                            Clicking shows WHY, instead of a bare count. */}
                        {(c.unread_notification_count > 0 || activityPopoverCaseId === c.id) && (
                          <span className="relative" data-activity-popover onClick={e => e.stopPropagation()}>
                            {/* Gated on count alone (not popover-open) so the
                                trigger vanishes the instant it's read, while
                                the popover below -- gated on a SEPARATE
                                snapshot state -- keeps showing what it showed
                                until the user clicks away. Without splitting
                                these, clearing the count on open would also
                                wipe the list it's supposed to display. */}
                            {c.unread_notification_count > 0 && (
                              <button
                                onClick={() => openActivityPopover(c.id, c.unread_notifications)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ds-transition-colors"
                                style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444' }}
                                title="اضغط لمعرفة سبب هذا الإشعار">
                                <Bell className="w-2.5 h-2.5" />
                                {c.unread_notification_count > 9 ? '9+' : c.unread_notification_count}
                              </button>
                            )}
                            {activityPopoverCaseId === c.id && (
                              <div className="absolute z-30 top-full mt-1 w-64 rounded-xl p-2 text-right" dir="rtl"
                                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>
                                <div className="space-y-1 max-h-56 overflow-y-auto">
                                  {activityPopoverNotifications.map((n, i) => (
                                    <div key={i} className="p-2 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
                                      <p className="text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>
                                        {ACTIVITY_TYPE_LABEL[n.type] || n.title}
                                      </p>
                                      {n.body && <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{n.body}</p>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3.5" onClick={() => navigate(`/cases/${c.id}`)}>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium"
                        style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                        <Building2 className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                        {c.request_count || 0}
                      </span>
                    </td>

                    {/* Same "outlined chip, dark text" treatment throughout
                        this row instead of solid tinted-color blocks -- a
                        small color dot carries the meaning (status/priority)
                        without turning the whole row into a wall of color. */}
                    <td className="px-4 py-3.5" onClick={() => navigate(`/cases/${c.id}`)}>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium"
                        style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: st.bg }} />
                        {st.label.replace(/^\S+\s/, '')}
                      </span>
                    </td>

                    <td className="px-4 py-3.5" onClick={() => navigate(`/cases/${c.id}`)}>
                      {(() => {
                        const pColor = c.priority === 'high' ? '#EF4444' : c.priority === 'medium' ? '#F59E0B' : '#3B82F6';
                        const pLabel = c.priority === 'high' ? 'عاجل' : c.priority === 'medium' ? 'متوسط' : 'منخفض';
                        return (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium"
                            style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: pColor }} />
                            {pLabel}
                          </span>
                        );
                      })()}
                    </td>

                    <td className="px-4 py-3.5 text-[12px]" style={{ color: 'var(--text-muted)' }}
                      onClick={() => navigate(`/cases/${c.id}`)}>
                      {c.created_at ? new Date(c.created_at).toLocaleDateString('ar-EG') : '—'}
                    </td>

                    <td className="px-4 py-3.5 text-center">
                      <button onClick={e => { e.stopPropagation(); handleDelete(c.id); }}
                        title="حذف"
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors"
                        style={{ color: 'var(--text-muted)', background: 'transparent' }}
                        onMouseOver={e => { e.currentTarget.style.background = '#EF444415'; e.currentTarget.style.color = '#EF4444'; }}
                        onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !fetchError && total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-2 flex-wrap pt-1">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40"
            style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            السابق
          </button>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            صفحة {page + 1} من {totalPages} ({total} قضية)
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
            className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40"
            style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            التالي
          </button>
          <div className="flex items-center gap-1.5 mr-2">
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>الذهاب لصفحة:</span>
            <input value={pageInput} onChange={e => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={e => { if (e.key === 'Enter') goToPage(); }}
              className="w-14 px-2 py-1.5 rounded-lg text-sm text-center"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            <button onClick={goToPage}
              className="px-3 py-1.5 rounded-lg text-sm font-medium"
              style={{ background: 'var(--accent)', color: 'var(--text-inverse)' }}>
              انتقال
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
