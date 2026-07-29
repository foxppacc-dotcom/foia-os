import { useState, useEffect } from 'react';
import { api } from '../api';
import { Plus, Search, Link, FolderOpen, FileText, Trash2 } from 'lucide-react';
import AppButton from '../components/ds/AppButton';
import AppCard from '../components/ds/AppCard';
import AppInput from '../components/ds/AppInput';

export default function CaseGDrive() {
  const [cases, setCases] = useState([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showLinkFile, setShowLinkFile] = useState(false);
  const [showLinkFolder, setShowLinkFolder] = useState(false);
  const [fileForm, setFileForm] = useState({ file_id: '', file_name: '', web_link: '' });
  const [folderForm, setFolderForm] = useState({ folder_id: '', folder_name: '' });

  useEffect(() => {
    api.getCases().then(d => {
      setCases(Array.isArray(d) ? d : d.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const fetchFiles = (caseId) => {
    if (!caseId) { setFiles([]); return; }
    api.get(`/api/gdrive/case/${caseId}`)
      .then(d => setFiles(Array.isArray(d) ? d : d.data || []))
      .catch(() => setFiles([]));
  };

  useEffect(() => {
    if (selectedCaseId) fetchFiles(selectedCaseId);
    else setFiles([]);
  }, [selectedCaseId]);

  const linkFile = async () => {
    if (!fileForm.file_name.trim() || !fileForm.web_link.trim()) return;
    const payload = {
      case_id: parseInt(selectedCaseId),
      file_id: fileForm.file_id || null,
      file_name: fileForm.file_name,
      web_link: fileForm.web_link,
    };
    try { const res = await api.post('/api/gdrive/link', payload); if (res.success) { setShowLinkFile(false); setFileForm({ file_id: '', file_name: '', web_link: '' }); fetchFiles(selectedCaseId); } } catch {}
  };

  const linkFolder = async () => {
    if (!folderForm.folder_id.trim() || !folderForm.folder_name.trim()) return;
    try {
      const res = await api.post('/api/gdrive/folder', {
        case_id: parseInt(selectedCaseId), folder_id: folderForm.folder_id, folder_name: folderForm.folder_name
      });
      if (res.success) { setShowLinkFolder(false); setFolderForm({ folder_id: '', folder_name: '' }); fetchFiles(selectedCaseId); }
    } catch {}
  };

  const deleteItem = async (id, type) => {
    try { await api.del(`/api/gdrive/${type}/${id}`); fetchFiles(selectedCaseId); } catch {}
  };

  const inputStyle = {
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Google Drive</h1>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="skeleton h-12 rounded-xl" />)}
        </div>
      ) : (
        <>
          {/* Case Selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={selectedCaseId}
              onChange={e => setSelectedCaseId(e.target.value)}
              className="px-4 py-2.5 rounded-xl text-sm min-w-[200px] transition-all"
              style={inputStyle}>
              <option value="">اختر قضية...</option>
              {cases.map(c => <option key={c.id} value={c.id}>#{c.id} {c.title}</option>)}
            </select>
            {selectedCaseId && (
              <div className="flex gap-2">
                <AppButton size="sm" variant="secondary" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowLinkFile(true)}>
                  ربط ملف
                </AppButton>
                <AppButton size="sm" variant="secondary" icon={<FolderOpen className="w-3.5 h-3.5" />} onClick={() => setShowLinkFolder(true)}>
                  ربط مجلد
                </AppButton>
              </div>
            )}
          </div>

          {/* Files List */}
          {selectedCaseId && (
            <AppCard title="الملفات المرتبطة">
              {files.length > 0 ? (
                <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {files.map(f => (
                    <div key={f.id} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
                        <div className="min-w-0">
                          <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{f.file_name}</p>
                          {f.web_link && (
                            <a href={f.web_link} target="_blank" rel="noopener noreferrer" className="text-[10px] hover:underline"
                              style={{ color: 'var(--accent)' }}>
                              فتح في Drive
                            </a>
                          )}
                        </div>
                      </div>
                      <button onClick={() => deleteItem(f.id, f.folder_id ? 'folder' : 'file')}
                        className="p-1.5 rounded-lg ds-transition-colors" style={{ color: 'var(--text-muted)' }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center py-8">
                  <FolderOpen className="w-10 h-10 mb-2" style={{ color: 'var(--text-muted)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>لا توجد ملفات مرتبطة</p>
                </div>
              )}
            </AppCard>
          )}

          {/* Link File Dialog */}
          {showLinkFile && (
            <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--bg-overlay)' }}>
              <div className="rounded-2xl p-6 w-full max-w-md mx-4 animate-scaleIn" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>ربط ملف</h2>
                <div className="space-y-3">
                  <input placeholder="معرف الملف (اختياري)" value={fileForm.file_id} onChange={e => setFileForm({...fileForm, file_id: e.target.value})}
                    className="w-full px-3 py-2.5 rounded-xl text-sm transition-all" style={inputStyle} />
                  <input placeholder="اسم الملف" value={fileForm.file_name} onChange={e => setFileForm({...fileForm, file_name: e.target.value})}
                    className="w-full px-3 py-2.5 rounded-xl text-sm transition-all" style={inputStyle} />
                  <input placeholder="رابط الملف" value={fileForm.web_link} onChange={e => setFileForm({...fileForm, web_link: e.target.value})}
                    className="w-full px-3 py-2.5 rounded-xl text-sm transition-all" style={inputStyle} />
                  <div className="flex gap-2 justify-end mt-4">
                    <AppButton variant="ghost" onClick={() => setShowLinkFile(false)}>إلغاء</AppButton>
                    <AppButton onClick={linkFile} disabled={!fileForm.file_name.trim() || !fileForm.web_link.trim()}>ربط</AppButton>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Link Folder Dialog */}
          {showLinkFolder && (
            <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--bg-overlay)' }}>
              <div className="rounded-2xl p-6 w-full max-w-md mx-4 animate-scaleIn" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>ربط مجلد</h2>
                <div className="space-y-3">
                  <input placeholder="معرف المجلد" value={folderForm.folder_id} onChange={e => setFolderForm({...folderForm, folder_id: e.target.value})}
                    className="w-full px-3 py-2.5 rounded-xl text-sm transition-all" style={inputStyle} />
                  <input placeholder="اسم المجلد" value={folderForm.folder_name} onChange={e => setFolderForm({...folderForm, folder_name: e.target.value})}
                    className="w-full px-3 py-2.5 rounded-xl text-sm transition-all" style={inputStyle} />
                  <div className="flex gap-2 justify-end mt-4">
                    <AppButton variant="ghost" onClick={() => setShowLinkFolder(false)}>إلغاء</AppButton>
                    <AppButton onClick={linkFolder} disabled={!folderForm.folder_id.trim() || !folderForm.folder_name.trim()}>ربط</AppButton>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
