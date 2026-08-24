import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { UploadCloud, CheckCircle2, XCircle, Loader2, FileText } from 'lucide-react';
import { getApiBase } from '../api';

const API = getApiBase();
const CHUNK_SIZE = 5 * 1024 * 1024;
const MAX_CHUNK_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// The one genuinely public page in this app -- reachable with no login at
// all via a FileFetch link (DocumentsTab.jsx -> FileFetchModal.jsx). Mounted
// as an early, shell-free route in App.jsx, the same pattern already used
// for /inbox/message/:id. Every request here carries the token, never a
// Bearer/session -- the backend (routes/fileFetch.js's public handlers)
// treats the token itself as the only credential.
function putChunk(sessionUrl, chunk, start, end, totalSize, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let bytesSent = 0;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) { bytesSent = e.loaded; onProgress(start + e.loaded); } };
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 201) { try { resolve(JSON.parse(xhr.responseText)); } catch { resolve(null); } }
      else if (xhr.status === 308) resolve(null);
      else reject(new Error(`فشل رفع جزء من الملف: HTTP ${xhr.status}`));
    };
    // Confirmed live: Google's resumable endpoint doesn't send an
    // Access-Control-Allow-Origin header on the FINAL chunk's response (the
    // one carrying the file's metadata, unlike an intermediate 308) -- the
    // bytes land in Drive successfully (upload progress genuinely reaches
    // 100%), but the browser blocks the response from ever reaching JS and
    // fires onerror instead of onload. Treating every onerror as a real
    // failure meant the upload retried, resent the same bytes into a
    // session Drive had already closed out, got a real error THAT time, and
    // permanently failed -- exactly the "100% -> drops -> 100% -> fails"
    // symptom reported. If every byte of THIS chunk was actually sent, the
    // upload itself didn't fail -- resolve like an unreadable-but-successful
    // response (same as a 308) and let finalize's name+size fallback lookup
    // resolve the real Drive file, instead of resending bytes Google already has.
    xhr.onerror = () => {
      if (bytesSent >= (end - start)) resolve(null);
      else reject(new Error('خطأ شبكة أثناء الرفع'));
    };
    xhr.open('PUT', sessionUrl);
    xhr.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${totalSize}`);
    xhr.send(chunk);
  });
}

async function uploadOneFile(token, file, onProgress) {
  const sessionRes = await fetch(`${API}/public/upload/${token}/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_name: file.name, mime_type: file.type || 'application/octet-stream', size: file.size }),
  });
  const sessionData = await sessionRes.json().catch(() => ({}));
  if (!sessionRes.ok) throw new Error(sessionData.error || 'تعذر بدء رفع الملف');

  let driveFileId = sessionData.drive_file_id || null;
  if (!driveFileId && !sessionData.completed) {
    const sessionUrl = sessionData.session_url || sessionData.sessionUrl;
    if (!sessionUrl) throw new Error('تعذر بدء جلسة الرفع');
    // A 10GB transfer over a connection we don't control WILL drop at least
    // once -- the backend already resumes the SAME Drive session on a
    // retry (drive_upload_sessions), but that's wasted unless the client
    // also starts from the EXACT byte Drive confirms it has. Google's
    // protocol expects the next Content-Range to start precisely at that
    // offset -- rounding down to a chunk boundary (re-sending a slice of
    // already-committed bytes) risks Drive rejecting the range outright,
    // since a drop can happen mid-chunk. cursor tracks the real byte
    // position, independent of any fixed chunk grid.
    let cursor = sessionData.resume_offset || 0;
    if (cursor > 0) onProgress(cursor);
    while (cursor < file.size) {
      const end = Math.min(cursor + CHUNK_SIZE, file.size);
      let attempt = 0;
      while (true) {
        try {
          const result = await putChunk(sessionUrl, file.slice(cursor, end), cursor, end, file.size, onProgress);
          if (result?.id) driveFileId = result.id;
          cursor = end;
          break;
        } catch (e) {
          attempt++;
          if (attempt > MAX_CHUNK_RETRIES) throw e;
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
        }
      }
    }
  }

  const finalizeRes = await fetch(`${API}/public/upload/${token}/finalize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drive_file_id: driveFileId, original_name: file.name, size: file.size }),
  });
  const finalizeData = await finalizeRes.json().catch(() => ({}));
  if (!finalizeRes.ok) throw new Error(finalizeData.error || 'تعذر تسجيل الملف بعد الرفع');
}

export default function PublicUpload() {
  const { token } = useParams();
  const [status, setStatus] = useState('loading'); // loading | valid | invalid
  const [caseTitle, setCaseTitle] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [files, setFiles] = useState([]); // { id, name, size, progress, state: 'pending'|'uploading'|'done'|'error', error? }
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    fetch(`${API}/public/upload/${token}`).then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErrorMsg(d.error || 'هذا الرابط لم يعد صالحًا'); setStatus('invalid'); return; }
      setCaseTitle(d.case_title || null);
      setStatus('valid');
    }).catch(() => { setErrorMsg('تعذر التحقق من الرابط'); setStatus('invalid'); });
  }, [token]);

  // Files here can run up to ~10GB -- an in-flight upload absolutely must
  // not be lost to an accidental tab close, since (unlike the retry button
  // below) there's no way to trigger a resume without the browser still
  // holding the File object.
  useEffect(() => {
    const anyUploading = files.some(f => f.state === 'uploading');
    if (!anyUploading) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [files]);

  const startUpload = useCallback((item) => {
    setFiles(prev => prev.map(x => x.id === item.id ? { ...x, state: 'uploading', error: undefined } : x));
    uploadOneFile(token, item.file, (uploaded) => {
      setFiles(prev => prev.map(x => x.id === item.id ? { ...x, progress: Math.round((uploaded / item.size) * 100) } : x));
    }).then(() => {
      setFiles(prev => prev.map(x => x.id === item.id ? { ...x, state: 'done', progress: 100 } : x));
    }).catch((e) => {
      setFiles(prev => prev.map(x => x.id === item.id ? { ...x, state: 'error', error: e.message } : x));
    });
  }, [token]);

  const addFiles = useCallback((fileList) => {
    const items = Array.from(fileList).map(f => ({ id: `${f.name}-${f.size}-${Date.now()}-${Math.random()}`, file: f, name: f.name, size: f.size, progress: 0, state: 'pending' }));
    setFiles(prev => [...prev, ...items]);
    items.forEach(startUpload);
  }, [startUpload]);

  const onDrop = (e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); };

  if (status === 'loading') {
    return <CenteredPage><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#2563eb' }} /></CenteredPage>;
  }
  if (status === 'invalid') {
    return (
      <CenteredPage>
        <XCircle className="w-10 h-10 mb-3" style={{ color: '#ef4444' }} />
        <p className="text-base font-semibold mb-1">هذا الرابط لم يعد صالحًا</p>
        <p className="text-sm" style={{ color: '#6b7280' }}>{errorMsg}</p>
      </CenteredPage>
    );
  }

  return (
    <CenteredPage wide>
      <div className="w-full max-w-lg">
        <h1 className="text-lg font-bold mb-1">Upload the files to our drive.</h1>
        {caseTitle && <p className="text-sm mb-5" style={{ color: '#6b7280' }}>{caseTitle}</p>}

        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="p-8 rounded-xl border-2 border-dashed cursor-pointer text-center transition-colors"
          style={{ background: dragging ? '#eff6ff' : '#f9fafb', borderColor: dragging ? '#2563eb' : '#d1d5db' }}
        >
          <UploadCloud className="w-8 h-8 mx-auto mb-2" style={{ color: '#6b7280' }} />
          <p className="text-sm font-medium">Drag files here or click to select</p>
          <input ref={inputRef} type="file" multiple className="hidden"
            onChange={e => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }} />
        </div>

        {files.length > 0 && (
          <div className="mt-4 space-y-2">
            {files.map(f => (
              <div key={f.id} className="flex items-center gap-2 p-3 rounded-lg" style={{ background: '#f9fafb', border: '1px solid #e5e7eb' }}>
                <FileText className="w-4 h-4 shrink-0" style={{ color: '#6b7280' }} />
                <span className="flex-1 min-w-0 truncate text-sm">{f.name}</span>
                {f.state === 'uploading' && <span className="text-xs shrink-0" style={{ color: '#6b7280' }}>{f.progress}%</span>}
                {f.state === 'done' && <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: '#22c55e' }} />}
                {f.state === 'error' && (
                  <button onClick={() => startUpload(f)} className="flex items-center gap-1 text-xs shrink-0 px-2 py-1 rounded-lg" style={{ color: '#ef4444', background: '#fef2f2' }} title={f.error}>
                    <XCircle className="w-3.5 h-3.5" />Retry
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </CenteredPage>
  );
}

function CenteredPage({ children, wide }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: '#ffffff', color: '#111827' }}>
      <div className={wide ? 'w-full flex justify-center' : 'flex flex-col items-center text-center'}>{children}</div>
    </div>
  );
}
