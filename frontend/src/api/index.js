import axios from 'axios';

const isDev = import.meta.env.DEV;

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || (isDev ? 'http://localhost:5000' : '/api'),
});

// Updated createSession to accept table_token, context, and mode
export const createSession = ({ table_token, context, mode, restaurant_slug }) => 
  api.post('/sessions', { table_token, context, mode, restaurant_slug });

export const joinDualSession = ({ table_token, code, session_id, reclaim_role, restaurant_slug }) =>
  api.post('/sessions/join-dual', { table_token, code, session_id, reclaim_role, restaurant_slug });

export const resolveSession = ({ restaurant_id, restaurant_slug, table_token, device_token }) =>
  api.post('/sessions/resolve', { restaurant_id, restaurant_slug, table_token, device_token });

export const resumeSessionByQr = ({ table_token, participant_token, restaurant_slug }) =>
  api.post('/sessions/resume-by-qr', { table_token, participant_token, restaurant_slug });

export const getSession = (sessionId) => api.get(`/sessions/${sessionId}`);
export const getSessionByTable = (tableToken) => api.get(`/sessions/by-table/${tableToken}`);

export const publicHandshake = (slug, table) =>
  api.get(`/public/handshake?slug=${encodeURIComponent(slug)}&table=${encodeURIComponent(table)}`);

// Kept for backward compatibility or joining existing sessions if needed, 
// though the new flow emphasizes creating/joining via the main flow.
export const updateSessionMode = (sessionId, mode) => api.patch(`/sessions/${sessionId}`, { mode });

export default api;
