import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
});

export const createSession = (tableId) => api.post('/sessions', { table_id: tableId });
export const getSession = (sessionId) => api.get(`/sessions/${sessionId}`);
export const updateSessionMode = (sessionId, mode) => api.patch(`/sessions/${sessionId}`, { mode });

export default api;
