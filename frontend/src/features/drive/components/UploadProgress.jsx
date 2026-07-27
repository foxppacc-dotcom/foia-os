import { Pause, Play, X, RotateCw, Trash2 } from 'lucide-react';
import { UPLOAD_STATUS, UPLOAD_STATUS_LABELS, UPLOAD_STATUS_COLORS } from '../constants/upload';

export default function UploadProgress({ queue, onPause, onResume, onCancel, onRetry, onClear }) {
  if (!queue || queue.length === 0) return null;

  const active = queue.filter(i => i.status === UPLOAD_STATUS.UPLOADING || i.status === UPLOAD_STATUS.QUEUED);
  const completed = queue.filter(i => i.status === UPLOAD_STATUS.COMPLETED).length;
  const failed = queue.filter(i => i.status === UPLOAD_STATUS.FAILED).length;

  return (
    <div className="rounded-2xl border p-4 mb-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          جاري الرفع ({active.length} نشط / {completed} تم / {failed} فشل)
        </h4>
        <div className="flex gap-1">
          {onClear && <button onClick={onClear} className="p-1.5 rounded-lg text-xs" style={{ color: 'var(--text-muted)' }} title="مسح المكتمل"><Trash2 className="w-3.5 h-3.5" /></button>}
        </div>
      </div>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {queue.map(item => {
          const label = UPLOAD_STATUS_LABELS[item.status] || item.status;
          const color = UPLOAD_STATUS_COLORS[item.status] || '#6B7280';
          const isUploading = item.status === UPLOAD_STATUS.UPLOADING;
          const isPaused = item.status === UPLOAD_STATUS.PAUSED;
          const isFailed = item.status === UPLOAD_STATUS.FAILED;
          const isCompleted = item.status === UPLOAD_STATUS.COMPLETED;
          const speed = item.speed > 0 ? formatSpeed(item.speed) : '';
          const eta = item.eta > 0 ? formatDuration(item.eta) : '';
          return (
            <div key={item.id} className="p-2.5 rounded-xl" style={{ background: 'var(--bg-tertiary)' }}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-medium flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                  {item.file.name}
                </span>
                <span className="text-[11px] shrink-0" style={{ color }}>{label}</span>
                <div className="flex gap-0.5 shrink-0">
                  {isUploading && onPause && <button onClick={() => onPause(item.id)} className="p-1 rounded" style={{ color: 'var(--text-muted)' }}><Pause className="w-3 h-3" /></button>}
                  {isPaused && onResume && <button onClick={() => onResume(item.id)} className="p-1 rounded" style={{ color: 'var(--accent)' }}><Play className="w-3 h-3" /></button>}
                  {isFailed && onRetry && <button onClick={() => onRetry(item.id)} className="p-1 rounded" style={{ color: 'var(--accent)' }}><RotateCw className="w-3 h-3" /></button>}
                  {!isCompleted && onCancel && <button onClick={() => onCancel(item.id)} className="p-1 rounded" style={{ color: 'var(--danger)' }}><X className="w-3 h-3" /></button>}
                </div>
              </div>
              <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                <div className="h-full rounded-full transition-all duration-300" style={{ width: item.progress + '%', background: color }} />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {formatBytes(item.uploadedBytes)} / {formatBytes(item.totalBytes)}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {speed ? speed + (eta ? ' · ' + eta : '') : ''}
                  {item.error ? item.error.substring(0, 30) : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatBytes(b) {
  if (!b || b === 0) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function formatSpeed(bps) {
  if (bps < 1024) return Math.round(bps) + ' B/s';
  if (bps < 1048576) return (bps / 1024).toFixed(1) + ' KB/s';
  return (bps / 1048576).toFixed(1) + ' MB/s';
}

function formatDuration(sec) {
  if (sec < 60) return Math.round(sec) + 's';
  if (sec < 3600) return Math.round(sec / 60) + 'm';
  return Math.round(sec / 3600) + 'h';
}
