export function detectFileType(filename) {
  const ext = (filename || '').toLowerCase().split('.').pop();
  if (['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) return 'image';
  if (['mp4','mov','avi','mkv','webm'].includes(ext)) return 'video';
  if (['mp3','wav','ogg','flac'].includes(ext)) return 'audio';
  if (['pdf'].includes(ext)) return 'pdf';
  return 'document';
}
