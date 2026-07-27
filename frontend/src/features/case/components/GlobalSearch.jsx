import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useCaseContext } from '../context/CaseContext';
import { searchService } from '../../domain/services/OperationalSearchService';
import AppBadge from '../../../components/ds/AppBadge';
import { Search, FileText, MessageSquare, Building2, Clock, Star, History, Filter, X, TrendingUp, Eye, Phone, Send, Bookmark, Plus } from 'lucide-react';

const INVESTIGATION_V2 = import.meta.env.VITE_INVESTIGATION_V2 === 'true' || localStorage.getItem('INVESTIGATION_V2') === 'true';

const TYPE_ICONS = { requirement: FileText, document: FileText, communication: MessageSquare, source: Building2 };
const TYPE_COLORS = { requirement: '#3b82f6', document: '#8b5cf6', communication: '#22c55e', source: '#eab308' };

export default function GlobalSearch({ context }) {
  const { c, checklist, documents, requests, timeline } = useCaseContext();
  const [query, setQuery] = useState('');
  const [showPalette, setShowPalette] = useState(false);
  const [activeFilters, setActiveFilters] = useState({});
  const [activeTab, setActiveTab] = useState('search');
  const inputRef = useRef(null);
  const [searchHistory, setSearchHistory] = useState([]);
  const [savedSearches, setSavedSearches] = useState([]);
  const [pinned, setPinned] = useState([]);

  // Ctrl+K handler
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowPalette(p => !p);
        if (!showPalette) setTimeout(() => inputRef.current?.focus(), 100);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showPalette]);

  const searchResults = useMemo(() => {
    if (!INVESTIGATION_V2 || !query.trim()) return null;

    const ctx = {
      requirements: checklist || [],
      documents: documents || [],
      communications: [],
      agencies: (requests || []).map(r => ({ id: r.agency_id, name: r.agency_name, type: 'government_agency' })),
      investigationId: c?.id,
      investigationTitle: c?.title,
    };

    const results = searchService.search(query, ctx);
    const filtered = searchService.applyFilters(results.results, activeFilters);
    return { ...results, results: filtered };
  }, [query, checklist, documents, requests, activeFilters, c]);

  const duplicates = useMemo(() => {
    if (!INVESTIGATION_V2 || !checklist) return [];
    return searchService.detectDuplicates(
      (checklist || []).map(i => ({ sourceName: i.source_agency_name, question: i.recordMeta?.label || i.record_type })),
      documents || [],
      (requests || []).map(r => ({ name: r.agency_name }))
    ).filter(d => d.count > 1);
  }, [checklist, documents, requests]);

  useEffect(() => {
    setSearchHistory(searchService.getHistory());
    setSavedSearches(searchService.getSavedSearches());
    setPinned(searchService.getPinned());
  }, []);

  const saveCurrentSearch = () => {
    const name = prompt('اسم البحث:');
    if (name) {
      searchService.saveSearch(name, query, activeFilters);
      setSavedSearches(searchService.getSavedSearches());
    }
  };

  if (!INVESTIGATION_V2) return null;

  const palette = (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={() => setShowPalette(false)}>
      <div className="w-full max-w-xl rounded-xl shadow-2xl" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)' }}
        onClick={e => e.stopPropagation()}>
        {/* Search input */}
        <div className="flex items-center gap-2 p-3 border-b" style={{ borderColor: 'var(--ds-border)' }}>
          <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--ds-text-muted)' }} />
          <input ref={inputRef} className="flex-1 bg-transparent text-sm outline-none" style={{ color: 'var(--ds-text-primary)' }}
            placeholder="ابحث في المتطلبات، المستندات، المصادر، الاتصالات..."
            value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && setShowPalette(false)} />
          <button onClick={() => setShowPalette(false)} className="p-1 rounded" style={{ color: 'var(--ds-text-muted)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        {query.trim() && searchResults && (
          <div className="max-h-96 overflow-y-auto p-2">
            {searchResults.total === 0 ? (
              <div className="text-center py-6 text-sm" style={{ color: 'var(--ds-text-muted)' }}>لا توجد نتائج</div>
            ) : (
              Object.entries(searchResults.categories).map(([category, items]) => (
                <div key={category}>
                  <div className="text-[10px] font-semibold px-2 py-1" style={{ color: 'var(--ds-text-muted)' }}>
                    {category} ({items.length})
                  </div>
                  {items.slice(0, 5).map((item, i) => {
                    const Icon = TYPE_ICONS[item.type] || FileText;
                    const color = TYPE_COLORS[item.type] || '#3b82f6';
                    return (
                      <div key={i} className="p-2 rounded-lg cursor-pointer ds-transition-colors" style={{ color: 'var(--ds-text-primary)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--ds-bg-tertiary)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 shrink-0" style={{ color }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-medium truncate flex items-center gap-1">
                              {item.title}
                              {item.isBlocked && <span className="text-[9px] px-1 rounded" style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>مسدود</span>}
                            </div>
                            <div className="text-[10px]" style={{ color: 'var(--ds-text-muted)' }}>
                              {item.subtitle && <span>{item.subtitle} · </span>}
                              {item.investigationTitle && <span>{item.investigationTitle} · </span>}
                              <span style={{ color: item.isBlocked ? '#ef4444' : item.needsFollowUp ? '#eab308' : item.needsVerification ? '#8b5cf6' : 'inherit' }}>{item.status}</span>
                              {item.daysWaiting > 0 && <span> · {item.daysWaiting} يوم</span>}
                            </div>
                          </div>
                          <span className="text-[9px] font-mono shrink-0" style={{ color: 'var(--ds-text-muted)' }}>{item.score}</span>
                        </div>
                        {/* Context Actions */}
                        {item.actions && item.actions.length > 0 && (
                          <div className="flex items-center gap-1.5 mt-1.5 mr-7">
                            {item.actions.map((a, ai) => (
                              <button key={ai} className="text-[9px] px-2 py-0.5 rounded font-medium ds-transition-colors"
                                style={{ background: a.color === 'danger' ? 'rgba(239,68,68,0.12)' : a.color === 'warning' ? 'rgba(234,179,8,0.12)' : a.color === 'accent' ? 'rgba(139,92,246,0.12)' : a.color === 'success' ? 'rgba(34,197,94,0.12)' : 'rgba(59,130,246,0.12)', color: a.color === 'danger' ? '#ef4444' : a.color === 'warning' ? '#eab308' : a.color === 'accent' ? '#8b5cf6' : a.color === 'success' ? '#22c55e' : '#3b82f6' }}>
                                {a.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}

        {/* Recent searches */}
        {!query.trim() && searchHistory.length > 0 && (
          <div className="p-2">
            <div className="text-[10px] font-semibold px-2 py-1 flex items-center gap-1" style={{ color: 'var(--ds-text-muted)' }}>
              <History className="w-3 h-3" /> آخر البحوث
            </div>
            {searchHistory.slice(0, 5).map((h, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-lg cursor-pointer text-[11px] ds-transition-colors"
                style={{ color: 'var(--ds-text-muted)' }}
                onClick={() => setQuery(h.query)}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--ds-bg-tertiary)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <History className="w-3 h-3" />{h.query}
              </div>
            ))}
          </div>
        )}

        {/* Keyboard hint */}
        <div className="flex items-center gap-3 p-2 border-t text-[9px]" style={{ borderColor: 'var(--ds-border)', color: 'var(--ds-text-muted)' }}>
          <span>↑↓ للتنقل</span>
          <span>Enter للاختيار</span>
          <span>Esc للإغلاق</span>
          <span className="ml-auto">Ctrl+K فتح</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Search bar trigger */}
      <button onClick={() => setShowPalette(true)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm ds-transition-colors"
        style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-muted)' }}>
        <Search className="w-4 h-4" />
        <span className="flex-1 text-right">ابحث في التحقيق... (Ctrl+K)</span>
        <kbd className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--ds-bg-tertiary)' }}>Ctrl+K</kbd>
      </button>

      {/* Duplicate detection */}
      {duplicates.map((dup, i) => (
        <div key={i} className="rounded-lg p-2 text-[11px] flex items-start gap-2" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', color: '#eab308' }}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{dup.reason}</span>
        </div>
      ))}

      {palette}
    </>
  );
}

function AlertTriangle() {
  return <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
}
