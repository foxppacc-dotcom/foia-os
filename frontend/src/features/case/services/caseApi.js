import { api } from '../../../api';

export const fetchCaseDashboard = (id) => api.get(`/cases/${id}/dashboard`);
export const fetchUsers = () => api.get('/users').then(d => d.data || d || []);
export const fetchSpecializedUsers = () => api.get('/users/specialized').then(d => d.data || []);
export const fetchAgencies = () => api.get('/agencies?limit=1000').then(d => {
  const items = d?.data || d || [];
  return Array.isArray(items) ? items : [];
});
export const updateChecklistItem = (caseId, recordType, payload) =>
  api.put(`/cases/${caseId}/checklist/${recordType}`, payload);
export const addTeamMember = (caseId, data) => api.post(`/cases/${caseId}/team`, data);
export const removeTeamMember = (caseId, userId) => api.delete(`/cases/${caseId}/team/${userId}`);
export const addAgencyRequest = (caseId, agencyId) =>
  api.post(`/cases/${caseId}/requests`, { agency_id: agencyId });
export const removeAgencyRequest = (caseId, reqId) =>
  api.delete(`/cases/${caseId}/requests/${reqId}`);
export const classifyAgency = (caseId, reqId, value) =>
  api.put(`/cases/${caseId}/requests/${reqId}/classification`, { agency_classification: value });
