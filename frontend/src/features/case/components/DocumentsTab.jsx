import { getApiBase } from '../../../api';
const API = getApiBase();
import { useState, useEffect, useMemo } from 'react';
import { Search, Trash2, FileText, Image, Video, Music, Folder, Upload, Eye, CheckSquare, Square, X, Download, Pencil, Share2, Mail, CloudUpload, Link2, Loader2, Copy } from 'lucide-react';
import { useCaseContext } from '../context/CaseContext';
import UploadZone from '../../drive/components/UploadZone';
import AppBadge from '../../../components/ds/AppBadge';
import Button from '../../../components/ui/Button';

const tok = () => localStorage.getItem('foia_token');
const hdrs = () => ({ 'Authorization': `Bearer ${tok()}`, 'Content-Type': 'application/json' });

const fileIcons = { image: Image, video: Video, audio: Music, pdf: FileText, document: FileText };
const fileColors = { image: '#3b82f6', video: '#8b5cf6', audio: '#10b981', pdf: '#ef4444', document: '#636366' };

function detectFileType(filename = '') {
  const ext = filename?.split('.').pop()?.toLowerCase() || '';
  if (['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext)) return 'image';
  if (['mp4','mov','avi','mkv','webm','wmv'].includes(ext)) return 'video';
  if (['mp3','wav','ogg','flac','aac','m4a'].includes(ext)) return 'audio';
  if (['pdf'].includes(ext)) return 'pdf';
  return 'document';
}

/** Human-readable size: 512 B / 12 KB / 2.4 MB / 1.8 GB.
 *  DB column is `size` (case_documents), so accept both `size` and the
 *  legacy `file_size` alias for safety. */
function getSize(doc) {
  const v = doc?.size ?? doc?.file_size ?? null;
  return v;
}

function shortenSize(bytes) {
  if (!bytes || isNaN(bytes)) return '—';
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Where did this file come from? 'email' if the backend recorded an email
 *  origin (mailPoller / compose), otherwise 'manual' (Documents tab upload). */
function detectSource(doc) {
  if (doc?.source === 'email') return 'email';
  if (doc?.source === 'manual') return 'manual';
  // Fallback heuristics on existing fields (no schema change needed):
  if (doc?.storage_provider === 'google_drive' && doc?.category === 'incoming') return 'email';
  if (doc?.metadata && typeof doc.metadata === 'string' && doc.metadata.includes('"source":"email"')) return 'email';
  if (doc?.metadata && typeof doc.metadata === 'object' && doc.metadata?.source === 'email') return 'email';
  return 'manual';
}

/** Meaningful status — only real states; never "قيد الانتظار"/"قيد المراجعة". */
function statusInfo(doc) {
  if (doc?.verification_status === 'verified') return { label: 'موثّق', variant: 'success' };
  if (doc?.verification_status === 'rejected') return { label: 'مرفوض', variant: 'danger' };
  // Upload succeeded (has a storage home) → completed. No indeterminate
  // "pending" labels — a stored file is a completed file.
  return { label: 'مكتمل', variant: 'neutral' };
}

export default function DocumentsTab() {
  const { id, documents, removeDocument, setPreviewFile, refetch } = useCaseContext();
  const [categories, setCategories] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [catFilter, setCatFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [bulkAction, setBulkAction] = useState('');
  const [sharingId, setSharingId] = useState(null);
  const [shareResult, setShareResult] = useState(null);
  const [shareError, setShareError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`${API}/documents/categories`, { headers: hdrs() }).then(r => r.json()).then(d => setCategories(d.categories || []));
  }, []);

  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const startRename = (doc) => { setRenamingId(doc.id); setRenameValue(doc.original_name || doc.file_name || ''); };

  const commitRename = async (docId) => {
    const newName = renameValue.trim();
    setRenamingId(null);
    if (!newName) return;
    try {
      const r = await fetch(`${API}/documents/${docId}`, { method: 'PUT', headers: hdrs(), body: JSON.stringify({ original_name: newName }) });
      const d = await r.json();
      if (d.success) refetch?.(true);
      else alert('❌ ' + (d.error || 'فشلت إعادة التسمية'));
    } catch (e) { alert('❌ ' + e.message); }
  };

  const downloadDocument = async (docId) => {
    try {
      const r = await fetch(`${API}/documents/${docId}/download`, { headers: hdrs() });
      const d = await r.json();
      if (d.url) window.open(d.url, '_blank', 'noopener,noreferrer');
      else alert('❌ ' + (d.error || 'تعذر التحميل'));
    } catch (e) { alert('❌ ' + e.message); }
  };

  /** Share = reuse Google Drive's own permission model. No extra copy, no
   *  duplicate storage — just set the existing Drive file's permission and
   *  return its link. */
  const shareDocument = async (doc, role = 'reader') => {
    setSharingId(doc.id);
    setShareError('');
    setShareResult(null);
    try {
      const r = await fetch(`${API}/gdrive/share-file`, {
        method: 'POST', headers: hdrs(),
        body: JSON.stringify({ document_id: doc.id, role }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'فشلت المشاركة');
      setShareResult({ docId: doc.id, url: d.shareUrl || d.url, role });
    } catch (e) {
      setShareError(e.message);
      setShareResult(null);
    }
    setSharingId(null);
  };

  const copyLink = async () => {
    if (!shareResult?.url) return;
    try { await navigator.clipboard.writeText(shareResult.url); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { window.prompt('انسخ الرابط:', shareResult.url); }
  };

  const filtered = useMemo(() => {
    let list = [...(documents || [])];
    if (catFilter !== 'all') list = list.filter(d => d.category_id === parseInt(catFilter));
    if (search) list = list.filter(d => (d.file_name || d.original_name || '').toLowerCase().includes(search.toLowerCase()));
    list.sort((a, b) => {
      if (sortBy === 'name') return (a.file_name || '').localeCompare(b.file_name || '');
      if (sortBy === 'size') return (getSize(b) || 0) - (getSize(a) || 0);
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
    return list;
  }, [documents, catFilter, search, sortBy]);

  const toggleSelect = (docId) => {
    setSelected(s => { const n = new Set(s); n.has(docId) ? n.delete(docId) : n.add(docId); return n; });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(d => d.id)));
  };

  const doBulk = async (action) => {
    if (selected.size === 0) return;
    if (action === 'delete') {
      for (const id of selected) removeDocument?.(id);
      setSelected(new Set());
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload zone */}
      <UploadZone caseId={id} />

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[150px]">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--ds-text-muted)' }} />
          <input className="w-full pr-8 pl-2 py-1.5 rounded-lg text-xs ds-transition-colors" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
            placeholder="بحث في الملفات..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="text-[11px] px-2 py-1.5 rounded-lg cursor-pointer" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
          value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="all">كل التصنيفات</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name_ar || c.name}</option>)}
        </select>
        <select className="text-[11px] px-2 py-1.5 rounded-lg cursor-pointer" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
          value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="date">حسب التاريخ</option>
          <option value="name">حسب الاسم</option>
          <option value="size">حسب الحجم</option>
        </select>
        {selected.size > 0 && (
          <span className="text-[11px] px-2 py-1 rounded" style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>
            تم اختيار {selected.size}
          </span>
        )}
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)' }}>
          <Button variant="danger" size="sm" onClick={() => doBulk('delete')}><Trash2 className="w-3 h-3" />حذف</Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}><X className="w-3 h-3" />إلغاء</Button>
        </div>
      )}

      {/* Document list */}
      <div className="space-y-1.5">
        {filtered.length === 0 ? (
          <div className="text-center py-10 text-sm" style={{ color: 'var(--ds-text-muted)' }}>
            <div className="w-12 h-12 mx-auto mb-3 rounded-2xl flex items-center justify-center" style={{ background: 'var(--ds-bg-tertiary)' }}>
              <Upload className="w-6 h-6" />
            </div>
            لا توجد ملفات. اسحب وأفلت الملفات للرفع.
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 text-[10px] font-semibold rounded-t-lg" style={{ color: 'var(--ds-text-muted)', background: 'var(--ds-bg-tertiary)', border: '1px solid var(--ds-border)', borderBottom: 'none' }}>
              <button onClick={toggleAll} className="w-4 h-4 rounded flex items-center justify-center shrink-0" style={{ border: '1px solid var(--ds-border)' }}>
                {selected.size === filtered.length ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
              </button>
              <span className="flex-1">الملف</span>
              <span className="w-20 hidden sm:block">التصنيف</span>
              <span className="w-16 hidden sm:block">الحجم</span>
              <span className="w-20 hidden md:block">المصدر</span>
              <span className="w-16 hidden md:block">الحالة</span>
              <span className="w-16 hidden lg:block">التاريخ</span>
              <span className="w-24" />
            </div>
            {filtered.map(doc => {
              const ft = detectFileType(doc.file_name || doc.original_name);
              const Icon = fileIcons[ft] || FileText;
              const cat = categories.find(c => c.id === doc.category_id);
              const size = shortenSize(getSize(doc));
              const source = detectSource(doc);
              const st = statusInfo(doc);
              const isSharing = sharingId === doc.id;
              const isShared = shareResult?.docId === doc.id;
              return (
                <div key={doc.id} className="relative flex items-center gap-2 px-3 py-2.5 rounded-lg ds-transition-colors"
                  style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--ds-bg-tertiary)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--ds-bg-secondary)'}>
                  <button onClick={() => toggleSelect(doc.id)} className="w-4 h-4 rounded flex items-center justify-center shrink-0" style={{ border: '1px solid var(--ds-border)' }}>
                    {selected.has(doc.id) ? <CheckSquare className="w-3 h-3" style={{ color: '#3b82f6' }} /> : <Square className="w-3 h-3" />}
                  </button>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: (fileColors[ft] || '#636366') + '18' }}>
                    <Icon className="w-4 h-4" style={{ color: fileColors[ft] || '#636366' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    {renamingId === doc.id ? (
                      <input autoFocus className="w-full text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-accent)', color: 'var(--ds-text-primary)' }}
                        value={renameValue} onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(doc.id)}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(doc.id); if (e.key === 'Escape') setRenamingId(null); }} />
                    ) : (
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[11px] font-medium truncate cursor-pointer" style={{ color: 'var(--ds-text-primary)' }}
                          onClick={() => setPreviewFile?.(doc)}>{doc.original_name || doc.file_name || 'بدون اسم'}</span>
                        <span className="text-[9px] sm:hidden shrink-0" style={{ color: 'var(--ds-text-muted)' }}>{size}</span>
                      </div>
                    )}
                  </div>
                  <span className="text-[9px] w-20 truncate hidden sm:block" style={{ color: 'var(--ds-text-muted)' }}>{cat?.name_ar || cat?.name || '—'}</span>
                  <span className="text-[9px] w-16 hidden sm:block" style={{ color: 'var(--ds-text-muted)' }}>{size}</span>
                  <span className="w-20 hidden md:flex items-center">
                    {source === 'email' ? (
                      <AppBadge variant="info" size="sm"><Mail className="w-2.5 h-2.5 inline mr-0.5" />إيميل</AppBadge>
                    ) : (
                      <AppBadge variant="neutral" size="sm"><CloudUpload className="w-2.5 h-2.5 inline mr-0.5" />يدوي</AppBadge>
                    )}
                  </span>
                  <span className="w-16 hidden md:block">
                    <AppBadge variant={st.variant} size="sm">{st.label}</AppBadge>
                  </span>
                  <span className="text-[9px] w-16 hidden lg:block" style={{ color: 'var(--ds-text-muted)' }}>
                    {doc.created_at ? new Date(doc.created_at).toLocaleDateString('ar-SA') : ''}
                  </span>
                  <div className="w-24 flex items-center justify-end gap-0.5 shrink-0">
                    <button className="p-1.5 rounded-md ds-transition-colors" title="معاينة" style={{ color: 'var(--ds-text-muted)' }} onClick={() => setPreviewFile?.(doc)}>
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button className="p-1.5 rounded-md ds-transition-colors" title="إعادة تسمية" style={{ color: 'var(--ds-text-muted)' }} onClick={() => startRename(doc)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button className="p-1.5 rounded-md ds-transition-colors" title="تحميل" style={{ color: 'var(--ds-text-muted)' }} onClick={() => downloadDocument(doc.id)}>
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button className="p-1.5 rounded-md ds-transition-colors" title="مشاركة عبر Google Drive" style={{ color: isShared ? '#10b981' : 'var(--ds-text-muted)' }} disabled={isSharing}
                      onClick={() => shareDocument(doc, 'reader')}>
                      {isSharing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
                    </button>
                    <button className="p-1.5 rounded-md ds-transition-colors" title="حذف" style={{ color: '#ef4444' }} onClick={() => removeDocument?.(doc.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {/* Share result inline */}
                  {isShared && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 p-3 rounded-xl animate-slideUp" style={{ background: 'var(--ds-bg-elevated)', border: '1px solid var(--ds-border)', boxShadow: 'var(--ds-shadow-lg)' }}
                      onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Link2 className="w-3.5 h-3.5" style={{ color: '#10b981' }} />
                        <span className="text-[11px] font-semibold" style={{ color: 'var(--ds-text-primary)' }}>رابط المشاركة (أي شخص لديه الرابط — عرض)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input readOnly value={shareResult.url} className="flex-1 text-[10px] px-2 py-1.5 rounded-lg font-mono" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-secondary)' }} onFocus={e => e.target.select()} />
                        <button className="p-1.5 rounded-lg ds-transition-colors" title="نسخ" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-primary)' }} onClick={copyLink}>
                          {copied ? <CheckSquare className="w-3.5 h-3.5" style={{ color: '#10b981' }} /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <a className="p-1.5 rounded-lg ds-transition-colors" title="فتح في Drive" href={shareResult.url} target="_blank" rel="noopener noreferrer" style={{ background: 'var(--ds-bg-tertiary)', color: '#3b82f6' }}>
                          <ExternalLinkIcon />
                        </a>
                        <button className="p-1.5 rounded-lg ds-transition-colors" title="إغلاق" style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-muted)' }} onClick={() => setShareResult(null)}>
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {shareError && (
              <div className="mt-2 px-3 py-2 rounded-lg text-[11px]" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444' }}>
                ❌ فشلت المشاركة: {shareError}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ExternalLinkIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>;
}
