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
// Temporary geolocation access token — stored per-tab, never persisted
// -----------------------------------------------------------------------------
const TEMP_GEO_TOKEN_KEY = 'temp_access_token';

export function getTempGeoAccessToken() {
  try {
    return sessionStorage.getItem(TEMP_GEO_TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function setTempGeoAccessToken(token) {
  try {
    if (token && typeof token === 'string') {
      sessionStorage.setItem(TEMP_GEO_TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(TEMP_GEO_TOKEN_KEY);
    }
  } catch { /* ignore */ }
}

export function clearTempGeoAccessToken() {
  try {
    sessionStorage.removeItem(TEMP_GEO_TOKEN_KEY);
  } catch { /* ignore */ }
}

/**
 * Event fired when the temporary geolocation access window expires.
 * Any page can listen for this to show a banner or redirect.
 */
export const TEMP_GEO_EXPIRED_EVENT = 'temp-geo:expired';

function emitTempGeoExpired(detail = {}) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(TEMP_GEO_EXPIRED_EVENT, { detail }));
  } catch { /* ignore */ }
}

// -----------------------------------------------------------------------------
// Classify TEMP_GEO_EXPIRED (HTTP 410 / geofence_code) distinctly from admin auth
// -----------------------------------------------------------------------------
function classifyTempGeoError({ status, data }) {
  const body = data && typeof data === 'object' ? data : null;
  if (status === 410 && body && body.geofence_code === 'TEMP_ACCESS_EXPIRED') {
    return 'TEMP_ACCESS_EXPIRED';
  }
  if (body && body.geofence_code === 'TEMP_ACCESS_INVALID') {
    return 'TEMP_ACCESS_INVALID';
  }
  return null;
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
// Attach admin bearer token + temp-geo token if present — used for fetch + axios both
//
// requestPathOrUrl: optional. If the target path starts with /admin (after
// stripping the apiBaseUrl prefix), temp-geo tokens are NEVER attached because
// temp access only makes sense for QR landing / welcome screen public routes.
// This eliminates a latent 401 redirect loop when a user scans a QR (storing
// temp_access_token in sessionStorage) then navigates to /admin without an
// explicit admin Bearer token yet (e.g. login form initial load).
// -----------------------------------------------------------------------------
function isAdminPath(requestPathOrUrl) {
  if (!requestPathOrUrl || typeof requestPathOrUrl !== 'string') return false;
  const stripped = requestPathOrUrl.startsWith(apiBaseUrl)
    ? requestPathOrUrl.slice(apiBaseUrl.length)
    : requestPathOrUrl;
  return /^\/admin(?:\/|$)/i.test(stripped);
}

function attachAdminAuthHeaders(existingHeaders = {}, requestPathOrUrl) {
  const token = getAdminToken();
  const next = { ...existingHeaders };
  if (!next.Authorization && !next.authorization && token) {
    next.Authorization = `Bearer ${token}`;
    if (!next['Content-Type'] && !next['content-type']) {
      next['Content-Type'] = 'application/json';
    }
    return next;
  }
  const adminRoute = isAdminPath(requestPathOrUrl);
  if (!adminRoute) {
    const tempTok = getTempGeoAccessToken();
    if (tempTok && !next.Authorization && !next.authorization) {
      next.Authorization = `Temp ${tempTok}`;
    }
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
//
// Admin-path isolation rules:
//   • Targets under /admin/* NEVER attach temp-geo tokens via attachAdminAuthHeaders
//   • On /admin/* targets, classifyTempGeoError clears the stale token but never
//     triggers a window.location redirect (temp access is irrelevant for admin)
//   • On /admin/* targets where tempGeo already handled, don't also run
//     classifyAuthError/clearAdminAuth (prevents double-classify logout loop)
// -----------------------------------------------------------------------------
export async function apiFetch(path, options = {}) {
  const url = buildApiUrl(path);
  const headers = attachAdminAuthHeaders(options.headers || {}, path);
  const nextOptions = { ...options, headers };
  const adminRoute = isAdminPath(path);

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

  const tempGeo = classifyTempGeoError({ status: response.status, data: parsedBody });
  if (tempGeo) {
    clearTempGeoAccessToken();
    emitTempGeoExpired({ code: tempGeo, data: parsedBody });
    if (!adminRoute) {
      if (typeof window !== 'undefined') {
        try {
          const current = window.location.pathname;
          if (current && current.length > 1) {
            window.location.assign(current);
          } else {
            window.location.assign('/');
          }
        } catch { /* ignore */ }
      }
    }
  }

  if (!adminRoute || !tempGeo) {
    const errorCode = classifyAuthError({ status: response.status, data: parsedBody });
    if (errorCode) {
      clearAdminAuth(errorCode);
    }
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
  const target = config.url || '';
  config.headers = attachAdminAuthHeaders(config.headers, target);
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const data = error?.response?.data;
    const targetUrl = error?.config?.url || '';
    const adminRoute = isAdminPath(targetUrl);

    const tempGeo = classifyTempGeoError({ status, data });
    if (tempGeo) {
      clearTempGeoAccessToken();
      emitTempGeoExpired({ code: tempGeo, data });
      if (!adminRoute) {
        if (typeof window !== 'undefined') {
          try {
            const path = window.location.pathname;
            if (path && path.length > 1) {
              window.location.assign(path);
            } else {
              window.location.assign('/');
            }
          } catch { /* ignore */ }
        }
      }
    }

    if (!adminRoute || !tempGeo) {
      const errorCode = classifyAuthError({ status, data });
      if (errorCode) {
        clearAdminAuth(errorCode);
      }
    }
    return Promise.reject(error);
  }
);

// -----------------------------------------------------------------------------
// Public analytics beacon — client-side step logging
// -----------------------------------------------------------------------------
export const PUBLIC_EVENT_TYPES = Object.freeze({
  QR_SCAN_VALIDATED: 'qr_scan_validated',
  QR_SCAN_REJECTED: 'qr_scan_rejected',
  QR_SCAN_INVALID: 'qr_scan_invalid',
  GEOFENCE_CHECK_DENIED: 'geofence_check_denied',
  WELCOME_GEOFENCE_DENIED: 'welcome_geofence_denied',
  WELCOME_GEOLOCATION_REQUEST: 'welcome_geolocation_request',
  WELCOME_SCREEN_RENDERED: 'welcome_screen_rendered',
  CONTEXT_SELECTED: 'context_selected',
  MODE_SELECTED: 'mode_selected',
  SESSION_CREATED: 'session_created',
  SESSION_RESUMED: 'session_resumed',
  SESSION_RECONNECT: 'session_reconnect',
  SESSION_EXPIRED: 'session_expired',
  SESSION_END: 'session_end',
  DUAL_PARTNER_JOINED: 'dual_partner_joined',
  DUAL_PAIRING_FAILED: 'dual_pairing_failed',
  DUAL_FULL_REJECTED: 'dual_full_rejected',
  MENU_OPENED: 'menu_opened',
  CONTEXT_CHANGED: 'context_changed',
  MODE_CHANGED: 'mode_changed',
  START_FRESH: 'start_fresh',
  SESSION_DESTROYED: 'session_destroyed',
  QUESTION_VIEWED: 'question_viewed',
  QUESTION_REVEALED: 'question_revealed',
  QUESTION_LOCKED: 'question_locked',
  MCQ_ANSWER_SUBMITTED: 'mcq_answer_submitted',
  QUESTION_ADVANCED: 'question_advanced',
  HINT_REVEALED: 'hint_revealed',
  DECK_FALLBACK_CONTEXT: 'deck_fallback_context',
  DECK_EMPTY: 'deck_empty',
  SERVER_ERROR: 'server_error',
  SOCKET_ERROR: 'socket_error',
  CLIENT_ERROR: 'client_error',
  RECONNECT_SUCCEEDED: 'reconnect_succeeded',
  RECONNECT_FAILED: 'reconnect_failed',
  DESYNC_DETECTED: 'desync_detected'
});

// Local per-session deduplication of noisy events (client-side).
const __dedup = new Map(); // key -> expiresAt ms
function __shouldEmit(key, ttlMs = 1000 * 60) {
  try {
    const now = Date.now();
    const exp = __dedup.get(key);
    if (exp && exp > now) return false;
    __dedup.set(key, now + ttlMs);
    return true;
  } catch { return true; }
}

/**
 * Fire-and-forget public analytics beacon. Never throws, never blocks.
 *
 * @param {keyof typeof PUBLIC_EVENT_TYPES | string} event_type - canonical vocabulary string
 * @param {{session_id?, participant_id?, restaurant_id?, table_token?, anonymous_id?, event_data?, timestamp?}} [ctx]
 */
export function trackEvent(event_type, ctx = {}) {
  try {
    if (!event_type || typeof event_type !== 'string') return;
    const key = `${String(event_type)}:${String(ctx.session_id || 'no-session')}:${String(ctx.participant_id || 'no-participant')}:${JSON.stringify(ctx.event_data || null).slice(0, 80)}`;
    if (event_type === PUBLIC_EVENT_TYPES.QUESTION_VIEWED) {
      if (!__shouldEmit(key, 500)) return;
    } else if (event_type === PUBLIC_EVENT_TYPES.HINT_REVEALED || event_type === PUBLIC_EVENT_TYPES.QUESTION_REVEALED) {
      if (!__shouldEmit(key, 1000 * 60 * 5)) return;
    } else if (event_type === PUBLIC_EVENT_TYPES.RECONNECT_FAILED || event_type === PUBLIC_EVENT_TYPES.RECONNECT_SUCCEEDED) {
      if (!__shouldEmit(key, 1000 * 30)) return;
    }
    const payload = {
      event_type: String(event_type).slice(0, 50),
      session_id: ctx.session_id || null,
      participant_id: ctx.participant_id || null,
      restaurant_id: ctx.restaurant_id || null,
      table_token: typeof ctx.table_token === 'string' ? ctx.table_token : (ctx.table_number != null ? String(ctx.table_number) : null) || null,
      anonymous_id: typeof ctx.anonymous_id === 'string' ? ctx.anonymous_id : null,
      event_data: ctx.event_data || null,
      timestamp: ctx.timestamp || null
    };
    fetch(buildApiUrl('/public/events'), {
      method: 'POST',
      credentials: 'omit',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => null);
  } catch { /* never throw, never break the UX */ }
}

// Automatically forward unhandled client-side JS errors to the audit log, deduped.
if (typeof window !== 'undefined') {
  const ERROR_DEDUP_MS = 1000 * 60 * 5;
  window.addEventListener('error', (evt) => {
    const sig = `${String(evt.message || '').slice(0, 120)}|${String(evt.filename || '')}|${String(evt.lineno || '')}|${String(evt.colno || '')}`;
    if (!__shouldEmit(`window_error:${sig}`, ERROR_DEDUP_MS)) return;
    trackEvent(PUBLIC_EVENT_TYPES.CLIENT_ERROR, {
      event_data: {
        source: 'window.error',
        message: String(evt.message || '').slice(0, 500),
        filename: String(evt.filename || '').slice(0, 255),
        line: Number.isFinite(evt.lineno) ? Number(evt.lineno) : null,
        col: Number.isFinite(evt.colno) ? Number(evt.colno) : null,
        stack: String(evt.error?.stack || '').slice(0, 2000) || null
      }
    });
  });
  window.addEventListener('unhandledrejection', (evt) => {
    const sig = String((evt.reason && (evt.reason.message || evt.reason)) || '').slice(0, 160);
    if (!__shouldEmit(`unhandled_rejection:${sig}`, ERROR_DEDUP_MS)) return;
    trackEvent(PUBLIC_EVENT_TYPES.CLIENT_ERROR, {
      event_data: {
        source: 'window.unhandledrejection',
        reason: sig.slice(0, 1000),
        stack: String(evt.reason?.stack || '').slice(0, 2000) || null
      }
    });
  });
}

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

/**
 * Public handshake + optional geolocation payload.
 *
 * @param {string} slug - restaurant slug
 * @param {string|number} table - table identifier
 * @param {Object} [opts]
 * @param {{latitude:number|null, longitude:number|null}|null} [opts.location] - client GPS coordinates
 * @param {'granted'|'prompt'|'denied'|'unsupported'} [opts.geolocationStatus] - browser Geolocation permission state
 */
export const publicHandshake = (slug, table, opts = {}) => {
  const params = new URLSearchParams();
  params.set('slug', encodeURIComponent(slug));
  params.set('table', encodeURIComponent(table));
  if (opts.location?.latitude != null && Number.isFinite(Number(opts.location.latitude))) {
    params.set('client_lat', String(opts.location.latitude));
  }
  if (opts.location?.longitude != null && Number.isFinite(Number(opts.location.longitude))) {
    params.set('client_lng', String(opts.location.longitude));
  }
  if (opts.geolocationStatus) {
    params.set('geolocation_status', opts.geolocationStatus);
  }
  if (typeof opts.location?.accuracy === 'number' && Number.isFinite(opts.location.accuracy)) {
    params.set('client_accuracy_m', String(Math.round(opts.location.accuracy)));
  }
  if (typeof opts.bypass === 'string' && opts.bypass.length > 0) {
    params.set('bypass', opts.bypass);
  }
  return api.get(`/public/handshake?${params.toString()}`);
};

/**
 * Pre-flight geofence-only check. Runs no billing or table validation.
 * Useful to warm the permission prompt before the full handshake call.
 */
export const preflightGeofence = (slug, opts = {}) => {
  const params = new URLSearchParams();
  params.set('slug', encodeURIComponent(slug));
  if (opts.location?.latitude != null && Number.isFinite(Number(opts.location.latitude))) {
    params.set('client_lat', String(opts.location.latitude));
  }
  if (opts.location?.longitude != null && Number.isFinite(Number(opts.location.longitude))) {
    params.set('client_lng', String(opts.location.longitude));
  }
  if (opts.geolocationStatus) {
    params.set('geolocation_status', opts.geolocationStatus);
  }
  if (typeof opts.location?.accuracy === 'number' && Number.isFinite(opts.location.accuracy)) {
    params.set('client_accuracy_m', String(Math.round(opts.location.accuracy)));
  }
  if (typeof opts.bypass === 'string' && opts.bypass.length > 0) {
    params.set('bypass', opts.bypass);
  }
  return api.get(`/public/geofence?${params.toString()}`);
};

/**
 * Request a short-lived temporary geolocation access bypass token.
 * Only issues tokens when geolocation permission is NOT permanently denied.
 *
 * @param {string} slug - restaurant slug
 * @param {string|number} table - table identifier
 * @param {Object} [opts]
 * @param {{latitude:number|null, longitude:number|null}|null} [opts.location]
 * @param {'granted'|'prompt'|'denied'|'unsupported'} [opts.geolocationStatus]
 * @returns {Promise<{temp_access_granted:boolean, temp_access_token?:string, expires_at_iso?:string, expires_at_unix?:number, ttl_seconds?:number, geolocation_status:string, action_required?:string}>}
 */
export async function requestTempGeoAccess(slug, table, opts = {}) {
  const body = {
    slug,
    table
  };
  if (opts.location?.latitude != null && Number.isFinite(Number(opts.location.latitude))) {
    body.client_lat = Number(opts.location.latitude);
  }
  if (opts.location?.longitude != null && Number.isFinite(Number(opts.location.longitude))) {
    body.client_lng = Number(opts.location.longitude);
  }
  if (opts.geolocationStatus) {
    body.geolocation_status = opts.geolocationStatus;
  }
  try {
    const res = await api.post('/public/temp-access', body);
    const d = res.data || {};
    if (d.temp_access_granted === true && d.temp_access_token) {
      setTempGeoAccessToken(d.temp_access_token);
    }
    return d;
  } catch (err) {
    const d = err?.response?.data || {};
    clearTempGeoAccessToken();
    return Object.assign({
      temp_access_granted: false,
      error: d.error || err.message || 'Request failed'
    }, d);
  }
}

// Kept for backward compatibility or joining existing sessions if needed, 
// though the new flow emphasizes creating/joining via the main flow.
export const updateSessionMode = (sessionId, mode) => api.patch(`/sessions/${sessionId}`, { mode });

export default api;
