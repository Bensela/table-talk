const db = require('../db');

/**
 * Canonical vocabulary for every event_type in the platform.
 * Normalized to ~28 distinct lifecycle stages.
 */
const EVENT_TYPES = Object.freeze({
  // QR / Pre-handshake scanner stage
  QR_SCAN_VALIDATED: 'qr_scan_validated',
  QR_SCAN_REJECTED: 'qr_scan_rejected', // token unknown, table deleted, tenant suspended
  QR_SCAN_INVALID: 'qr_scan_invalid', // malformed token
  GEOFENCE_CHECK_DENIED: 'geofence_check_denied', // handshake path
  WELCOME_GEOFENCE_DENIED: 'welcome_geofence_denied', // frontend retry/UI path
  WELCOME_GEOLOCATION_REQUEST: 'welcome_geolocation_request',
  WELCOME_SCREEN_RENDERED: 'welcome_screen_rendered',
  CONTEXT_SELECTED: 'context_selected',
  MODE_SELECTED: 'mode_selected',
  // Session lifecycle
  SESSION_CREATED: 'session_created',
  SESSION_RESUMED: 'session_resumed', // 24h rejoin on same anon_id
  SESSION_RECONNECT: 'session_reconnect', // socket reconnect
  SESSION_EXPIRED: 'session_expired', // expiry cleanup
  SESSION_END: 'session_end', // explicit end / start fresh
  // Dual pairing
  DUAL_PAIRING_REQUESTED: 'dual_pairing_requested',
  DUAL_PARTNER_JOINED: 'dual_partner_joined',
  DUAL_PAIRING_FAILED: 'dual_pairing_failed',
  DUAL_FULL_REJECTED: 'dual_full_rejected', // Phone C denied when A+B full
  SESSION_PAIRED: 'session_paired', // for backwards compat
  // Menu & runtime configuration changes
  MENU_OPENED: 'menu_opened',
  CONTEXT_CHANGED: 'context_changed', // menu runtime switch
  MODE_CHANGED: 'mode_changed', // menu runtime switch
  START_FRESH: 'start_fresh', // routed to QR scanner
  SESSION_DESTROYED: 'session_destroyed', // explicit dual-session termination when both Start Fresh
  // Question deck & engagement
  QUESTION_VIEWED: 'question_viewed',
  QUESTION_REVEALED: 'question_revealed', // open-ended tap to reveal
  QUESTION_LOCKED: 'question_locked', // MCQ lock-in answer submitted
  MCQ_ANSWER_SUBMITTED: 'mcq_answer_submitted',
  QUESTION_ADVANCED: 'question_advanced',
  HINT_REVEALED: 'hint_revealed',
  DECK_FALLBACK_CONTEXT: 'deck_fallback_context', // primary context had 0 questions
  DECK_EMPTY: 'deck_empty', // global fallback also had 0
  // Cleanup job lifecycle
  CLEANUP_JOB_STARTED: 'cleanup_job_started',
  CLEANUP_JOB_COMPLETED: 'cleanup_job_completed',
  CLEANUP_JOB_ERROR: 'cleanup_job_error',
  // Errors & abnormal behaviors
  SERVER_ERROR: 'server_error',
  SOCKET_ERROR: 'socket_error',
  CLIENT_ERROR: 'client_error', // browser-level, reported via beacon
  RECONNECT_SUCCEEDED: 'reconnect_succeeded',
  RECONNECT_FAILED: 'reconnect_failed',
  DESYNC_DETECTED: 'desync_detected' // frontend reports positions mismatch
});

function coerceTimestamp(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  try {
    const d = new Date(String(ts).trim());
    if (Number.isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
}

function cleanEventData(data) {
  if (data == null) return null;
  if (typeof data === 'object') return data;
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return { raw: String(data) };
  }
}

/**
 * Insert a single append-only row into analytics_events.
 *
 * All columns except event_type are nullable so pre-session events (no
 * session/participant yet) and anonymous events (public scanner, welcome)
 * can be persisted immediately and joined later when identifiers appear.
 *
 * @param {Object} payload
 * @param {string} payload.event_type - machine name, one of EVENT_TYPES
 * @param {string|UUID} [payload.session_id]
 * @param {string|UUID} [payload.participant_id]
 * @param {string|UUID} [payload.restaurant_id]
 * @param {string} [payload.table_token]
 * @param {string} [payload.anonymous_id] - frontend sessionStorage UUID for pre-session continuity
 * @param {Object} [payload.event_data] - JSONB payload, stored raw
 * @param {string|Date} [payload.timestamp] - ISO string or Date; defaults to NOW()
 * @returns {Promise<{event_id: string}|null>} inserted id, or null if insert failed
 */
async function insertAnalyticsEvent(payload = {}) {
  const {
    event_type,
    session_id,
    participant_id,
    restaurant_id,
    table_token,
    anonymous_id,
    event_data,
    timestamp
  } = payload || {};

  if (!event_type || typeof event_type !== 'string') {
    console.warn('[analyticsService] insertAnalyticsEvent skipped: missing event_type');
    return null;
  }

  const ts = coerceTimestamp(timestamp);

  let query;
  const params = [
    session_id || null,
    participant_id || null,
    restaurant_id || null,
    typeof table_token === 'string' ? table_token.trim() || null : null,
    typeof anonymous_id === 'string' ? anonymous_id.trim() || null : null,
    event_type.trim().slice(0, 50),
    cleanEventData(event_data)
  ];

  if (ts) {
    params.push(ts);
    query = `
      INSERT INTO analytics_events (
        session_id, participant_id, restaurant_id, table_token, anonymous_id,
        event_type, event_data, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING event_id
    `;
  } else {
    query = `
      INSERT INTO analytics_events (
        session_id, participant_id, restaurant_id, table_token, anonymous_id,
        event_type, event_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING event_id
    `;
  }

  try {
    const res = await db.query(query, params);
    return res.rows && res.rows[0] ? res.rows[0] : null;
  } catch (err) {
    if (err?.code === '23503') {
      const col = (String(err.message || '').match(/\xAB?([a-z_]+)\xBB?/i) || [])[1]
        || (err.detail || '').match(/\(([a-z_]+)\)/i)?.[1]
        || null;

      const columnToIndex = {
        session_id: 0,
        participant_id: 1,
        restaurant_id: 2,
        table_token: 3,
        anonymous_id: 4
      };

      const idx = columnToIndex[col];
      if (idx != null && params[idx] != null) {
        const degradedParams = params.slice();
        degradedParams[idx] = null;
        try {
          const res = await db.query(query, degradedParams);
          const row = res.rows && res.rows[0] ? res.rows[0] : null;
          if (row) {
            console.warn('[analyticsService] inserted with FK degrade',
              { event_type, nulled_column: col });
            return row;
          }
        } catch (innerErr) {
          console.error('[analyticsService] retry after degrade also failed',
            innerErr.message, { event_type });
        }
      } else {
        console.error('[analyticsService] FK violation on unknown column',
          err.message, err.detail, { event_type });
      }
      return null;
    }
    console.error('[analyticsService] insert failed', err.message, { event_type });
    return null;
  }
}

/**
 * Helper for backend handlers that already have a sessions row loaded.
 * Copies common denormalized columns into the payload so call sites don't
 * repeat the same spread.
 */
async function insertSessionAnalyticsEvent(session, payload = {}) {
  const merged = {
    session_id: session?.session_id || payload?.session_id || null,
    participant_id: payload?.participant_id || null,
    restaurant_id: session?.restaurant_id || payload?.restaurant_id || null,
    table_token: session?.table_token || payload?.table_token || null,
    anonymous_id: payload?.anonymous_id || null,
    ...payload
  };
  return insertAnalyticsEvent(merged);
}

/**
 * Shortcut for logging server errors — always emits, never throws.
 */
async function trackServerError(err, context = {}) {
  try {
    const data = {
      message: err?.message ? String(err.message).slice(0, 500) : null,
      code: err?.code ? String(err.code).slice(0, 100) : null,
      stack: err?.stack ? String(err.stack).slice(0, 2000) : null,
      ...(typeof context === 'object' ? context : { context_raw: String(context ?? '').slice(0, 500) })
    };
    return insertAnalyticsEvent({ event_type: EVENT_TYPES.SERVER_ERROR, event_data: data });
  } catch {
    return null;
  }
}

module.exports = {
  EVENT_TYPES,
  insertAnalyticsEvent,
  insertSessionAnalyticsEvent,
  trackServerError
};
