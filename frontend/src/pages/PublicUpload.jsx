import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { UploadCloud, CheckCircle2, XCircle, Loader2, FileText, Clock, Send } from 'lucide-react';
import { getApiBase } from '../api';

const API = getApiBase();
// Large files uploaded fully in parallel just fight each other for the
// sender's own upload bandwidth -- slower AND more failure-prone than a
// small, steady concurrency cap. The rest sit queued and start automatically
// as a slot frees up (see the effect in PublicUpload below).
const MAX_CONCURRENT_UPLOADS = 2;
// A request that just hangs (no error, no load, only silence -- distinct
// from a clean network error, which already surfaces immediately) never
// resolves or rejects on its own, permanently occupying one of the 2
// concurrency slots above with nothing to show for it. This is a STALL
// timeout, not a total-duration one -- it resets on every real progress
// event, so a large file that's genuinely (if slowly) still transferring is
// never killed, only a connection that's gone completely silent.
const STALL_TIMEOUT_MS = 60 * 1000;

function formatBytes(n) {
  if (!n && n !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

// The one genuinely public page in this app -- reachable with no login at
// all via a FileFetch link (DocumentsTab.jsx -> FileFetchModal.jsx). Mounted
// as an early, shell-free route in App.jsx, the same pattern already used
// for /inbox/message/:id. Every request here carries the token, never a
// Bearer/session -- the backend (routes/fileFetch.js's public handlers)
// treats the token itself as the only credential.
// Uploads the whole file to OUR OWN server in one request (never touches
// Google directly from the browser). Replaces the old design (browser PUTs
// chunks straight to Drive's own resumable endpoint) -- confirmed live that
// a real external sender's browser failed with a generic cross-origin
// `net::ERR_FAILED` reaching googleapis.com directly, on a session a direct
// server-to-server PUT of the same bytes completed instantly. Our own
// server relays the bytes to Drive and deletes its temp copy the moment
// Drive confirms success, so the sender's browser only ever needs to reach
// our own domain -- already proven reliable.
function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let stallTimer = null;
    const resetStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => { if (!settled) xhr.abort(); }, STALL_TIMEOUT_MS);
    };
    resetStallTimer();
    xhr.upload.onprogress = (e) => {
      resetStallTimer();
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onabort = () => { settled = true; clearTimeout(stallTimer); reject(new Error('انقطع الاتصال أثناء الرفع (لا استجابة)')); };
    xhr.onload = () => {
      settled = true; clearTimeout(stallTimer);
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject({ status: xhr.status, data });
    };
    xhr.onerror = () => { settled = true; clearTimeout(stallTimer); reject(new Error('خطأ شبكة أثناء الرفع')); };
    xhr.open('POST', url);
    xhr.send(formData);
  });
}

// Attached to every thrown error below so the caller (the auto-retry loop
// in PublicUpload itself) can tell "the sender's connection hiccupped, just
// try again" apart from "retrying can never fix this" (a revoked link, a
// file over the size cap, a file rejected as belonging to the wrong case).
// Defaults to retriable -- an unclassified/unexpected error is far more
// likely to be transient than a permanent, hand-verified rejection.
function classifiedError(message, permanent = false) {
  const err = new Error(message);
  err.permanent = permanent;
  return err;
}

const PERMANENT_MESSAGE_PATTERNS = [
  /لم يعد صالحًا/, // revoked link
  /أكبر من الحد المسموح/, // over the size cap
  /غير موجود في مجلد هذه القضية/, // wrong-case Drive file rejection
  /رابط غير صالح/, // invalid token
];
function isPermanentServerMessage(msg) {
  return PERMANENT_MESSAGE_PATTERNS.some(re => re.test(msg || ''));
}

// `onPhase` marks the transition from "actively sending bytes" to "sent,
// waiting for the server to confirm and register it" -- the caller uses
// this to stop advancing the visible progress bar past 99% until this
// function actually RESOLVES, so "100%" on screen only ever means genuinely
// done, never just "done transmitting, hoping the rest goes fine."
async function uploadOneFile(token, file, onProgress, onPhase) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('original_name', file.name);

  let result;
  try {
    result = await uploadWithProgress(
      `${API}/public/upload/${token}/upload-file`, formData,
      (uploaded) => onProgress(uploaded, false),
    );
  } catch (e) {
    if (e && typeof e.status === 'number') {
      const msg = (e.data && e.data.error) || 'تعذر رفع الملف';
      throw classifiedError(msg, e.status !== 429 && e.status !== 503 && isPermanentServerMessage(msg));
    }
    throw classifiedError(e.message);
  }
  // No separate "finalizing" phase anymore -- upload and registration both
  // happen server-side within this one request/response, so reaching here
  // (result.data present, possibly .duplicate if an earlier lost-response
  // attempt already registered the same file) means genuinely done.
  onProgress(file.size, true);
}

// A dropped connection is the ROUTINE case for this page (an external
// sender, their own network, files up to 10GB), not an edge case -- retrying
// must happen on its own, with no click required. Backoff grows so a truly
// dead connection doesn't hammer the server, but caps at 1 minute so a
// brief blip doesn't leave a file waiting minutes longer than it has to.
const RETRY_BACKOFF_MS = [5000, 10000, 20000, 40000, 60000];
function backoffDelay(retryCount) {
  return RETRY_BACKOFF_MS[Math.min(retryCount, RETRY_BACKOFF_MS.length - 1)];
}

export default function PublicUpload() {
  const { token } = useParams();
  const [status, setStatus] = useState('loading'); // loading | valid | invalid
  const [caseTitle, setCaseTitle] = useState(null);
  const [caseId, setCaseId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  // state: 'queued' | 'uploading' | 'finalizing' | 'retry-pending' | 'done' | 'error'.
  // 'error' is reached ONLY for a permanent failure (revoked link, file over
  // the size cap, wrong-case rejection) -- anything else auto-retries via
  // 'retry-pending' and never needs a click. `progress` is deliberately
  // never allowed to reach 100 before `state` is actually 'done' -- see
  // onProgress below -- so "100%" on screen always means genuinely finished.
  const [files, setFiles] = useState([]);
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const retryTimers = useRef({}); // id -> timeout handle, so 'online' can cancel a scheduled wait and retry immediately

  // What THIS link already has, fetched once the token resolves -- lets
  // reopening the same link later still show prior uploads, and surfaces
  // anything left mid-transfer so the sender knows which file to re-add.
  const [completed, setCompleted] = useState([]);
  const [inProgress, setInProgress] = useState([]);
  const [statusLoading, setStatusLoading] = useState(true);

  const [note, setNote] = useState('');
  const [noteSending, setNoteSending] = useState(false);
  const [noteResult, setNoteResult] = useState(null); // {ok, message} | null

  const fetchLinkStatus = useCallback(() => {
    setStatusLoading(true);
    fetch(`${API}/public/upload/${token}/status`).then(async r => {
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setCompleted(d.completed || []); setInProgress(d.inProgress || []); }
    }).catch(() => {}).finally(() => setStatusLoading(false));
  }, [token]);

  useEffect(() => {
    fetch(`${API}/public/upload/${token}`).then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErrorMsg(d.error || 'هذا الرابط لم يعد صالحًا'); setStatus('invalid'); return; }
      setCaseTitle(d.case_title || null);
      setCaseId(d.case_id || null);
      setStatus('valid');
    }).catch(() => { setErrorMsg('تعذر التحقق من الرابط'); setStatus('invalid'); });
  }, [token]);

  useEffect(() => { if (status === 'valid') fetchLinkStatus(); }, [status, fetchLinkStatus]);

  // Files here can run up to ~10GB -- an in-flight upload absolutely must
  // not be lost to an accidental tab close, since there's no way to trigger
  // a resume without the browser still holding the File object. Covers
  // 'retry-pending' too -- a file mid-backoff is still "in flight" from the
  // sender's point of view, just waiting its turn.
  useEffect(() => {
    const anyActive = files.some(f => f.state === 'uploading' || f.state === 'finalizing' || f.state === 'retry-pending');
    if (!anyActive) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [files]);

  const scheduleRetry = useCallback((item, retryCount) => {
    const delay = backoffDelay(retryCount);
    setFiles(prev => prev.map(x => x.id === item.id ? { ...x, state: 'retry-pending', retryCount } : x));
    retryTimers.current[item.id] = setTimeout(() => {
      delete retryTimers.current[item.id];
      setFiles(prev => prev.map(x => x.id === item.id ? { ...x, state: 'queued' } : x));
    }, delay);
  }, []);

  const startUpload = useCallback((item) => {
    setFiles(prev => prev.map(x => x.id === item.id ? { ...x, state: 'uploading', error: undefined } : x));
    uploadOneFile(
      token, item.file,
      (uploaded, isFinal) => {
        // Capped below 100 until isFinal (set only once finalize truly
        // succeeds) -- reaching the last byte of the transfer is NOT the
        // same as the file actually being done; see uploadOneFile's own
        // finalize step, which is exactly what used to get silently
        // conflated with "100% = complete" and confused senders when it
        // then needed a retry.
        const pct = isFinal ? 100 : Math.min(99, Math.round((uploaded / item.size) * 100));
        setFiles(prev => prev.map(x => x.id === item.id ? { ...x, progress: pct } : x));
      },
      (phase) => setFiles(prev => prev.map(x => x.id === item.id ? { ...x, state: phase } : x)),
    ).then(() => {
      setFiles(prev => prev.map(x => x.id === item.id ? { ...x, state: 'done', progress: 100 } : x));
      fetchLinkStatus();
    }).catch((e) => {
      if (e.permanent) {
        setFiles(prev => prev.map(x => x.id === item.id ? { ...x, state: 'error', error: e.message } : x));
        return;
      }
      // Anything else -- a dropped connection, a timeout, Drive still
      // indexing, a rate limit -- auto-retries with no click needed. `item`
      // already carries the retryCount the queueing effect below picked it
      // up with, so this doesn't need to re-read the latest `files` state.
      scheduleRetry(item, (item.retryCount || 0) + 1);
    });
  }, [token, fetchLinkStatus, scheduleRetry]);

  // Starts the next queued file whenever a slot frees up -- re-runs on every
  // `files` change (a new drop, a retry becoming due, or an upload
  // finishing/failing), so the queue drains itself without manual bookkeeping.
  useEffect(() => {
    const activeCount = files.filter(f => f.state === 'uploading' || f.state === 'finalizing').length;
    if (activeCount >= MAX_CONCURRENT_UPLOADS) return;
    const next = files.find(f => f.state === 'queued');
    if (next) startUpload(next);
  }, [files, startUpload]);

  // The network coming back is the one signal worth acting on immediately
  // rather than waiting out a scheduled backoff -- every file currently
  // sitting in its wait gets bumped back into the queue right away.
  useEffect(() => {
    const handler = () => {
      Object.keys(retryTimers.current).forEach(id => {
        clearTimeout(retryTimers.current[id]);
        delete retryTimers.current[id];
      });
      setFiles(prev => prev.map(x => x.state === 'retry-pending' ? { ...x, state: 'queued' } : x));
    };
    window.addEventListener('online', handler);
    return () => window.removeEventListener('online', handler);
  }, []);

  // Cancel any pending retry timers on unmount so they don't fire (and
  // touch state) after the page/component is gone.
  useEffect(() => () => { Object.values(retryTimers.current).forEach(clearTimeout); }, []);

  const addFiles = useCallback((fileList) => {
    const items = Array.from(fileList).map(f => ({ id: `${f.name}-${f.size}-${Date.now()}-${Math.random()}`, file: f, name: f.name, size: f.size, progress: 0, state: 'queued', retryCount: 0 }));
    setFiles(prev => [...prev, ...items]);
  }, []);

  // Only reachable for a PERMANENT failure now (retriable ones already
  // auto-retry) -- lets the sender force another attempt anyway, e.g. after
  // an admin re-shares/un-revokes the link.
  const retryFile = useCallback((id) => {
    setFiles(prev => prev.map(x => x.id === id ? { ...x, state: 'queued', error: undefined } : x));
  }, []);

  const sendNote = async () => {
    const content = note.trim();
    if (!content || noteSending) return;
    setNoteSending(true);
    setNoteResult(null);
    try {
      const r = await fetch(`${API}/public/upload/${token}/note`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'تعذر إرسال الملاحظة');
      setNote('');
      setNoteResult({ ok: true, message: 'تم إرسال الملاحظة' });
    } catch (e) {
      setNoteResult({ ok: false, message: e.message });
    }
    setNoteSending(false);
  };

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
        {caseTitle && (
          <p className="text-sm mb-5" style={{ color: '#6b7280' }}>
            {caseTitle}{caseId ? <span className="font-mono"> · #{caseId}</span> : null}
          </p>
        )}

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
            {files.map(f => {
              // The bar's own color/width is the single source of truth for
              // "how much is really done" -- it never reaches full blue
              // (barPct is exactly the same capped-at-99 value the % text
              // shows) until state is truly 'done', matching the same
              // guarantee onProgress/onPhase enforce numerically. No state
              // gets a bar that LOOKS finished before it actually is.
              const barPct = f.state === 'done' ? 100 : Math.min(99, f.progress || 0);
              const barColor = f.state === 'retry-pending' ? '#f59e0b' : f.state === 'done' ? '#22c55e' : '#2563eb';
              const showBar = f.state === 'uploading' || f.state === 'finalizing' || f.state === 'retry-pending' || f.state === 'done';
              return (
                <div key={f.id} className="p-3 rounded-lg" style={{ background: '#f9fafb', border: '1px solid #e5e7eb' }}>
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 shrink-0" style={{ color: '#6b7280' }} />
                    <span className="flex-1 min-w-0 truncate text-sm">{f.name}</span>
                    {f.state === 'queued' && <span className="text-xs shrink-0" style={{ color: '#9ca3af' }}>في الانتظار...</span>}
                    {f.state === 'uploading' && <span className="text-xs shrink-0 font-mono" style={{ color: '#6b7280' }}>{f.progress}%</span>}
                    {f.state === 'finalizing' && (
                      <span className="flex items-center gap-1 text-xs shrink-0" style={{ color: '#2563eb' }}>
                        <Loader2 className="w-3 h-3 animate-spin" /> جارٍ التأكيد...
                      </span>
                    )}
                    {f.state === 'retry-pending' && (
                      <span className="flex items-center gap-1 text-xs shrink-0" style={{ color: '#b45309' }}>
                        <Clock className="w-3 h-3" /> انقطع الاتصال -- سيُعاد المحاولة تلقائيًا
                      </span>
                    )}
                    {f.state === 'done' && <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: '#22c55e' }} />}
                    {f.state === 'error' && (
                      <button onClick={() => retryFile(f.id)} className="flex items-center gap-1 text-xs shrink-0 px-2 py-1 rounded-lg" style={{ color: '#ef4444', background: '#fef2f2' }} title={f.error}>
                        <XCircle className="w-3.5 h-3.5" />Retry
                      </button>
                    )}
                  </div>
                  {showBar && (
                    <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: '#e5e7eb' }}>
                      <div className="h-full rounded-full transition-all duration-300 ease-out" style={{ width: `${barPct}%`, background: barColor }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!statusLoading && inProgress.length > 0 && (
          <div className="mt-6">
            <p className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: '#b45309' }}>
              <Clock className="w-3.5 h-3.5" /> رفع غير مكتمل — أعد اختيار نفس الملف من جهازك لاستكماله
            </p>
            <div className="space-y-1.5">
              {inProgress.map((s, i) => (
                <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg text-xs" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
                  <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: '#b45309' }} />
                  <span className="flex-1 min-w-0 truncate">{s.file_name}</span>
                  <span className="shrink-0" style={{ color: '#92400e' }}>
                    {formatBytes(s.uploaded_bytes)} / {formatBytes(s.file_size)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!statusLoading && completed.length > 0 && (
          <div className="mt-6">
            <p className="text-xs font-semibold mb-2" style={{ color: '#374151' }}>الملفات المرفوعة سابقًا عبر هذا الرابط</p>
            <div className="space-y-1.5">
              {completed.map(d => (
                <div key={d.id} className="flex items-center gap-2 p-2.5 rounded-lg text-xs" style={{ background: '#f9fafb', border: '1px solid #e5e7eb' }}>
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: '#22c55e' }} />
                  <span className="flex-1 min-w-0 truncate">{d.original_name}</span>
                  <span className="shrink-0" style={{ color: '#9ca3af' }}>{formatBytes(d.size)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 pt-5" style={{ borderTop: '1px solid #e5e7eb' }}>
          <p className="text-xs font-semibold mb-2" style={{ color: '#374151' }}>هل لديك ملاحظة تريد إيصالها لفريق العمل؟</p>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={2000}
            placeholder="اكتب ملاحظتك هنا..."
            className="w-full px-3 py-2 rounded-lg text-sm resize-none"
            style={{ background: '#f9fafb', border: '1px solid #d1d5db', color: '#111827' }} />
          <div className="flex items-center justify-between mt-2">
            {noteResult ? (
              <p className="text-xs" style={{ color: noteResult.ok ? '#22c55e' : '#ef4444' }}>{noteResult.message}</p>
            ) : <span />}
            <button onClick={sendNote} disabled={!note.trim() || noteSending}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
              style={{ background: '#2563eb', color: 'white' }}>
              <Send className="w-3.5 h-3.5" /> {noteSending ? 'جارٍ الإرسال...' : 'إرسال'}
            </button>
          </div>
        </div>
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
