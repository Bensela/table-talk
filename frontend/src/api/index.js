import axios from 'axios';

const isDev = import.meta.env.DEV;

const api = axios.create({
  // In production (served by backend), use relative path. In dev, use explicit URL.
  baseURL: import.meta.env.VITE_API_URL || (isDev ? 'http://localhost:5000' : '/api'),
});

// Updated createSession to accept table_token, context, and mode
export const createSession = ({ table_token, context, mode }) => 
  api.post('/sessions', { table_token, context, mode });

export const joinDualSession = ({ table_token, code }) =>
  api.post('/sessions/join-dual', { table_token, code });

export const resumeSessionByQr = ({ table_token, participant_token }) =>
  api.post('/sessions/resume-by-qr', { table_token, participant_token });

export const getSession = (sessionId) => api.get(`/sessions/${sessionId}`);
export const getSessionByTable = (tableToken) => api.get(`/sessions/by-table/${tableToken}`);

// Kept for backward compatibility or joining existing sessions if needed, 
// though the new flow emphasizes creating/joining via the main flow.
export const updateSessionMode = (sessionId, mode) => api.patch(`/sessions/${sessionId}`, { mode });

export default api;
