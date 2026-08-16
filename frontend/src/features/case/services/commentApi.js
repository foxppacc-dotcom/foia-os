import { API } from '../../../api';

const tok = () => localStorage.getItem('foia_token');

// Always sent as FormData (even for a text-only comment) so the same route
// handles plain text, an attached image/file, and a pasted link through one
// code path instead of branching between JSON and multipart on the client.
export const postComment = async (caseId, { content, file, linkUrl, linkLabel, replyToId, mentionedUserIds, recordType }) => {
  const formData = new FormData();
  if (content) formData.append('content', content);
  if (file) formData.append('file', file);
  if (linkUrl) {
    formData.append('link_url', linkUrl);
    if (linkLabel) formData.append('link_label', linkLabel);
  }
  if (replyToId) formData.append('reply_to_id', replyToId);
  if (mentionedUserIds && mentionedUserIds.length) formData.append('mentioned_user_ids', JSON.stringify(mentionedUserIds));
  // Scopes this comment to a specific checklist item's notes thread instead
  // of the case's general "نقاش الفريق" -- omitted entirely for the general
  // thread, matching the backend's own null-means-general convention.
  if (recordType) formData.append('record_type', recordType);
  const res = await fetch(`${API}/cases/${caseId}/comments`, {
    method: 'POST',
    headers: tok() ? { Authorization: 'Bearer ' + tok() } : {},
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'فشل نشر التعليق');
  return data;
};

export const deleteComment = async (caseId, commentId) => {
  const res = await fetch(`${API}/cases/${caseId}/comments/${commentId}`, {
    method: 'DELETE',
    headers: tok() ? { Authorization: 'Bearer ' + tok() } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'فشل حذف التعليق');
  return data;
};
