import axios from 'axios';

const isDev = import.meta.env.DEV;

const api = axios.create({
  // In production (served by backend), use relative path. In dev, use explicit URL.
  baseURL: import.meta.env.VITE_API_URL || (isDev ? 'http://localhost:5000/api' : '/api'),
});

export const createSession = (tableId) => api.post('/sessions', { table_id: tableId });
export const getSession = (sessionId) => api.get(`/sessions/${sessionId}`);
export const updateSessionMode = (sessionId, mode) => api.patch(`/sessions/${sessionId}`, { mode });

export default api;
