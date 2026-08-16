import axios from 'axios';

const isDev = import.meta.env.DEV;
const rawApiBaseUrl = import.meta.env.VITE_API_URL || (isDev ? 'http://localhost:5000' : '/api');

export const apiBaseUrl = rawApiBaseUrl.replace(/\/+$/, '');

export function buildApiUrl(path = '') {
  if (!path) {
    return apiBaseUrl;
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${apiBaseUrl}${normalizedPath}`;
}

// -----------------------------------------------------------------------------
// Auth error codes (must match TOKEN_ERRORS in backend authMiddleware.js)
// -----------------------------------------------------------------------------
export const TOKEN_ERROR_CODES = new Set([
  'TOKEN_REQUIRED',
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
  'TOKEN_REVOKED'
]);

// -----------------------------------------------------------------------------
// Admin token storage helpers
// -----------------------------------------------------------------------------
const ADMIN_TOKEN_KEY = 'adminToken';
const ADMIN_USER_KEY = 'adminUser';
export const AUTH_EXPIRED_EVENT = 'admin:auth-expired';

export function getAdminToken() {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function clearAdminAuth(reason = 'TOKEN_REVOKED') {
  try {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_USER_KEY);
  } catch { /* ignore storage errors */ }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { reason, returnTo: window.location.pathname + window.location.search } }));
  }
}

export function setAdminAuth({ token, user }) {
  if (token) {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
  }
  if (typeof user !== 'undefined') {
    localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(user));
  }
}

// Client-side (no signature verification) JWT expiry check.
// Signature integrity is always verified server-side — this is just UX optimization
// so the frontend can redirect to login before making an API call that will 401.
export function getAdminTokenInfo(tokenOrFallback) {
  const token = typeof tokenOrFallback === 'string' ? tokenOrFallback : getAdminToken();
  if (!token) return { valid: false, payload: null, expiresAtMs: null, needsRefresh: false };
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false, payload: null, expiresAtMs: null, needsRefresh: true };
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload || !payload.id || !payload.role) {
      return { valid: false, payload: null, expiresAtMs: null, needsRefresh: true };
    }
    const expiresAtMs = payload.exp ? Number(payload.exp) * 1000 : null;
    const nowMs = Date.now();
    const expired = expiresAtMs ? nowMs > expiresAtMs : false;
    const needsRefresh = expired || !expiresAtMs;
    // Count as "expiring soon" if within 2 minutes of expire window so it can soft refresh
    const expiringSoon = expiresAtMs ? (expiresAtMs - nowMs) < 2 * 60 * 1000 : true;
    return {
      valid: !expired,
      payload,
      expiresAtMs,
      expired,
      expiringSoon,
      needsRefresh
    };
  } catch {
    return { valid: false, payload: null, expiresAtMs: null, needsRefresh: true };
  }
}

// -----------------------------------------------------------------------------
// Attach admin bearer token if present — used for fetch + axios both
// -----------------------------------------------------------------------------
function attachAdminAuthHeaders(existingHeaders = {}) {
  const token = getAdminToken();
  const next = { ...existingHeaders };
  if (!next.Authorization && !next.authorization && token) {
    next.Authorization = `Bearer ${token}`;
  }
  if (!next['Content-Type'] && !next['content-type']) {
    next['Content-Type'] = 'application/json';
  }
  return next;
}

// -----------------------------------------------------------------------------
// Central "is this response an auth-expired event?" classifier
// -----------------------------------------------------------------------------
function classifyAuthError({ status, errorCode, data }) {
  const body = data && typeof data === 'object' ? data : null;
  const code = errorCode || body?.error_code || null;
  if (code && TOKEN_ERROR_CODES.has(code)) return code;
  if ((status === 401 || status === 403) && code !== 'ROLE_DENIED') {
    // Fallback: 401/403 without explicit error code still counts as expired/invalid
    // unless it's a role denial (user is properly authenticated but lacks permission,
    // so we should NOT log them out — they just see the 403 banner in UI).
    return TOKEN_ERROR_CODES.has(code) ? code : 'TOKEN_INVALID';
  }
  return null;
}

// -----------------------------------------------------------------------------
// Plain fetch wrapper `apiFetch` — auto auth-header + auto-redirect on expired
// -----------------------------------------------------------------------------
export async function apiFetch(path, options = {}) {
  const url = buildApiUrl(path);
  const headers = attachAdminAuthHeaders(options.headers || {});
  const nextOptions = { ...options, headers };

  let response;
  try {
    response = await fetch(url, nextOptions);
  } catch (err) {
    // Network error — not an auth error, re-throw
    throw err;
  }

  // For non-JSON responses (downloads, etc) classification can still use status code
  let parsedBody = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      // Clone so callers can still call .json() if needed
      parsedBody = await response.clone().json();
    } catch {
      parsedBody = null;
    }
  }

  const errorCode = classifyAuthError({ status: response.status, data: parsedBody });
  if (errorCode) {
    clearAdminAuth(errorCode);
  }

  return response;
}

// -----------------------------------------------------------------------------
// Axios client — same behavior as apiFetch, for axios-based callers
// -----------------------------------------------------------------------------
const api = axios.create({
  baseURL: apiBaseUrl,
});

api.interceptors.request.use((config) => {
  config.headers = attachAdminAuthHeaders(config.headers);
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const data = error?.response?.data;
    const errorCode = classifyAuthError({ status, data });
    if (errorCode) {
      clearAdminAuth(errorCode);
    }
    return Promise.reject(error);
  }
);

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
