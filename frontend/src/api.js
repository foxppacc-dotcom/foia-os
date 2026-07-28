// API base URL.
// In production, use VITE_API_URL for the backend origin.
// Falls back to '/api' for dev (Vite proxy forwards to backend).
// If VITE_API_URL is not set in production, fallback to hardcoded backend.
// API base URL — read from meta tag or build-time env
const API = (function() {
  // Production: read from meta tag set by index.html
  var m = typeof document !== 'undefined' && document.querySelector && document.querySelector('meta[name="api-base"]');
  if (m) return m.getAttribute('content');
  // Build-time: VITE_API_URL (empty in production = use fallback)
  var r = import.meta.env.VITE_API_URL || '';
  if (r && r !== '/api') return r.replace(/\/$/, '') + '/api';
  // Dev localhost
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
    return window.location.origin + '/api';
  // Production fallback
  return 'https://backend-six-flax-84.vercel.app/api';
})();
export { API };
export const getApiBase = () => API;

let TOKEN = localStorage.getItem('foia_token') || null;

function setToken(token) { TOKEN = token; }

async function request(path, options = {}) {
  const headers = { ...options.headers };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  
  // Only set Content-Type for non-FormData bodies
  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }
  
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers,
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const api = {
  setToken,
  
  // Generic HTTP methods used by pages
  get: (path) => request(path),
  post: (path, data) => request(path, { method: 'POST', body: JSON.stringify(data) }),
  put: (path, data) => request(path, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (path) => request(path, { method: 'DELETE' }),
  
  // Auth
  login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request('/auth/me'),
  health: () => request('/health'),
  
  // Cases
  getCases: (params = '') => request(`/cases${params}`),
  getCase: (id) => request(`/cases/${id}`),
  createCase: (data) => request('/cases', { method: 'POST', body: JSON.stringify(data) }),
  updateCase: (id, data) => request(`/cases/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCase: (id) => request(`/cases/${id}`, { method: 'DELETE' }),

  // Assignees
  getAssignees: (caseId) => request(`/cases/${caseId}/assignees`),
  assignUsers: (caseId, data) => request(`/cases/${caseId}/assignees`, { method: 'POST', body: JSON.stringify(data) }),
  unassignUser: (caseId, userId) => request(`/cases/${caseId}/assignees/${userId}`, { method: 'DELETE' }),

  // Specialties
  getSpecialties: () => request('/specialties'),
  getSpecializedUsers: () => request('/users/specialized'),

  // Requests
  getRequests: (caseId) => request(`/cases/${caseId}/requests`),
  createRequest: (caseId, data) => request(`/cases/${caseId}/requests`, { method: 'POST', body: JSON.stringify(data) }),
  updateRequest: (id, data) => request(`/requests/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  moveRequest: (id, classificationId) => request(`/requests/${id}/classification`, { method: 'PUT', body: JSON.stringify({ classification_id: classificationId }) }),

  // Pipeline
  getPipeline: () => request('/pipeline'),
  moveTask: (id, listId) => request(`/pipeline/tasks/${id}`, { method: 'PUT', body: JSON.stringify({ list_id: listId }) }),

  // Agencies
  getAgencies: () => request('/agencies'),
  createAgency: (data) => request('/agencies', { method: 'POST', body: JSON.stringify(data) }),
  updateAgency: (id, data) => request(`/agencies/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Communications
  getCommunications: (caseId) => request(`/cases/${caseId}/communications`),
  createCommunication: (caseId, data) => request(`/cases/${caseId}/communications`, { method: 'POST', body: JSON.stringify(data) }),

  // Dashboard
  getDashboard: () => request('/dashboard'),

  // AI Intake
  intakeText: (data) => request('/intake/text', { method: 'POST', body: JSON.stringify(data) }),
  intakeUpload: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch(`${API}/intake/upload`, {
      method: 'POST',
      headers: TOKEN ? { 'Authorization': `Bearer ${TOKEN}` } : {},
      body: formData,
    }).then(res => res.json());
  },

  // Users (admin)
  getUsers: () => request('/users'),
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),

  // Teams
  getTeams: () => request('/teams'),
  createTeam: (data) => request('/teams', { method: 'POST', body: JSON.stringify(data) }),
  updateTeam: (id, data) => request(`/teams/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTeam: (id) => request(`/teams/${id}`, { method: 'DELETE' }),
  getTeamMembers: (id) => request(`/teams/${id}/members`),
};
