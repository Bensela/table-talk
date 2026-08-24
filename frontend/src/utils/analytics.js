import { apiFetch, buildApiUrl } from '../api';

const ANONYMOUS_ID_KEY = 'catalyst_analytics_anonymous_id_v1';

/**
 * Lightweight UUID v4 generator — avoids pulling uuid package for one job.
 * Falls back to random hex string when crypto.randomUUID is unavailable.
 */
function generateAnonymousId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // ignore and fall through
  }
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [
      bytes.slice(0, 4), bytes.slice(4, 6), bytes.slice(6, 8),
      bytes.slice(8, 10), bytes.slice(10, 16)
    ].map(b => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')).join('-');
  } catch {
    return `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Get (or lazily create and persist) the pre-session anonymous id.
 * Lives in sessionStorage so a single page-session of scanning → onboarding → play
 * can be stitched back together server-side even before session_id/participant_id
 * are assigned.
 *
 * Safe under SSR / non-browser contexts (returns null, doesn't throw).
 */
export function getAnonymousId() {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
    return null;
  }
  try {
    let existing = window.sessionStorage.getItem(ANONYMOUS_ID_KEY);
    if (existing) return existing;
    existing = generateAnonymousId();
    window.sessionStorage.setItem(ANONYMOUS_ID_KEY, existing);
    return existing;
  } catch {
    return null;
  }
}

/**
 * Pick the current session identifiers from the shared sessionStorage helper
 * or a supplied override (useful for components that already have the ids).
 */
function resolveIdentifiers(overrides = {}) {
  const out = {
    session_id: overrides.session_id || null,
    participant_id: overrides.participant_id || null,
    anonymous_id: overrides.anonymous_id || getAnonymousId()
  };

  if (!out.session_id || !out.participant_id) {
    try {
      if (typeof sessionStorage !== 'undefined') {
        if (!out.session_id) {
          out.session_id = sessionStorage.getItem('session_id') || null;
        }
        if (!out.participant_id) {
          out.participant_id = sessionStorage.getItem('participant_id') || null;
        }
      }
    } catch {
      // ignore storage access errors
    }
  }

  return out;
}

/**
 * Emit an append-only, raw analytics event that occurred *before* a session
 * exists (scanner decode, welcome screen render, context/mode selection clicks).
 *
 * Always attaches the anonymous_id for funnel stitching.
 * Never throws — a beacon failure must never break the user flow.
 *
 * @param {Object} payload
 * @param {string} payload.event_type - required, short machine name
 * @param {Object} [payload.event_data] - JSON-serialisable payload
 * @param {Object} [payload.ids] - optional { session_id, participant_id, anonymous_id } overrides
 * @returns {Promise<{event_id?: string, ok: boolean}>}
 */
export async function trackPublicEvent(payload = {}) {
  const { event_type, event_data, ids = {} } = payload || {};

  if (!event_type || typeof event_type !== 'string') {
    if (import.meta.env.DEV) {
      console.warn('[analytics] trackPublicEvent skipped: missing event_type');
    }
    return { ok: false };
  }

  const identifiers = resolveIdentifiers(ids);
  const body = {
    anonymous_id: identifiers.anonymous_id,
    session_id: identifiers.session_id,
    participant_id: identifiers.participant_id,
    event_type: String(event_type).trim().slice(0, 50),
    event_data: event_data && typeof event_data === 'object' ? event_data : null,
    timestamp: new Date().toISOString()
  };

  try {
    const res = await apiFetch('/public/events', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res || !res.ok) return { ok: false };
    try {
      const json = await res.json();
      return { ok: true, event_id: json?.event_id || null };
    } catch {
      return { ok: true };
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[analytics] trackPublicEvent fire-and-forget failure:', err?.message || err);
    }
    return { ok: false };
  }
}

/**
 * Emit an in-session analytics event. Requires (or resolves) both session_id
 * and participant_id. If identifiers are missing, falls back to trackPublicEvent
 * so the event is still preserved for later stitching rather than dropped.
 *
 * @param {Object} payload
 * @param {string} payload.event_type - required, short machine name
 * @param {Object} [payload.event_data] - JSON-serialisable payload
 * @param {Object} [payload.ids] - optional { session_id, participant_id } overrides
 * @returns {Promise<{event_id?: string, ok: boolean}>}
 */
export async function trackSessionEvent(payload = {}) {
  const { event_type, event_data, ids = {} } = payload || {};

  if (!event_type || typeof event_type !== 'string') {
    if (import.meta.env.DEV) {
      console.warn('[analytics] trackSessionEvent skipped: missing event_type');
    }
    return { ok: false };
  }

  const identifiers = resolveIdentifiers(ids);

  // If we still lack session_id, fall back to the public endpoint — the
  // backend insert still accepts nullable identifiers, so we preserve the row.
  if (!identifiers.session_id || !identifiers.participant_id) {
    return trackPublicEvent({ event_type, event_data, ids });
  }

  const body = {
    anonymous_id: identifiers.anonymous_id,
    session_id: identifiers.session_id,
    participant_id: identifiers.participant_id,
    event_type: String(event_type).trim().slice(0, 50),
    event_data: event_data && typeof event_data === 'object' ? event_data : null,
    timestamp: new Date().toISOString()
  };

  try {
    const res = await apiFetch('/sessions/events', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res || !res.ok) return { ok: false };
    try {
      const json = await res.json();
      return { ok: true, event_id: json?.event_id || null };
    } catch {
      return { ok: true };
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[analytics] trackSessionEvent fire-and-forget failure:', err?.message || err);
    }
    return { ok: false };
  }
}

/**
 * Fire-and-forget helper — mirrors trackSessionEvent but returns undefined
 * instead of a promise so callers don't accidentally swallow errors in
 * onClick / useEffect cleanup paths.
 */
export function fireSessionEvent(payload = {}) {
  trackSessionEvent(payload);
}

/**
 * Fire-and-forget helper for public/pre-session events.
 */
export function firePublicEvent(payload = {}) {
  trackPublicEvent(payload);
}

// Expose buildApiUrl re-export so callers don't have to import from two places
export { buildApiUrl };
