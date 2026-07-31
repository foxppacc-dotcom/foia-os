import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Plus, FolderOpen, FileText, Trash2, CloudCog, CheckCircle2, XCircle, Link2Off } from 'lucide-react';
import AppButton from '../components/ds/AppButton';
import AppCard from '../components/ds/AppCard';

export default function CaseGDrive() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState({ configured: false, connected: false, email: null });
  const [statusLoading, setStatusLoading] = useState(true);
  const [connectMsg, setConnectMsg] = useState(null);
  const [cases, setCases] = useState([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [files, setFiles] = useState([]);
  const [folder, setFolder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showLinkFile, setShowLinkFile] = useState(false);
  const [showLinkFolder, setShowLinkFolder] = useState(false);
  const [fileForm, setFileForm] = useState({ file_id: '', file_name: '', web_link: '' });
  const [folderForm, setFolderForm] = useState({ folder_id: '', folder_name: '' });

  useEffect(() => {
    const result = searchParams.get('gdrive');
    if (result === 'success') setConnectMsg({ ok: true, text: '✅ تم ربط حساب جوجل درايف بنجاح' });
    else if (result === 'error') setConnectMsg({ ok: false, text: '❌ فشل الربط: ' + (searchParams.get('msg') || 'خطأ غير معروف') });
    if (result) { searchParams.delete('gdrive'); searchParams.delete('msg'); setSearchParams(searchParams, { replace: true }); }
  }, []);

  const fetchStatus = () => {
    setStatusLoading(true);
    api.get('/gdrive/status').then(setStatus).catch(() => {}).finally(() => setStatusLoading(false));
  };
  useEffect(() => { fetchStatus(); }, []);

  useEffect(() => {
    api.getCases().then(d => {
      setCases(Array.isArray(d) ? d : d.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const fetchFiles = (caseId) => {
    if (!caseId) { setFiles([]); setFolder(null); return; }
    api.get(`/gdrive/case/${caseId}`)
      .then(d => { setFiles(d.data || []); setFolder(d.folder || null); })
      .catch(() => { setFiles([]); setFolder(null); });
  };

  useEffect(() => {
    if (selectedCaseId) fetchFiles(selectedCaseId);
    else { setFiles([]); setFolder(null); }
  }, [selectedCaseId]);

  const connectDrive = async () => {
    try {
      const { url } = await api.get('/gdrive/auth-url');
      window.location.href = url; // real browser navigation — OAuth consent can't happen via fetch
    } catch (e) { setConnectMsg({ ok: false, text: '❌ ' + e.message }); }
  };

  const disconnectDrive = async () => {
    if (!confirm('قطع الاتصال بحساب جوجل درايف الحالي؟')) return;
    try { await api.post('/gdrive/disconnect', {}); fetchStatus(); } catch {}
  };

  const linkFile = async () => {
    if (!fileForm.file_name.trim() || !fileForm.web_link.trim()) return;
    const payload = {
      case_id: parseInt(selectedCaseId),
      file_id: fileForm.file_id || `manual-${Date.now()}`,
      file_name: fileForm.file_name,
      web_link: fileForm.web_link,
    };
    try { const res = await api.post('/gdrive/link', payload); if (res.success) { setShowLinkFile(false); setFileForm({ file_id: '', file_name: '', web_link: '' }); fetchFiles(selectedCaseId); } } catch {}
  };

  const linkFolder = async () => {
    if (!folderForm.folder_id.trim() || !folderForm.folder_name.trim()) return;
    try {
      const res = await api.post('/gdrive/folder', {
        case_id: parseInt(selectedCaseId), folder_id: folderForm.folder_id, folder_name: folderForm.folder_name
      });
      if (res.success) { setShowLinkFolder(false); setFolderForm({ folder_id: '', folder_name: '' }); fetchFiles(selectedCaseId); }
    } catch {}
  };

  const deleteFile = async (id) => {
    try { await api.delete(`/gdrive/file/${id}`); fetchFiles(selectedCaseId); } catch {}
  };

  const unlinkFolder = async () => {
    if (!confirm('إزالة ربط المجلد من هذه القضية؟')) return;
    try { await api.delete(`/gdrive/folder/${selectedCaseId}`); fetchFiles(selectedCaseId); } catch {}
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

      {connectMsg && (
        <div className="flex items-center gap-2 p-3 rounded-xl text-sm" style={{ background: connectMsg.ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: connectMsg.ok ? 'var(--success)' : 'var(--danger)' }}>
          {connectMsg.text}
        </div>
      )}

      {/* Connection status */}
      <AppCard>
        {statusLoading ? (
          <div className="skeleton h-8 rounded-lg" />
        ) : !status.configured ? (
          <div className="flex items-center gap-3">
            <CloudCog className="w-5 h-5 shrink-0" style={{ color: 'var(--text-muted)' }} />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>لم يتم إعداد التكامل بعد</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>يحتاج المدير لإضافة GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI / GOOGLE_DRIVE_ROOT_FOLDER في متغيرات بيئة الخادم أولاً.</p>
            </div>
          </div>
        ) : status.connected ? (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: 'var(--success)' }} />
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>متصل بحساب جوجل درايف</p>
                {status.email && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{status.email}</p>}
              </div>
            </div>
            <AppButton size="sm" variant="secondary" icon={<Link2Off className="w-3.5 h-3.5" />} onClick={disconnectDrive}>قطع الاتصال</AppButton>
          </div>
        ) : (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <XCircle className="w-5 h-5 shrink-0" style={{ color: 'var(--warning)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>غير متصل بجوجل درايف</p>
            </div>
            <AppButton size="sm" icon={<CloudCog className="w-3.5 h-3.5" />} onClick={connectDrive}>ربط حساب جوجل درايف</AppButton>
          </div>
        )}
      </AppCard>

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
                {!folder && (
                  <AppButton size="sm" variant="secondary" icon={<FolderOpen className="w-3.5 h-3.5" />} onClick={() => setShowLinkFolder(true)}>
                    ربط مجلد
                  </AppButton>
                )}
              </div>
            )}
          </div>

          {selectedCaseId && folder && (
            <div className="flex items-center justify-between p-3 rounded-xl text-sm" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
              <span className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <FolderOpen className="w-4 h-4" style={{ color: 'var(--accent)' }} /> مجلد مرتبط: {folder.folderId}
              </span>
              <button onClick={unlinkFolder} className="p-1.5 rounded-lg ds-transition-colors" style={{ color: 'var(--text-muted)' }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

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
                          <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{f.original_name || f.filename}</p>
                          {f.drive_url && (
                            <a href={f.drive_url} target="_blank" rel="noopener noreferrer" className="text-[10px] hover:underline"
                              style={{ color: 'var(--accent)' }}>
                              فتح في Drive
                            </a>
                          )}
                        </div>
                      </div>
                      <button onClick={() => deleteFile(f.id)}
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
