import { getApiBase } from '../../../api';
const API = getApiBase();
import { useState, useEffect, useMemo } from 'react';
import { Search, Trash2, FileText, Image, Video, Music, Folder, Upload, Eye, CheckSquare, Square, X, Download, Pencil } from 'lucide-react';
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

function shortenSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}

export default function DocumentsTab() {
  const { id, documents, removeDocument, setPreviewFile, refetch } = useCaseContext();
  const [categories, setCategories] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [catFilter, setCatFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [bulkAction, setBulkAction] = useState('');

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

  const filtered = useMemo(() => {
    let list = [...(documents || [])];
    if (catFilter !== 'all') list = list.filter(d => d.category_id === parseInt(catFilter));
    if (search) list = list.filter(d => (d.file_name || d.original_name || '').toLowerCase().includes(search.toLowerCase()));
    list.sort((a, b) => {
      if (sortBy === 'name') return (a.file_name || '').localeCompare(b.file_name || '');
      if (sortBy === 'size') return (b.file_size || 0) - (a.file_size || 0);
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
    <div className="space-y-3">
      {/* Upload zone */}
      <UploadZone caseId={id} />

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[150px]">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--ds-text-muted)' }} />
          <input className="w-full pr-8 pl-2 py-1.5 rounded-lg text-xs" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
            placeholder="بحث في الملفات..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="text-[11px] px-2 py-1.5 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
          value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="all">كل التصنيفات</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name_ar || c.name}</option>)}
        </select>
        <select className="text-[11px] px-2 py-1.5 rounded-lg" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)', color: 'var(--ds-text-primary)' }}
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
      <div className="space-y-1">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-sm" style={{ color: 'var(--ds-text-muted)' }}>
            <Upload className="w-8 h-8 mx-auto mb-2" />
            لا توجد ملفات. اسحب وأفلت الملفات للرفع.
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-semibold" style={{ color: 'var(--ds-text-muted)' }}>
              <button onClick={toggleAll} className="w-4 h-4 rounded flex items-center justify-center" style={{ border: '1px solid var(--ds-border)' }}>
                {selected.size === filtered.length ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
              </button>
              <span className="flex-1">الاسم</span>
              <span className="w-20">التصنيف</span>
              <span className="w-16">الحجم</span>
              <span className="w-16">الحالة</span>
              <span className="w-16">التاريخ</span>
              <span className="w-10" />
            </div>
            {filtered.map(doc => {
              const ft = detectFileType(doc.file_name || doc.original_name);
              const Icon = fileIcons[ft] || FileText;
              const cat = categories.find(c => c.id === doc.category_id);
              const size = shortenSize(doc.file_size);
              return (
                <div key={doc.id} className="flex items-center gap-2 px-2 py-2 rounded-lg ds-transition-colors" style={{ background: 'var(--ds-bg-secondary)', border: '1px solid var(--ds-border)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--ds-bg-tertiary)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--ds-bg-secondary)'}>
                  <button onClick={() => toggleSelect(doc.id)} className="w-4 h-4 rounded flex items-center justify-center shrink-0" style={{ border: '1px solid var(--ds-border)' }}>
                    {selected.has(doc.id) ? <CheckSquare className="w-3 h-3" style={{ color: '#3b82f6' }} /> : <Square className="w-3 h-3" />}
                  </button>
                  <Icon className="w-4 h-4 shrink-0" style={{ color: fileColors[ft] || '#636366' }} />
                  <div className="flex-1 min-w-0">
                    {renamingId === doc.id ? (
                      <input autoFocus className="w-full text-[11px] px-1 py-0.5 rounded" style={{ background: 'var(--ds-bg-primary)', border: '1px solid var(--ds-accent)', color: 'var(--ds-text-primary)' }}
                        value={renameValue} onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(doc.id)}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(doc.id); if (e.key === 'Escape') setRenamingId(null); }} />
                    ) : (
                      <div className="text-[11px] font-medium truncate cursor-pointer" style={{ color: 'var(--ds-text-primary)' }}
                        onClick={() => setPreviewFile?.(doc)}>{doc.original_name || doc.file_name || 'بدون اسم'}</div>
                    )}
                  </div>
                  <span className="text-[9px] w-20 truncate" style={{ color: 'var(--ds-text-muted)' }}>{cat?.name_ar || cat?.name || '—'}</span>
                  <span className="text-[9px] w-16" style={{ color: 'var(--ds-text-muted)' }}>{size}</span>
                  <span className="w-16">
                    <AppBadge variant={doc.verification_status === 'verified' ? 'success' : doc.verification_status === 'rejected' ? 'danger' : 'neutral'} size="sm">
                      {doc.verification_status === 'verified' ? 'موثق' : doc.verification_status === 'rejected' ? 'مرفوض' : 'قيد الانتظار'}
                    </AppBadge>
                  </span>
                  <span className="text-[9px] w-16" style={{ color: 'var(--ds-text-muted)' }}>
                    {doc.created_at ? new Date(doc.created_at).toLocaleDateString('ar-SA') : ''}
                  </span>
                  <button className="p-1 rounded shrink-0" title="معاينة" style={{ color: 'var(--ds-text-muted)' }} onClick={() => setPreviewFile?.(doc)}>
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button className="p-1 rounded shrink-0" title="إعادة تسمية" style={{ color: 'var(--ds-text-muted)' }} onClick={() => startRename(doc)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button className="p-1 rounded shrink-0" title="تحميل" style={{ color: 'var(--ds-text-muted)' }} onClick={() => downloadDocument(doc.id)}>
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button className="p-1 rounded shrink-0" title="حذف" style={{ color: '#ef4444' }} onClick={() => removeDocument?.(doc.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
