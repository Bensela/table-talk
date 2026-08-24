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
      revealUnstickTimer: null
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
    if (state.revealUnstickTimer) {
      try { clearTimeout(state.revealUnstickTimer); } catch (_) {}
      state.revealUnstickTimer = null;
    }
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

      const wasDisconnected = Boolean(pData.prev_disconnected_at);

      await db.query(`UPDATE session_participants SET disconnected_at = NULL, last_seen_at = NOW() WHERE participant_id = $1`, [participant_id]);

      socket.join(session_id);
      socket.participantId = participant_id;
      socket.sessionId = session_id;
      socket.role = pData.role;

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
    const state = getSessionState(socket.sessionId);
    state.ready.set(socket.role, data.ready);
    
    io.to(socket.sessionId).emit('ready_status_update', { 
      participant_id: socket.participantId, 
      role: socket.role, 
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
    const state = getSessionState(socket.sessionId);
    state.answers.set(String(socket.participantId), {
      participantId: socket.participantId,
      role: socket.role || null,
      optionId: selectionId
    });

    await logSocketEvent(socket, 'answer_submitted', { has_selection: Boolean(selectionId) });

    const uniqueParticipants = state.answers.size;
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
      socket.to(socket.sessionId).emit('partner_answered', { role: socket.role, participantId: socket.participantId });
      // Safety unstick: if no reveal occurred within 18s of this submission (e.g. partner backgrounded),
      // broadcast reveal with what we have so users are not stuck on "Waiting for your partner".
      const unstickAt = Date.now() + 18 * 1000;
      const sid = socket.sessionId;
      const snapshot = new Map(state.answers);
      if (!state.revealUnstickTimer) {
        state.revealUnstickTimer = setTimeout(async () => {
          try {
            const cur = getSessionState(sid);
            // If already revealed and cleared by advance, skip
            if (!cur || cur.answers.size === 0) return;
            const curCount = cur.answers.size;
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
                await db.query('SELECT 1').then(() => {}).catch(() => {});
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
    socket.to(socket.sessionId).emit('partner_switched_mode', { newMode });
    await logSocketEvent(socket, 'menu_mode_reset', { new_mode: newMode || null });
  });

  // Turn Advancement
  socket.on('dual_next_intent', async () => {
    if (!socket.sessionId) return;
    const state = getSessionState(socket.sessionId);
    state.nextIntent.add(socket.role);
    const count = state.nextIntent.size;
    io.to(socket.sessionId).emit('next_intent_update', { count, required: 2, selfRole: socket.role });
    await logSocketEvent(socket, 'next_question_intent', {
      count,
      required: 2
    });
    if (state.nextIntent.size >= 2) {
      io.to(socket.sessionId).emit('conversation_start');
      await logSocketEvent(socket, 'conversation_start', {});
    }
  });

  socket.on('advance_turn', async () => {
    if (!socket.sessionId) return;
    const state = getSessionState(socket.sessionId);
    state.advanceIntent.add(socket.role);
    const turnCount = state.advanceIntent.size;
    io.to(socket.sessionId).emit('advance_intent_update', { count: turnCount, required: 2, selfRole: socket.role });
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

    let role = socket.role;
    if (!role && participantId) {
      const r = await db.query(
        `SELECT role FROM session_participants WHERE session_id = $1 AND participant_id = $2`,
        [sessionId, participantId]
      );
      role = r.rows[0]?.role;
      if (role) socket.role = role;
    }
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
      await db.query(`UPDATE sessions SET dual_status = 'ended', expires_at = NOW() WHERE session_id = $1`, [sessionId]);
      if (row.dual_group_id) {
        await db.query(`UPDATE dual_groups SET terminated_at = NOW() WHERE dual_group_id = $1`, [row.dual_group_id]);
        await db.query(`UPDATE sessions SET dual_status = 'ended', expires_at = NOW() WHERE dual_group_id = $1`, [row.dual_group_id]);
      }
      if (row.table_token) clearSetupLockForTable(row.table_token);
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
        io.to(sessionId).emit('session_updated', { dual_status: 'waiting', waiting_reason: 'partner_fresh', mode: 'dual-phone' });
        await insertAnalyticsEvent({
          session_id: sessionId,
          participant_id: participantId,
          restaurant_id: row.restaurant_id,
          table_token: row.table_token,
          event_type: 'session_end_wait',
          event_data: {
            reason: 'start_fresh_single_side',
            waiting_partner: role === 'A' ? 'B' : 'A',
            dual_status: 'waiting'
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

    let role = socket.role;
    if (!role && socket.participantId) {
      const r = await db.query(
        `SELECT role FROM session_participants WHERE session_id = $1 AND participant_id = $2`,
        [sessionId, socket.participantId]
      );
      role = r.rows[0]?.role;
      if (role) socket.role = role;
    }
    if (!role) return;

    const prev = pendingContexts.get(sessionId) || { A: null, B: null };
    const next = { ...prev, [role]: context };
    pendingContexts.set(sessionId, next);

    socket.to(sessionId).emit('partner_context_intent', { context });

    await logSocketEvent(socket, 'menu_context_reset', { context, count: Object.values(next).filter(Boolean).length, required: 2 });

    if (next.A && next.B && next.A === next.B) {
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
    const role = socket.role;
    if (!sessionId || !role) return;

    const prev = pendingContexts.get(sessionId);
    if (!prev) return;
    const next = { ...prev, [role]: null };
    if (!next.A && !next.B) {
      pendingContexts.delete(sessionId);
    } else {
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
