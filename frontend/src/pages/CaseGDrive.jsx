import { useState, useEffect } from 'react';
import { api } from '../api';
import { Plus, Search, Link, FolderOpen, FileText, Trash2 } from 'lucide-react';

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
    await api.post('/api/gdrive/link', payload);
    setShowLinkFile(false);
    setFileForm({ file_id: '', file_name: '', web_link: '' });
    fetchFiles(selectedCaseId);
  };

  const linkFolder = async () => {
    if (!folderForm.folder_name.trim() || !folderForm.folder_id.trim()) return;
    const payload = {
      case_id: parseInt(selectedCaseId),
      folder_id: folderForm.folder_id,
      folder_name: folderForm.folder_name,
    };
    await api.post('/api/gdrive/folder', payload);
    setShowLinkFolder(false);
    setFolderForm({ folder_id: '', folder_name: '' });
    fetchFiles(selectedCaseId);
  };

  const formatFileSize = (bytes) => {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-[#D4A843] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Google Drive</h1>
      </div>

      {/* Case Selector */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <select
          value={selectedCaseId}
          onChange={e => setSelectedCaseId(e.target.value)}
          className="w-full pr-10 pl-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white focus:outline-none focus:border-[#D4A843] transition-all appearance-none cursor-pointer"
        >
          <option value="">اختر قضية...</option>
          {cases.map(c => (
            <option key={c.id} value={c.id}>{c.title} {c.client_name ? `- ${c.client_name}` : ''}</option>
          ))}
        </select>
      </div>

      {!selectedCaseId ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl">
          <FolderOpen className="w-12 h-12 text-gray-600 mb-3" />
          <h3 className="text-base font-medium text-gray-400 mb-1">اختر قضية</h3>
          <p className="text-sm text-gray-600">يرجى اختيار قضية لعرض ملفات Google Drive المرتبطة</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">{files.length} ملف/مجلد</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowLinkFile(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm bg-gradient-to-r from-[#D4A843] to-[#e4b84a] text-[#0A0A0F] hover:shadow-lg hover:shadow-[#D4A843]/30 active:scale-[0.97] transition-all">
                <FileText className="w-4 h-4" />
                ربط ملف
              </button>
              <button onClick={() => setShowLinkFolder(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm bg-transparent border border-[#D4A843] text-[#D4A843] hover:bg-[#D4A843]/10 transition-all">
                <FolderOpen className="w-4 h-4" />
                ربط مجلد
              </button>
            </div>
          </div>

          {/* Link File Form */}
          {showLinkFile && (
            <div className="bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl p-5 animate-slideUp">
              <h2 className="text-sm font-semibold text-[#D4A843] mb-4">ربط ملف من Google Drive</h2>
              <div className="space-y-3">
                <input value={fileForm.file_name} onChange={e => setFileForm({...fileForm, file_name: e.target.value})} placeholder="اسم الملف" className="w-full px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white placeholder-gray-500 focus:outline-none focus:border-[#D4A843] transition-all" />
                <input value={fileForm.web_link} onChange={e => setFileForm({...fileForm, web_link: e.target.value})} placeholder="رابط الملف" className="w-full px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white placeholder-gray-500 focus:outline-none focus:border-[#D4A843] transition-all" />
                <input value={fileForm.file_id} onChange={e => setFileForm({...fileForm, file_id: e.target.value})} placeholder="معرف الملف (اختياري)" className="w-full px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white placeholder-gray-500 focus:outline-none focus:border-[#D4A843] transition-all" />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowLinkFile(false)} className="px-4 py-2 rounded-xl font-medium text-sm bg-transparent border border-[#1F1F2A] text-gray-300 hover:text-white hover:bg-[#1a1a2e] transition-all">إلغاء</button>
                  <button onClick={linkFile} className="px-5 py-2 rounded-xl font-semibold text-sm bg-gradient-to-r from-[#D4A843] to-[#e4b84a] text-[#0A0A0F] hover:shadow-lg transition-all">ربط</button>
                </div>
              </div>
            </div>
          )}

          {/* Link Folder Form */}
          {showLinkFolder && (
            <div className="bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl p-5 animate-slideUp">
              <h2 className="text-sm font-semibold text-[#D4A843] mb-4">ربط مجلد من Google Drive</h2>
              <div className="space-y-3">
                <input value={folderForm.folder_name} onChange={e => setFolderForm({...folderForm, folder_name: e.target.value})} placeholder="اسم المجلد" className="w-full px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white placeholder-gray-500 focus:outline-none focus:border-[#D4A843] transition-all" />
                <input value={folderForm.folder_id} onChange={e => setFolderForm({...folderForm, folder_id: e.target.value})} placeholder="معرف المجلد" className="w-full px-4 py-3 rounded-xl bg-[#13131A] border border-[#1F1F2A] text-white placeholder-gray-500 focus:outline-none focus:border-[#D4A843] transition-all" />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowLinkFolder(false)} className="px-4 py-2 rounded-xl font-medium text-sm bg-transparent border border-[#1F1F2A] text-gray-300 hover:text-white hover:bg-[#1a1a2e] transition-all">إلغاء</button>
                  <button onClick={linkFolder} className="px-5 py-2 rounded-xl font-semibold text-sm bg-gradient-to-r from-[#D4A843] to-[#e4b84a] text-[#0A0A0F] hover:shadow-lg transition-all">ربط</button>
                </div>
              </div>
            </div>
          )}

          {/* Files List */}
          {files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl">
              <FolderOpen className="w-12 h-12 text-gray-600 mb-3" />
              <h3 className="text-base font-medium text-gray-400 mb-1">لا توجد ملفات مرتبطة</h3>
              <p className="text-sm text-gray-600 mb-4">لم يتم ربط أي ملفات أو مجلدات من Google Drive لهذه القضية</p>
              <div className="flex gap-2">
                <button onClick={() => setShowLinkFile(true)} className="px-5 py-2.5 rounded-xl font-semibold text-sm bg-gradient-to-r from-[#D4A843] to-[#e4b84a] text-[#0A0A0F] transition-all">ربط ملف</button>
                <button onClick={() => setShowLinkFolder(true)} className="px-5 py-2.5 rounded-xl font-semibold text-sm bg-transparent border border-[#D4A843] text-[#D4A843] transition-all">ربط مجلد</button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {files.map(f => (
                <div key={f.id} className="bg-[rgba(17,17,34,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.06)] rounded-2xl p-4 hover:border-[#D4A84330] transition-all duration-300">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-[#1a1a2e] border border-[#1F1F2A] flex items-center justify-center shrink-0">
                        {f.folder_id ? (
                          <FolderOpen className="w-4 h-4 text-[#D4A843]" />
                        ) : (
                          <FileText className="w-4 h-4 text-[#3B82F6]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-semibold text-white">{f.original_name || f.file_name || f.folder_name}</h3>
                          {f.folder_id && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#D4A843]/10 text-[#D4A843] border border-[#D4A843]/20">📁 مجلد</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          {f.size != null && !f.folder_id && (
                            <span className="text-[11px] text-gray-500">💾 {formatFileSize(f.size)}</span>
                          )}
                          {f.created_at && (
                            <span className="text-[11px] text-gray-600">📅 {new Date(f.created_at).toLocaleDateString('ar-EG')}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {f.drive_url && (
                        <a href={f.drive_url} target="_blank" rel="noopener noreferrer" className="p-2 rounded-lg text-gray-500 hover:text-[#D4A843] hover:bg-[#D4A843]/10 transition-all" title="فتح في Drive">
                          <Link className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
