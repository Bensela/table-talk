const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const sessionRoutes = require('./routes/sessionRoutes');
const adminRoutes = require('./routes/adminRoutes');
const publicRoutes = require('./routes/publicRoutes');
const { resolveRestaurant } = require('./middleware/resolveRestaurant');
const restaurantRoutes = require('./routes/restaurantRoutes');
const billingRoutes = require('./routes/billingRoutes');
const db = require('./db');
const deckService = require('./services/deckService');
const { insertAnalyticsEvent, EVENT_TYPES, trackServerError } = require('./services/analyticsService');

async function logSocketEvent(socket, eventType, extraData = {}) {
  if (!socket) return;
  const sessionId = socket.sessionId || extraData.session_id || null;
  const participantId = socket.participantId || extraData.participant_id || null;
  let restaurant_id = null;
  let table_token = null;
  if (sessionId) {
    try {
      const r = await db.query(
        `SELECT restaurant_id, table_token FROM sessions WHERE session_id = $1`,
        [sessionId]
      );
      if (r.rows && r.rows[0]) {
        restaurant_id = r.rows[0].restaurant_id;
        table_token = r.rows[0].table_token;
      }
    } catch (_) { /* ignore */ }
  }
  await insertAnalyticsEvent({
    session_id: sessionId,
    participant_id: participantId,
    restaurant_id,
    table_token,
    event_type: eventType,
    event_data: {
      role: socket.role || extraData.role || null,
      socket_id: socket.id || null,
      ...(extraData || {})
    }
  });
}

// Load environment variables
try {
  require('dotenv').config();
} catch (e) {
  console.log('No .env file found, relying on system environment variables');
}

process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err.message || err);
  try { trackServerError(err, { source: 'uncaughtException' }); } catch (_) {}
  if (!process.env.NO_EXIT_ON_FATAL) process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : JSON.stringify(reason || {}).slice(0, 400));
  console.error('[FATAL] unhandledRejection:', err.message || err);
  try { trackServerError(err, { source: 'unhandledRejection' }); } catch (_) {}
});

const { cleanupSessions } = require('./jobs/cleanup');

const DEFAULT_RESTAURANT_ID = 'd0000000-0000-0000-0000-000000000000';

// #region debug-point next-question-perf backend instrumentation (H2 | H5 | H1)
// Evidence-only reporter. Reports to local Debug Server (http://127.0.0.1:7777/event).
// Read env file for URL + session id when available.
const __dbgBackendEnv = (() => {
  try {
    const e = require('fs').readFileSync(require('path').join(process.cwd(), '..', '.dbg', 'next-question-perf.env'), 'utf8');
    return {
      url: e.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || 'http://127.0.0.1:7777/event',
      sid: e.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || 'next-question-perf'
    };
  } catch {
    return { url: 'http://127.0.0.1:7777/event', sid: 'next-question-perf' };
  }
})();
let __dbgSeq = 0;
const __dbgBackend = (hypothesisId, location, msg, data = {}, runId = 'pre-fix') => {
  try {
    const payload = JSON.stringify({
      sessionId: __dbgBackendEnv.sid,
      runId,
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data: { seq: ++__dbgSeq, ...data },
      ts: Date.now()
    });
    const u = new URL(__dbgBackendEnv.url);
    const req = require('http').request({
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 400
    });
    req.on('error', () => {});
    req.on('timeout', () => { try { req.destroy(); } catch {} });
    req.write(payload);
    req.end();
  } catch (_) { /* silent if debug server down */ }
};
// #endregion

const app = express();
const server = http.createServer(app);

function normalizePrefix(prefix) {
  if (!prefix) return '';
  const withLeadingSlash = prefix.startsWith('/') ? prefix : `/${prefix}`;
  return withLeadingSlash.replace(/\/$/, '');
}

const API_PREFIX = normalizePrefix(process.env.API_PREFIX);
const SOCKET_IO_PATH = `${API_PREFIX}/socket.io/`.replace(/^\/\//, '/');

const SETUP_LOCK_TTL_MS = 2 * 60 * 1000;

function isSetupLockExpired(lock) {
  if (!lock) return true;
  return Date.now() - lock.claimedAt > SETUP_LOCK_TTL_MS;
}

function clearSetupLockForTable(tableToken) {
  if (!tableToken) return;
  setupLocks.delete(tableToken);
  io.to(`setup_${tableToken}`).emit('setup_released');
}

function clearPendingContexts(sessionId) {
  if (!sessionId) return;
  const existing = pendingContexts.get(sessionId);
  if (existing && existing._cleanupTimer) {
    clearTimeout(existing._cleanupTimer);
    existing._cleanupTimer = null;
  }
  pendingContexts.delete(sessionId);
}
module.exports.clearPendingContexts = clearPendingContexts;

// Simplified flow: when only one side has pressed Start Fresh (single-sided), the
// remaining partner has exactly 20 seconds to either: (a) press Switch to Single Mode
// via the countdown modal, or (b) the dual session is auto-terminated server-side
// and the remaining partner is bounced to the QR scanner page. This matches how the
// app originally performed and removes all the "Menu→Single while partner still
// connected" race-condition behavior. Uses existing `fresh_intent_at` (no schema).
function armSingleFreshTimeout(sessionId) {
  if (!sessionId) return;
  const state = getSessionState(sessionId);
  if (state.singleFreshTimeoutTimer) {
    try { clearTimeout(state.singleFreshTimeoutTimer); } catch (_) {}
  }
  state.singleFreshTimeoutTimer = setTimeout(async () => {
    try {
      const r = await db.query(
        `SELECT fresh_intent_a, fresh_intent_b, dual_group_id, table_token, restaurant_id, mode, dual_status
         FROM sessions WHERE session_id = $1`,
        [sessionId]
      );
      const row = r.rows[0];
      if (!row) return;
      const onlyOnePressed = Boolean(row.fresh_intent_a) !== Boolean(row.fresh_intent_b);
      if (!onlyOnePressed) {
        // Mutual or none — timer has nothing to do
        return;
      }
      // 20 seconds have elapsed since first Start Fresh press; terminate the dual session
      // server-side and bounce the remaining partner out.
      await db.query(`UPDATE sessions SET dual_status = 'ended', expires_at = NOW() WHERE session_id = $1`, [sessionId]);
      if (row.dual_group_id) {
        try { await db.query(`UPDATE dual_groups SET terminated_at = NOW() WHERE dual_group_id = $1`, [row.dual_group_id]); } catch (_) {}
        try { await db.query(`UPDATE sessions SET dual_status = 'ended', expires_at = NOW() WHERE dual_group_id = $1`, [row.dual_group_id]); } catch (_) {}
      }
      if (row.table_token) {
        try { clearSetupLockForTable(row.table_token); } catch (_) {}
      }
      clearSessionState(sessionId);
      clearPendingContexts(sessionId);
      try {
        await insertAnalyticsEvent({
          session_id: sessionId,
          restaurant_id: row.restaurant_id || null,
          table_token: row.table_token || null,
          event_type: 'session_end',
          event_data: { reason: 'single_fresh_20s_timeout', dual_group_id: row.dual_group_id || null }
        });
      } catch (_) {}
      io.to(sessionId).emit('single_fresh_timeout');
    } catch (_) {}
  }, 20 * 1000);
}
module.exports.armSingleFreshTimeout = armSingleFreshTimeout;

// --- CORS Configuration ---
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "https://september-internation-overelliptically.ngrok-free.dev",
  "https://sea-lion-app-6mjje.ondigitalocean.app",
  "https://orca-app-be8he.ondigitalocean.app",
  "https://octopus-app-ibal3.ondigitalocean.app",
  "https://stingray-app-hauxl.ondigitalocean.app"
];

if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const isWhitelisted = allowedOrigins.includes(origin);
    const isNgrok = origin.endsWith('.ngrok-free.dev');
    const isLocal = origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1');

    if (isWhitelisted || isNgrok || isLocal) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Request from non-whitelisted origin: ${origin}`);
      callback(null, true); // Set to false in strict production
    }
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  credentials: true
};

// --- Socket.io Setup ---
const io = new Server(server, {
  path: SOCKET_IO_PATH,
  cors: corsOptions,
  transports: ["websocket", "polling"], // Allow polling fallback for stability
  pingTimeout: 30000,
  pingInterval: 10000
});

io.on('error', (err) => {
  console.error('[IO-ERROR] Socket.IO engine error:', err.message || err);
  insertAnalyticsEvent({
    event_type: EVENT_TYPES.SOCKET_ERROR,
    event_data: {
      source: 'io.engine.error',
      message: err && err.message ? String(err.message).slice(0, 400) : String(err || '').slice(0, 400),
      code: err && err.code ? String(err.code) : null
    }
  }).catch(() => null);
});

// Initial Jobs
(async () => {
  try {
    await insertAnalyticsEvent({
      event_type: EVENT_TYPES.CLEANUP_JOB_STARTED,
      event_data: { source: 'boot_initial', scheduled: false }
    }).catch(() => null);
    await cleanupSessions('boot_initial');
  } catch (err) {
    console.error('[BOOT-CLEANUP] Failed:', err && err.message ? err.message : err);
    try {
      await insertAnalyticsEvent({
        event_type: EVENT_TYPES.CLEANUP_JOB_ERROR,
        event_data: {
          source: 'boot_initial',
          scheduled: false,
          message: err && err.message ? String(err.message).slice(0, 800) : String(err || '').slice(0, 800),
          stack: err && err.stack ? String(err.stack).slice(0, 2000) : null
        }
      });
    } catch (_) { /* swallow */ }
  }
})();

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors(corsOptions));

// Stripe webhook needs the raw payload to verify signatures.
app.use('/billing/stripe/webhook', express.raw({ type: '*/*', limit: '2mb' }));
app.use((req, _res, next) => {
  if (req.originalUrl === '/api/billing/stripe/webhook') {
    return express.raw({ type: '*/*', limit: '2mb' })(req, _res, next);
  }
  next();
});
app.use(express.json());

// Logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// --- API & Static Routes ---
app.use('/sessions', sessionRoutes);
app.use('/admin', adminRoutes);
app.use('/tenant', adminRoutes);
app.use('/public', publicRoutes);
app.use('/billing', billingRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tenant', adminRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/billing', billingRoutes);
if (API_PREFIX && API_PREFIX !== '/api') {
  app.use(`${API_PREFIX}/sessions`, sessionRoutes);
  app.use(`${API_PREFIX}/admin`, adminRoutes);
  app.use(`${API_PREFIX}/tenant`, adminRoutes);
  app.use(`${API_PREFIX}/public`, publicRoutes);
  app.use(`${API_PREFIX}/billing`, billingRoutes);
}

// Restaurant admin routes
app.use('/restaurants', restaurantRoutes);
if (API_PREFIX) {
  app.use(`${API_PREFIX}/restaurants`, restaurantRoutes);
}

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});
if (API_PREFIX) {
  app.get(`${API_PREFIX}/health`, (req, res) => {
    res.status(200).json({ status: 'ok' });
  });
}

// Serve Static Frontend
const frontendPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendPath));

// Catch-all to serve React App
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// --- Socket Logic State ---
const sessionStates = new Map();
const pendingContexts = new Map();
const setupLocks = new Map();

function getSessionState(sessionId) {
  if (!sessionStates.has(sessionId)) {
    sessionStates.set(sessionId, {
      ready: new Map(),
      answers: new Map(),
      nextIntent: new Set(),
      advanceIntent: new Set(),
      revealUnstickTimer: null,
      nextIntentUnstickTimer: null,
      advanceIntentUnstickTimer: null,
      singleFreshTimeoutTimer: null
    });
  }
  return sessionStates.get(sessionId);
}

function clearSessionState(sessionId) {
  const state = sessionStates.get(sessionId);
  if (state) {
    state.ready.clear();
    state.answers.clear();
    state.nextIntent.clear();
    state.advanceIntent.clear();
    for (const f of ['revealUnstickTimer','nextIntentUnstickTimer','advanceIntentUnstickTimer','singleFreshTimeoutTimer']) {
      if (state[f]) {
        try { clearTimeout(state[f]); } catch (_) {}
        state[f] = null;
      }
    }
  }
}

// HTTP-readable snapshot of the live in-memory socket state for a session. Used
// by sessionController.getSessionState so reconnected clients (or HTTP reconcile
// poll clients) can restore next_intent_count / advance_intent_count / ready_count
// / conversation_started even when websocket events were dropped (Firefox mid-
// unload, app backgrounded, device lock, or server restart fallback).
function getSessionStateSnapshot(sessionId) {
  if (!sessionId) return null;
  const state = sessionStates.get(sessionId);
  if (!state) {
    return {
      nextIntentCount: 0,
      advanceIntentCount: 0,
      readyCount: 0,
      conversationStarted: false
    };
  }
  const readyCount = state.ready.size;
  const nextIntentCount = state.nextIntent.size;
  const advanceIntentCount = state.advanceIntent.size;
  // IMPORTANT: conversationStarted = nextIntentCount >= 2 ONLY.
  // DO NOT OR with advanceIntentCount >= 1 (previous bug)!
  // Because after clearSessionState zeroes both Sets for the NEW question,
  // having advanceIntentCount in this OR caused "conversationStarted=true"
  // to be computed during the 10-50ms race window between advance_question
  // broadcast and clearSessionState actually clearing the Sets (async).
  // This propagated to the frontend via HTTP reconcile AND join_session
  // reconnect_replay → stuck conversationStarted=true permanently.
  const conversationStarted = (nextIntentCount >= 2);
  return {
    nextIntentCount: Number(nextIntentCount) || 0,
    advanceIntentCount: Number(advanceIntentCount) || 0,
    readyCount: Number(readyCount) || 0,
    conversationStarted: Boolean(conversationStarted)
  };
}
module.exports.getSessionStateSnapshot = getSessionStateSnapshot;
module.exports.clearSessionState = clearSessionState;
module.exports.getSessionState = getSessionState;
// #region fix H4:reconcile-stale-counts — attach snapshot to global so sessionController
// can always reach it regardless of require.main being overridden (Vite proxy reload,
// worker threads, or test harness that overwrite require.main).
try {
  global.__tableTalkSessionStateSnapshot = getSessionStateSnapshot;
} catch (_) { /* ignore */ }
// #endregion

// Resolve socket.role + socket.participantId for a given session, falling back to a
// DB lookup when the socket object lost its role during reconnect/remount. If role
// still cannot be determined, returns null (caller should early-return / ignore).
async function resolveSocketRole(socket, fallbackParticipantId = null, fallbackSessionId = null) {
  const sessionId = socket.sessionId || fallbackSessionId;
  const participantId = socket.participantId || fallbackParticipantId;
  if (!sessionId || !participantId) return null;
  if (socket.role) return socket.role;
  try {
    const r = await db.query(
      `SELECT role FROM session_participants WHERE session_id = $1 AND participant_id = $2 LIMIT 1`,
      [sessionId, participantId]
    );
    const role = r.rows[0]?.role;
    if (role) {
      socket.role = role;
      if (!socket.sessionId) socket.sessionId = sessionId;
      if (!socket.participantId) socket.participantId = participantId;
    }
    return role || null;
  } catch (_) {
    return socket.role || null;
  }
}

// --- Socket Events ---
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('error', (err) => {
    console.error('[SOCKET-ERROR] socket error on', socket.id, ':', err && err.message ? err.message : err);
    insertAnalyticsEvent({
      event_type: EVENT_TYPES.SOCKET_ERROR,
      event_data: {
        source: 'socket.error',
        socket_id: socket.id || null,
        message: err && err.message ? String(err.message).slice(0, 400) : String(err || '').slice(0, 400),
        code: err && err.code ? String(err.code) : null
      }
    }).catch(() => null);
  });

  socket.on('connect_error', (err) => {
    console.error('[SOCKET-CONNECT-ERROR] on', socket.id, ':', err && err.message ? err.message : err);
    insertAnalyticsEvent({
      event_type: EVENT_TYPES.RECONNECT_FAILED,
      event_data: {
        source: 'socket.connect_error',
        socket_id: socket.id || null,
        message: err && err.message ? String(err.message).slice(0, 400) : String(err || '').slice(0, 400),
        code: err && err.code ? String(err.code) : null
      }
    }).catch(() => null);
  });

  socket.on('join_session', async ({ session_id, participant_id }) => {
    if (!session_id || !participant_id) return;

    try {
      const roomBefore = io.sockets.adapter.rooms.get(session_id);
      const sizeBefore = roomBefore ? roomBefore.size : 0;

      const participantResult = await db.query(`
        SELECT p.participant_id, p.role, s.mode, s.dual_status, s.expires_at,
               p.disconnected_at AS prev_disconnected_at,
               s.restaurant_id, s.table_token
        FROM session_participants p
        JOIN sessions s ON p.session_id = s.session_id
        WHERE p.participant_id = $1 AND s.session_id = $2
      `, [participant_id, session_id]);

      if (participantResult.rows.length === 0) return;

      const pData = participantResult.rows[0];
      if (pData.dual_status === 'ended' || new Date(pData.expires_at) <= new Date()) {
        socket.emit('error', { message: 'Session expired' });
        return;
      }

      // Defense-in-depth: if this is a dual-phone session with a single-sided Start
      // Fresh that was pressed MORE than 20 seconds ago (user closed browser, app
      // backgrounded, server restarted mid-timer, etc.), treat the session as auto-
      // terminated and bounce the reconnecting partner out to the QR scanner. Uses
      // existing fresh_intent_at column (no schema).
      if (pData.mode === 'dual-phone') {
        const timeoutCheck = await db.query(
          `SELECT fresh_intent_a, fresh_intent_b, fresh_intent_at, dual_group_id, table_token, restaurant_id
           FROM sessions WHERE session_id = $1`,
          [session_id]
        );
        const tf = timeoutCheck.rows[0];
        const onlyOne = tf && (Boolean(tf.fresh_intent_a) !== Boolean(tf.fresh_intent_b));
        const over20s = tf && tf.fresh_intent_at && (Date.now() - new Date(tf.fresh_intent_at).getTime() >= 20 * 1000);
        if (onlyOne && over20s) {
          try {
            await db.query(`UPDATE sessions SET dual_status = 'ended', expires_at = NOW() WHERE session_id = $1`, [session_id]);
            if (tf.dual_group_id) {
              try { await db.query(`UPDATE dual_groups SET terminated_at = NOW() WHERE dual_group_id = $1`, [tf.dual_group_id]); } catch (_) {}
              try { await db.query(`UPDATE sessions SET dual_status = 'ended', expires_at = NOW() WHERE dual_group_id = $1`, [tf.dual_group_id]); } catch (_) {}
            }
            if (tf.table_token) { try { clearSetupLockForTable(tf.table_token); } catch (_) {} }
            clearSessionState(session_id);
            clearPendingContexts(session_id);
            try {
              await insertAnalyticsEvent({
                session_id,
                restaurant_id: tf.restaurant_id || null,
                table_token: tf.table_token || null,
                event_type: 'session_end',
                event_data: { reason: 'single_fresh_20s_timeout_on_join', dual_group_id: tf.dual_group_id || null }
              });
            } catch (_) {}
          } catch (_) {}
          socket.emit('single_fresh_timeout');
          socket.emit('error', { message: 'Session timed out (partner did not respond to Start Fresh). Please scan the QR again.' });
          return;
        } else if (onlyOne && !over20s) {
          // Rejoin inside the 20s window: re-arm 20s timer in case the earlier
          // in-memory setTimeout was lost (server restart).
          armSingleFreshTimeout(session_id);
          if (pData.dual_status === 'waiting') {
            const remaining = Math.max(0, 20 - Math.floor((Date.now() - new Date(tf.fresh_intent_at).getTime()) / 1000));
            socket.emit('session_updated', { dual_status: 'waiting', waiting_reason: 'partner_fresh', mode: 'dual-phone', seconds_remaining: remaining });
          }
        }
      }

      const wasDisconnected = Boolean(pData.prev_disconnected_at);

      await db.query(`UPDATE session_participants SET disconnected_at = NULL, last_seen_at = NOW() WHERE participant_id = $1`, [participant_id]);

      socket.join(session_id);
      // #region debug-point H2:bg-fg-rejoin-room
      const roomsAfter = io.sockets.adapter.sids.get(socket.id);
      const sizeAfter = (io.sockets.adapter.rooms.get(session_id) || new Set()).size;
      __dbgBackend('H2', 'index.js:join_session', 'socket joined session room', {
        socket_id: socket.id,
        sid: session_id,
        pid: participant_id,
        role: pData.role,
        mode: pData.mode,
        size_before: sizeBefore,
        size_after: sizeAfter,
        was_disconnected: wasDisconnected,
        rooms_for_socket: roomsAfter ? [...roomsAfter].slice(0, 10) : []
      });
      // #endregion
      socket.participantId = participant_id;
      socket.sessionId = session_id;
      socket.role = pData.role;

      // Re-sync live intents to a reconnected socket so it does NOT regress back
      // to Phase 1 ("I'm Ready") when conversation_started / next/advance intents
      // were already set on the partner's side (Firefox mid-unload / backgrounding
      // drops socket events, the reconnect path must re-emit them).
      const snap = getSessionStateSnapshot(session_id);
      if (pData.mode === 'dual-phone' && snap) {
        // Ready / advance / next counts: each socket listener in the frontend uses
        // these counts to restore its local state button to "Next Question" instead
        // of stale "I'm Ready".
        if (snap.readyCount > 0) {
          socket.emit('ready_status_update', {
            participant_id: socket.participantId,
            role: socket.role,
            ready_count: snap.readyCount,
            ready: snap.readyCount >= 1
          });
        }
        socket.emit('next_intent_update', {
          count: snap.nextIntentCount,
          required: 2,
          selfRole: socket.role,
          reconnect_replay: true
        });
        socket.emit('advance_intent_update', {
          count: snap.advanceIntentCount,
          required: 2,
          selfRole: socket.role,
          reconnect_replay: true
        });
        // If conversation already reached "Started" on both (next >= 2) OR there
        // has been any advance intent at all, replay conversation_start to the
        // rejoining socket so its button does NOT revert to "I'm Ready".
        if (snap.conversationStarted) {
          socket.emit('conversation_start', { reconnect_replay: true });
        }
      }

      // Sync Partner Status
      const room = io.sockets.adapter.rooms.get(session_id);
      io.to(session_id).emit('partner_status', { 
        status: (room?.size || 0) >= 2 ? 'connected' : 'waiting' 
      });

      if (pData.mode === 'dual-phone') {
        const sizeAfter = room ? room.size : 0;
        if (pData.dual_status === 'waiting' && sizeAfter >= 2) {
          const upd = await db.query(
            `UPDATE sessions SET dual_status = 'paired' WHERE session_id = $1 AND dual_status = 'waiting' RETURNING dual_status`,
            [session_id]
          );
          if (upd.rowCount > 0) {
            io.to(session_id).emit('session_updated', { dual_status: 'paired' });
          }
        }
        if (sizeBefore < 2 && sizeAfter >= 2) {
          io.to(session_id).emit('dual_partner_joined', {
            participant_id,
            joined_role: socket.role
          });
          await logSocketEvent(socket, 'waiting_partner_ended', {
            ended_role: socket.role,
            restaurant_id: pData.restaurant_id,
            table_token: pData.table_token
          });
        } else if (wasDisconnected) {
          await logSocketEvent(socket, 'partner_reconnected', {
            reconnect_ms: pData.prev_disconnected_at
              ? Math.max(0, Date.now() - new Date(pData.prev_disconnected_at).getTime())
              : null,
            restaurant_id: pData.restaurant_id,
            table_token: pData.table_token
          });
        }
      }

      // Defense-in-depth for dual-phone: if a 3rd socket is somehow joining
      // (slot leak from reclaim race or direct socket reuse), boot it. Checks
      // actual DB count not in-memory room size so transient reconnects don't
      // falsely boot a valid player returning.
      if (pData.mode === 'dual-phone') {
        const activeCnt = await db.query(`
          SELECT COUNT(*)::int AS c FROM session_participants
          WHERE session_id = $1 AND disconnected_at IS NULL
          GROUP BY session_id
        `, [session_id]);
        const c = activeCnt.rows[0]?.c ?? 0;
        if (c > 2) {
          // More than 2 active in DB — kick this newly joining participant
          // (unless it was already previously known-disconnected and just
          // reconnecting). Only kick if its role caused c > 2.
          const roleCount = await db.query(`
            SELECT COUNT(*)::int AS c FROM session_participants
            WHERE session_id = $1 AND role = $2 AND disconnected_at IS NULL
          `, [session_id, pData.role]);
          const rc = roleCount.rows[0]?.c ?? 0;
          if (rc > 1 || c > 2) {
            await db.query(
              `UPDATE session_participants SET disconnected_at = NOW()
               WHERE participant_id = $1`,
              [participant_id]
            );
            socket.emit('error', { message: 'SESSION_FULL: 2 participants are already paired for this table. Please scan the QR again to start your own session.' });
            socket.leave(session_id);
            socket.sessionId = null;
            return;
          }
        }
      }

      await logSocketEvent(socket, 'socket_joined_session', {
        mode: pData.mode,
        dual_status: pData.dual_status,
        restaurant_id: pData.restaurant_id,
        table_token: pData.table_token
      });

    } catch (err) {
      console.error('Join Error:', err);
    }
  });

  // Dual-Phone: Readiness Ritual
  socket.on('ready_toggled', async (data) => {
    if (!socket.sessionId) return;
    const role = await resolveSocketRole(socket);
    if (!role) return;
    const state = getSessionState(socket.sessionId);
    state.ready.set(role, data.ready);
    
    io.to(socket.sessionId).emit('ready_status_update', { 
      participant_id: socket.participantId, 
      role,
      ready: data.ready 
    });

    await logSocketEvent(socket, 'ready_toggled', { ready: Boolean(data?.ready) });

    if (state.ready.size >= 2 && Array.from(state.ready.values()).every(r => r)) {
      io.to(socket.sessionId).emit('both_ready');
      await logSocketEvent(socket, 'both_ready_sync_fired', {});
    }
  });

  // Dual-Phone: Reveal Logic
  socket.on('answer_submitted', async ({ selectionId }) => {
    if (!socket.sessionId || !socket.participantId) return;
    const role = await resolveSocketRole(socket);
    const state = getSessionState(socket.sessionId);
    state.answers.set(String(socket.participantId), {
      participantId: socket.participantId,
      role: role || null,
      optionId: selectionId
    });

    await logSocketEvent(socket, 'answer_submitted', { has_selection: Boolean(selectionId) });

    // Use deduped unique participantId UUIDs as the count source of truth, not Map.size,
    // because Map never shrinks during question (only cleared on advance). Also count
    // distinct roles (A + B) as a robust alternate source of truth across reconnects.
    const uniquePids = new Set();
    for (const val of state.answers.values()) {
      if (val.participantId) uniquePids.add(String(val.participantId));
    }
    const uniqueParticipants = uniquePids.size;
    const roleKeys = new Set();
    for (const val of state.answers.values()) {
      if (val.role) roleKeys.add(String(val.role));
    }
    const bothRoles = roleKeys.has('A') && roleKeys.has('B');
    if (uniqueParticipants >= 2 || bothRoles) {
      const selections = {};
      state.answers.forEach(val => {
        if (val.participantId && val.optionId) {
          selections[String(val.participantId)] = val.optionId;
        }
      });
      io.to(socket.sessionId).emit('reveal_answers', { selections });
      await logSocketEvent(socket, 'reveal_answers', {});
    } else {
      socket.to(socket.sessionId).emit('partner_answered', { role: role || null, participantId: socket.participantId });
      // Safety unstick: if no reveal occurred within 18s of this submission (e.g. partner backgrounded),
      // broadcast reveal with what we have so users are not stuck on "Waiting for your partner".
      const unstickAt = Date.now() + 18 * 1000;
      const sid = socket.sessionId;
      if (!state.revealUnstickTimer) {
        state.revealUnstickTimer = setTimeout(async () => {
          try {
            const cur = getSessionState(sid);
            // If already revealed and cleared by advance, skip
            if (!cur || cur.answers.size === 0) return;
            const curPids = new Set();
            for (const v of cur.answers.values()) if (v.participantId) curPids.add(String(v.participantId));
            const curCount = curPids.size;
            const curRoles = new Set();
            for (const v of cur.answers.values()) if (v.role) curRoles.add(String(v.role));
            const curBoth = curRoles.has('A') && curRoles.has('B');
            if (curCount >= 2 || curBoth || (curCount >= 1 && Date.now() >= unstickAt - 1)) {
              const selections = {};
              cur.answers.forEach(val => {
                if (val.participantId && val.optionId) selections[String(val.participantId)] = val.optionId;
              });
              if (Object.keys(selections).length > 0) {
                io.to(sid).emit('reveal_answers', { selections });
              }
            }
          } catch (_) {}
        }, 18 * 1000);
      }
    }
  });

  socket.on('reveal_answer', async ({ sessionId, question_id } = {}) => {
    const sid = sessionId || socket.sessionId;
    if (!sid) return;
    socket.to(sid).emit('answer_revealed', { question_id, role: socket.role });
    await logSocketEvent(socket, 'answer_revealed', { question_id: question_id || null });
  });

  socket.on('partner_switched_mode', async ({ newMode } = {}) => {
    if (!socket.sessionId) return;
    // Defensive: resolve role for logging reliability across reconnect; this handler
    // doesn't use role but helps us audit when mode switch races reconnection.
    await resolveSocketRole(socket);
    // Clear any pending context intents (if partner was mid-way through an unconfirmed
    // context change, discarding them keeps the new mode/session clean and avoids
    // "Change Deck?" modals appearing after user has already switched to Single/Dual).
    clearPendingContexts(socket.sessionId);
    socket.to(socket.sessionId).emit('partner_switched_mode', { newMode });
    await logSocketEvent(socket, 'menu_mode_reset', { new_mode: newMode || null });
  });

  // Turn Advancement
  socket.on('dual_next_intent', async () => {
    if (!socket.sessionId) return;
    const role = await resolveSocketRole(socket);
    // Null role → ignore, don't add a Set entry with 'null' that would only be one
    if (!role) {
      // #region debug-point H5:idempotency-missing | H2:role-null-after-reconnect
      __dbgBackend('H5', 'index.js:dual_next_intent', 'dual_next_intent ignored because resolveSocketRole returned null (reconnect race window)', {
        socket_id: socket.id, sid: socket.sessionId, pid: socket.participantId || null
      });
      // #endregion
      return;
    }
    const state = getSessionState(socket.sessionId);
    const hadRoleBefore = state.nextIntent.has(role);
    if (hadRoleBefore) {
      __dbgBackend('H5', 'index.js:dual_next_intent:duplicate', 'IDEMPOTENCY GUARD DROPPED duplicate dual_next_intent packet (role already counted)', {
        sid: socket.sessionId, pid: socket.participantId || null, role, current_count: state.nextIntent.size
      });
      return;
    }
    state.nextIntent.add(role);
    const count = state.nextIntent.size;
    __dbgBackend('H5', 'index.js:dual_next_intent', 'BE processed dual_next_intent (first-seen packet, counted)', {
      sid: socket.sessionId,
      pid: socket.participantId || null,
      role,
      had_role_before: false,
      count_after_add: count,
      ts: Date.now()
    });
    io.to(socket.sessionId).emit('next_intent_update', { count, required: 2, selfRole: role });
    await logSocketEvent(socket, 'next_question_intent', {
      count,
      required: 2
    });
    if (state.nextIntent.size >= 2) {
      io.to(socket.sessionId).emit('conversation_start');
      await logSocketEvent(socket, 'conversation_start', {});
    } else {
      // Safety unstick: if partner hasn't responded in 12s, auto-send
      // conversation_start so users are never left on a permanently stuck
      // "Waiting for partner" ready-intent screen (e.g. partner's socket lost
      // role during reconnect and never sent its intent to the server).
      if (!state.nextIntentUnstickTimer) {
        const sid = socket.sessionId;
        state.nextIntentUnstickTimer = setTimeout(async () => {
          try {
            const cur = getSessionState(sid);
            if (!cur) return;
            // Only fire if we still haven't reached 2 clicks (nothing advanced).
            if (cur.nextIntent.size < 2) {
              io.to(sid).emit('conversation_start');
              await logSocketEvent(socket, 'conversation_start', { unstick: true });
            }
          } catch (_) {}
        }, 12 * 1000);
      }
    }
  });

  socket.on('advance_turn', async () => {
    if (!socket.sessionId) return;
    const role = await resolveSocketRole(socket);
    if (!role) {
      // #region debug-point H5:idempotency | H2:role-null-after-reconnect
      __dbgBackend('H5', 'index.js:advance_turn', 'advance_turn ignored because resolveSocketRole returned null (reconnect race window)', {
        socket_id: socket.id, sid: socket.sessionId, pid: socket.participantId || null
      });
      // #endregion
      return;
    }
    const state = getSessionState(socket.sessionId);
    const hadRoleBefore = state.advanceIntent.has(role);
    if (hadRoleBefore) {
      __dbgBackend('H5', 'index.js:advance_turn:duplicate', 'IDEMPOTENCY GUARD DROPPED duplicate advance_turn packet (role already counted)', {
        sid: socket.sessionId, pid: socket.participantId || null, role, current_count: state.advanceIntent.size
      });
      return;
    }
    state.advanceIntent.add(role);
    const turnCount = state.advanceIntent.size;
    __dbgBackend('H5', 'index.js:advance_turn', 'BE processed advance_turn (first-seen packet, counted)', {
      sid: socket.sessionId,
      pid: socket.participantId || null,
      role,
      had_role_before: false,
      turn_count_after: turnCount
    });
    io.to(socket.sessionId).emit('advance_intent_update', { count: turnCount, required: 2, selfRole: role });
    await logSocketEvent(socket, 'advance_turn_intent', {
      count: turnCount,
      required: 2
    });
    if (state.advanceIntent.size >= 2) {
      const res = await db.query('SELECT * FROM sessions WHERE session_id = $1', [socket.sessionId]);
      if (res.rows[0]) {
        await deckService.advanceDeck(res.rows[0]);
        clearSessionState(socket.sessionId);
        io.to(socket.sessionId).emit('advance_question');
        await logSocketEvent(socket, 'both_ready_advance_fired', {
          context: res.rows[0].context || null,
          mode: res.rows[0].mode || null
        });
      }
    } else {
      socket.to(socket.sessionId).emit('partner_waiting_to_advance');
      // 12s safety unstick for next-question advance: same pattern as above.
      if (!state.advanceIntentUnstickTimer) {
        const sid = socket.sessionId;
        state.advanceIntentUnstickTimer = setTimeout(async () => {
          try {
            const cur = getSessionState(sid);
            if (!cur) return;
            if (cur.advanceIntent.size < 2) {
              const r = await db.query('SELECT * FROM sessions WHERE session_id = $1', [sid]);
              if (r.rows[0]) {
                await deckService.advanceDeck(r.rows[0]);
                clearSessionState(sid);
                io.to(sid).emit('advance_question');
                await logSocketEvent(socket, 'both_ready_advance_fired', {
                  unstick: true,
                  context: r.rows[0].context || null,
                  mode: r.rows[0].mode || null
                });
              }
            }
          } catch (_) {}
        }, 12 * 1000);
      }
    }
  });

  // Open-ended hint tap-to-reveal sync
  socket.on('hint_tap_reveal', async (payload = {}) => {
    if (!socket.sessionId) return;
    io.to(socket.sessionId).emit('hint_tap_revealed', {
      byRole: socket.role,
      question_id: payload.question_id || null
    });
    await logSocketEvent(socket, 'hint_revealed', {
      question_id: payload.question_id || null
    });
  });

  // Termination Logic
  socket.on('fresh_intent', async (payload = {}) => {
    const sessionId = payload.session_id || socket.sessionId;
    const participantId = payload.participant_id || socket.participantId;
    if (!sessionId) return;

    // Cancel any in-flight context change first (workflow cleanup). Either party
    // pressing Start Fresh means an unconfirmed context request should not follow
    // them into a rejoin or a new session.
    clearPendingContexts(sessionId);

    // Resolve role via shared helper (falls back to DB lookup across reconnect windows
    // where socket.role may still be null for ~100-300ms after connect).
    const role = await resolveSocketRole(socket, participantId, sessionId);
    if (!role) return;

    const field = role === 'A' ? 'fresh_intent_a' : 'fresh_intent_b';
    const result = await db.query(
      `UPDATE sessions 
       SET ${field} = TRUE, fresh_intent_at = COALESCE(fresh_intent_at, NOW())
       WHERE session_id = $1
       RETURNING fresh_intent_a, fresh_intent_b, table_token, dual_group_id, mode, dual_status, restaurant_id`,
      [sessionId]
    );

    socket.to(sessionId).emit('partner_requested_fresh', { role });

    const row = result.rows[0];
    await logSocketEvent(socket, 'start_fresh_pressed', {
      outcome: 'pressed',
      role,
      both_pressed: Boolean(row?.fresh_intent_a && row?.fresh_intent_b),
      restaurant_id: row?.restaurant_id,
      table_token: row?.table_token,
      session_id: sessionId,
      participant_id: participantId
    });

    if (row?.fresh_intent_a && row?.fresh_intent_b) {
      // Mutual Start Fresh: cancel any single-sided 20s timer (it was set on first press)
      const state = getSessionState(sessionId);
      if (state.singleFreshTimeoutTimer) {
        try { clearTimeout(state.singleFreshTimeoutTimer); } catch (_) {}
        state.singleFreshTimeoutTimer = null;
      }
      await db.query(`UPDATE sessions SET dual_status = 'ended', expires_at = NOW() WHERE session_id = $1`, [sessionId]);
      if (row.dual_group_id) {
        await db.query(`UPDATE dual_groups SET terminated_at = NOW() WHERE dual_group_id = $1`, [row.dual_group_id]);
        await db.query(`UPDATE sessions SET dual_status = 'ended', expires_at = NOW() WHERE dual_group_id = $1`, [row.dual_group_id]);
      }
      if (row.table_token) clearSetupLockForTable(row.table_token);
      clearSessionState(sessionId);
      clearPendingContexts(sessionId);
      io.to(sessionId).emit('dual_group_terminated');
      await insertAnalyticsEvent({
        session_id: sessionId,
        restaurant_id: row.restaurant_id,
        table_token: row.table_token,
        event_type: 'session_end',
        event_data: { reason: 'dual_mutual_fresh', dual_group_id: row.dual_group_id || null }
      });
    } else {
      // Single-sided Start Fresh: always lock the session into 'waiting' state for any
      // in-progress dual-phone session that hasn't ended. Previously required dual_status
      // to be exactly 'paired', which could be skipped if a single→dual upgraded session
      // raced with the partner join (e.g. upgrade reload + partner resolveSession both
      // writing dual_status), leaving Start Fresh with no "Waiting for Partner" UI
      // on the partner device even though both phones were actively playing together.
      if (row?.mode === 'dual-phone' && row?.dual_status !== 'ended') {
        await db.query(`UPDATE sessions SET dual_status = 'waiting' WHERE session_id = $1`, [sessionId]);
        io.to(sessionId).emit('session_updated', { dual_status: 'waiting', waiting_reason: 'partner_fresh', mode: 'dual-phone', seconds_remaining: 20 });
        // Simplified flow: arm 20s auto-termination timer on server. If the remaining
        // partner has not switched to Single Mode within 20 seconds, the session is
        // terminated server-side and the remaining partner is bounced to QR scanner.
        armSingleFreshTimeout(sessionId);
        await insertAnalyticsEvent({
          session_id: sessionId,
          participant_id: participantId,
          restaurant_id: row.restaurant_id,
          table_token: row.table_token,
          event_type: 'session_end_wait',
          event_data: {
            reason: 'start_fresh_single_side',
            waiting_partner: role === 'A' ? 'B' : 'A',
            dual_status: 'waiting',
            auto_timeout_seconds: 20
          }
        });
      }
    }
  });

  socket.on('disconnect', async () => {
    if (socket.participantId) {
      await db.query(`UPDATE session_participants SET disconnected_at = NOW() WHERE participant_id = $1`, [socket.participantId]);
      io.to(socket.sessionId).emit('partner_disconnected', { role: socket.role });
      await logSocketEvent(socket, 'partner_disconnected', {
        disconnect_reason: 'socket_disconnect'
      });
    }
  });

  socket.on('join_table_setup', ({ tableToken, lockToken } = {}) => {
    if (!tableToken) return;
    socket.join(`setup_${tableToken}`);

    const current = setupLocks.get(tableToken);
    if (!current || isSetupLockExpired(current)) {
      setupLocks.delete(tableToken);
      socket.emit('setup_status', { status: 'available' });
      return;
    }

    if (lockToken && current.lockToken === lockToken) {
      socket.emit('setup_status', { status: 'granted' });
      return;
    }

    socket.emit('setup_status', { status: 'busy' });
  });

  socket.on('claim_setup', ({ tableToken, lockToken } = {}, callback) => {
    if (!tableToken) return;
    const cb = typeof callback === 'function' ? callback : () => {};

    const current = setupLocks.get(tableToken);
    if (!current || isSetupLockExpired(current)) {
      const newToken = crypto.randomBytes(16).toString('hex');
      setupLocks.set(tableToken, { lockToken: newToken, claimedAt: Date.now() });
      io.to(`setup_${tableToken}`).emit('setup_claimed', { tableToken, lockToken: newToken });
      cb({ status: 'granted', lockToken: newToken });
      return;
    }

    if (lockToken && current.lockToken === lockToken) {
      cb({ status: 'granted', lockToken: current.lockToken });
      return;
    }

    cb({ status: 'busy' });
  });

  socket.on('release_setup', ({ tableToken, lockToken } = {}, callback) => {
    if (!tableToken) return;
    const cb = typeof callback === 'function' ? callback : () => {};
    const current = setupLocks.get(tableToken);
    if (current && lockToken && current.lockToken === lockToken) {
      setupLocks.delete(tableToken);
      io.to(`setup_${tableToken}`).emit('setup_released');
      cb({ status: 'released' });
      return;
    }
    cb({ status: 'ignored' });
  });

  socket.on('setup_completed', ({ tableToken, mode, sessionId } = {}) => {
    if (!tableToken) return;
    clearSetupLockForTable(tableToken);
    io.to(`setup_${tableToken}`).emit('setup_completed', { tableToken, mode, sessionId });
  });

  socket.on('context_switch_intent', async ({ context } = {}) => {
    const sessionId = socket.sessionId;
    if (!sessionId || !context) return;

    // FLOW #3 root cause fix: resolve role via helper instead of inline select so
    // a reconnecting partner whose socket.role is null for ~100-300ms still writes
    // to the correct A/B slot instead of a "null" slot, ensuring the mutual-match
    // check (next.A === next.B) actually fires when both confirm same context.
    const role = await resolveSocketRole(socket, socket.participantId, sessionId);
    if (!role) return;

    const prevRaw = pendingContexts.get(sessionId);
    const prev = prevRaw ? { A: prevRaw.A, B: prevRaw.B } : { A: null, B: null };
    const next = { ...prev, [role]: context };

    // Arm a 60s garbage-collection timer the first time an intent is stored for
    // this session. Stale entries leak memory if partner backgrounds the app
    // without confirming or cancelling. We clear the timer ourselves when the
    // intent either commits (both agree) or fully cancels.
    if (!prevRaw) {
      next._cleanupTimer = setTimeout(() => {
        const cur = pendingContexts.get(sessionId);
        if (cur && cur._cleanupTimer) {
          clearTimeout(cur._cleanupTimer);
        }
        pendingContexts.delete(sessionId);
        io.to(sessionId).emit('context_switch_cancelled');
      }, 60 * 1000);
    } else if (prevRaw._cleanupTimer) {
      next._cleanupTimer = prevRaw._cleanupTimer;
    }
    pendingContexts.set(sessionId, next);

    socket.to(sessionId).emit('partner_context_intent', { context });

    const count = (next.A ? 1 : 0) + (next.B ? 1 : 0);
    await logSocketEvent(socket, 'menu_context_reset', { context, count, required: 2 });

    if (next.A && next.B && next.A === next.B) {
      // Clear the 60s timer we may have armed above before removing entry.
      if (next._cleanupTimer) clearTimeout(next._cleanupTimer);
      pendingContexts.delete(sessionId);
      const updated = await db.query(
        `UPDATE sessions SET context = $1 WHERE session_id = $2 RETURNING restaurant_id, table_token, session_group_id, mode, dual_status`,
        [context, sessionId]
      );

      const s = updated.rows && updated.rows[0] ? updated.rows[0] : null;
      if (s) {
        await deckService.getDeckSession(s.restaurant_id || DEFAULT_RESTAURANT_ID, s.table_token, context, s.session_group_id);
        await insertAnalyticsEvent({
          session_id: sessionId,
          participant_id: socket.participantId,
          restaurant_id: s.restaurant_id,
          table_token: s.table_token,
          event_type: 'context_changed',
          event_data: {
            context,
            mode: s.mode || null,
            dual_status: s.dual_status || null,
            session_group_id: s.session_group_id || null,
            source: 'dual_sync_menu'
          }
        });
      }

      clearSessionState(sessionId);
      io.to(sessionId).emit('session_updated', { context });
    }
  });

  socket.on('cancel_context_switch', async () => {
    const sessionId = socket.sessionId;
    if (!sessionId) return;
    const role = await resolveSocketRole(socket, socket.participantId, sessionId);
    if (!role) return;

    const prev = pendingContexts.get(sessionId);
    if (!prev) return;
    const next = { A: prev.A, B: prev.B };
    next[role] = null;
    if (!next.A && !next.B) {
      if (prev._cleanupTimer) clearTimeout(prev._cleanupTimer);
      pendingContexts.delete(sessionId);
    } else {
      if (prev._cleanupTimer) next._cleanupTimer = prev._cleanupTimer;
      pendingContexts.set(sessionId, next);
    }
    socket.to(sessionId).emit('context_switch_cancelled');
    await logSocketEvent(socket, 'menu_context_switch_cancelled', {});
  });
});

// --- Server Startup ---
if (process.env.NODE_ENV !== 'test') {
  (async () => {
    try {
      await db.query(`
        ALTER TABLE restaurants
        ADD COLUMN IF NOT EXISTS geofence_radius_meters INTEGER NOT NULL DEFAULT 100
      `);
      await db.query(`DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'restaurants_geofence_radius_meters_check'
        ) THEN
          ALTER TABLE restaurants
          ADD CONSTRAINT restaurants_geofence_radius_meters_check
          CHECK (geofence_radius_meters >= 5 AND geofence_radius_meters <= 5000);
        END IF;
      END $$;`);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_restaurants_lat_lng
        ON restaurants (latitude, longitude)
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      `);
      console.log('✅ Geofence DDL ensured (column + check + idx).');

      await db.query(`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS participant_id UUID`);
      await db.query(`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS restaurant_id UUID`);
      try {
        await db.query(`
          ALTER TABLE analytics_events
          ADD CONSTRAINT analytics_events_restaurant_id_fkey
          FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE SET NULL
        `);
      } catch (_) { /* constraint may already exist */ }
      await db.query(`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS table_token VARCHAR(100)`);
      await db.query(`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS anonymous_id VARCHAR(100)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_participant_id ON analytics_events(participant_id)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_restaurant_id ON analytics_events(restaurant_id)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_table_token ON analytics_events(table_token)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_anonymous_id ON analytics_events(anonymous_id)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_event_data_gin ON analytics_events USING GIN (event_data jsonb_path_ops)`);
      try {
        await db.query(`DO $$ DECLARE fk_name text; BEGIN
          SELECT tc.constraint_name INTO fk_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
               AND tc.table_schema = kcu.table_schema
          WHERE tc.table_name = 'analytics_events'
            AND tc.constraint_type = 'FOREIGN KEY'
            AND kcu.column_name = 'session_id'
          LIMIT 1;
          IF fk_name IS NOT NULL THEN
            EXECUTE format('ALTER TABLE analytics_events DROP CONSTRAINT %I', fk_name);
            ALTER TABLE analytics_events
              ADD CONSTRAINT analytics_events_session_id_fkey_setnull
              FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE SET NULL;
          END IF;
        END $$;`);
      } catch (_) { /* idempotent: already rewired */ }
      console.log('✅ Analytics DDL ensured (cols + fks + idx + gin).');
    } catch (e) {
      console.warn('⚠️  Boot-time DDL bootstrap warning (non-fatal):', e.message);
    }
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`
    🚀 Server ready on port ${PORT}
    🌍 Environment: ${process.env.NODE_ENV || 'development'}
      `);
    });
  })();
}

module.exports = app;
app.io = io;
app.server = server;
app.clearSetupLockForTable = clearSetupLockForTable;
