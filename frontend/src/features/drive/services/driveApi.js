import { api } from '../../../api';

export const getDriveStatus = () => api.get('/gdrive/status');
export const getDriveAuthUrl = () => api.get('/gdrive/auth-url');
export const disconnectDrive = () => api.post('/gdrive/disconnect', {});
export const setupCaseFolders = (caseId) => api.post(`/gdrive/case/${caseId}/setup-folders`, {});
export const getCaseFolders = (caseId) => api.get(`/gdrive/case/${caseId}/folders`);
export const syncCaseDrive = (caseId) => api.post(`/gdrive/case/${caseId}/sync`, {});
export const initResumableUpload = (fileName, mimeType, folderId) =>
  api.post('/gdrive/upload/init', { fileName, mimeType, folderId });
export const searchDrive = (query) => api.post('/gdrive/search', { query });
