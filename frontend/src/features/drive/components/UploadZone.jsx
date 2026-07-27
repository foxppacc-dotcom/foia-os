import { useRef, useState, useCallback } from 'react';
import { Upload, File } from 'lucide-react';
import { useUploadQueue } from '../hooks/useUploadQueue';
import UploadProgress from './UploadProgress';

export default function UploadZone({ caseId, folderId }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const { queue, stats, enqueue, pause, resume, cancel, retry, clearCompleted } = useUploadQueue();

  const handleFiles = useCallback((files) => {
    enqueue(Array.from(files), caseId, { folderId });
  }, [caseId, enqueue, folderId]);

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className="p-6 rounded-xl border-2 border-dashed cursor-pointer transition-all text-center"
        style={{
          background: dragging ? 'var(--accent-subtle)' : 'var(--bg-tertiary)',
          borderColor: dragging ? 'var(--accent)' : 'var(--border-strong)',
        }}
      >
        <Upload className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>اسحب الملفات هنا أو اضغط للاختيار</p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>حتى 10 جيجابايت للملف الواحد</p>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }} />
      </div>
      {stats.total > 0 && (
        <UploadProgress
          queue={queue}
          onPause={pause}
          onResume={resume}
          onCancel={cancel}
          onRetry={retry}
          onClear={clearCompleted}
        />
      )}
    </div>
  );
}
