import { X, Download, ExternalLink } from 'lucide-react';
import { useCaseContext } from '../context/CaseContext';

function detectKind(mimeType = '', name = '') {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (mimeType.startsWith('image/') || ['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) return 'image';
  if (mimeType.startsWith('video/') || ['mp4','mov','avi','mkv','webm'].includes(ext)) return 'video';
  if (mimeType.startsWith('audio/') || ['mp3','wav','ogg','flac'].includes(ext)) return 'audio';
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf';
  return 'other';
}

export default function FilePreview() {
  const { previewFile: file, setPreviewFile } = useCaseContext();
  const onClose = () => setPreviewFile(null);
  if (!file) return null;

  const name = file.original_name || file.filename || file.name || 'بدون اسم';
  const isDrive = file.storage_provider === 'google_drive' && file.drive_file_id;
  // Drive's dedicated embeddable preview endpoint -- unlike webViewLink
  // ("/view"), "/preview" renders inline in an iframe for PDFs, Office
  // docs, images and video alike, so Drive-backed files never need a
  // separate branch per mime type the way legacy local/Supabase ones do.
  const driveEmbedUrl = isDrive ? `https://drive.google.com/file/d/${file.drive_file_id}/preview` : null;
  const openUrl = file.url || file.file_path || (file.isUrl ? file.path : file.path ? '/' + file.path : null);
  const kind = detectKind(file.mime_type, name);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fadeIn" style={{ background: 'var(--bg-overlay)' }} onClick={onClose}>
      <div className="relative max-w-3xl max-h-[90vh] w-full animate-scaleIn" onClick={e => e.stopPropagation()}>
        <button onClick={onClose}
          className="absolute -top-3 -left-3 w-8 h-8 rounded-full flex items-center justify-center z-10 shadow-lg"
          style={{ background: 'var(--danger)', color: 'white' }}><X className="w-4 h-4" /></button>
        <div className="rounded-2xl overflow-hidden bg-black" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
          {isDrive ? (
            <div className="w-full h-[80vh] bg-white">
              <iframe src={driveEmbedUrl} title={name} className="w-full h-full border-0" allow="autoplay" />
            </div>
          ) : kind === 'image' ? (
            <img src={openUrl} alt={name} className="max-w-full max-h-[80vh] mx-auto" style={{ objectFit: 'contain' }} />
          ) : kind === 'video' ? (
            <video controls className="w-full max-h-[80vh]" src={openUrl} />
          ) : kind === 'audio' ? (
            <div className="flex flex-col items-center justify-center p-12">
              <p className="text-white text-sm mb-4">{name}</p>
              <audio controls src={openUrl} className="w-full max-w-md" />
            </div>
          ) : kind === 'pdf' ? (
            <div className="w-full h-[80vh] bg-white">
              <iframe src={openUrl} title={name} className="w-full h-full border-0" />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 p-12">
              <p className="text-white text-sm">{name}</p>
              {openUrl && (
                <>
                  <a href={openUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm" style={{ background: 'var(--accent)', color: 'var(--text-inverse)' }}>
                    <Download className="w-4 h-4" /> تحميل الملف
                  </a>
                  <button onClick={() => window.open(openUrl, '_blank')}
                    className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm" style={{ background: 'var(--success-subtle)', color: 'var(--success)' }}>
                    <ExternalLink className="w-4 h-4" /> فتح في تبويب جديد
                  </button>
                </>
              )}
            </div>
          )}
          <p className="text-center text-xs text-gray-400 pb-4">{name}</p>
        </div>
      </div>
    </div>
  );
}
