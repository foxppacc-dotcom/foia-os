import { API } from '../../../api';

export const uploadDocument = async (caseId, file, originalName, fileType, description) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('original_name', originalName || file.name);
  formData.append('filename', file.name);
  formData.append('file_type', fileType);
  formData.append('description', description);
  const token = localStorage.getItem('foia_token');
  const res = await fetch(`${API}/cases/${caseId}/documents`, {
    method: 'POST',
    headers: token ? { 'Authorization': 'Bearer ' + token } : {},
    body: formData,
  });
  return res.json();
};

export const deleteDocument = async (caseId, docId) => {
  const res = await fetch(`/api/cases/${caseId}/documents/${docId}`, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('foia_token') },
  });
  return res.json();
};
