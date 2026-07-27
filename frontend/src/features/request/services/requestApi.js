import { api } from '../../../api';

export const fetchCaseRequests = (caseId) => api.get(`/cases/${caseId}/requests`);
export const createRequest = (caseId, agencyId) =>
  api.post(`/cases/${caseId}/requests`, { agency_id: agencyId });
export const updateRequest = (id, data) => api.put(`/requests/${id}`, data);
export const deleteRequest = (caseId, reqId) =>
  api.delete(`/cases/${caseId}/requests/${reqId}`);
export const classifyRequest = (caseId, reqId, value) =>
  api.put(`/cases/${caseId}/requests/${reqId}/classification`, { agency_classification: value });
export const setRequestChannel = (id, channel) =>
  api.put(`/requests/${id}/channel`, { channel });
export const reorderRequests = (caseId, orderedIds) =>
  api.put(`/cases/${caseId}/requests/reorder`, { order: orderedIds });
