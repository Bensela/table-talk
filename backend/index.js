const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const sessionRoutes = require('./routes/sessionRoutes');
const adminRoutes = require('./routes/adminRoutes');
const publicRoutes = require('./routes/publicRoutes');
const db = require('./db');
const deckService = require('./services/deckService');

// Load environment variables
try {
  require('dotenv').config();
} catch (e) {
  console.log('No .env file found, relying on system environment variables');
}

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

// Initial Jobs
cleanupSessions();

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// --- API & Static Routes ---
app.use('/sessions', sessionRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tenant', adminRoutes);
app.use('/api/public', publicRoutes);
if (API_PREFIX && API_PREFIX !== '/api') {
  app.use(`${API_PREFIX}/sessions`, sessionRoutes);
  app.use(`${API_PREFIX}/admin`, adminRoutes);
  app.use(`${API_PREFIX}/tenant`, adminRoutes);
  app.use(`${API_PREFIX}/public`, publicRoutes);
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
      advanceIntent: new Set()
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
  }
}

// --- Socket Events ---
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join_session', async ({ session_id, participant_id }) => {
    if (!session_id || !participant_id) return;

    try {
      const roomBefore = io.sockets.adapter.rooms.get(session_id);
      const sizeBefore = roomBefore ? roomBefore.size : 0;

      const participantResult = await db.query(`
        SELECT p.participant_id, p.role, s.mode, s.dual_status, s.expires_at
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
        }
      }

    } catch (err) {
      console.error('Join Error:', err);
    }
  });

  // Dual-Phone: Readiness Ritual
  socket.on('ready_toggled', (data) => {
    if (!socket.sessionId) return;
    const state = getSessionState(socket.sessionId);
    state.ready.set(socket.role, data.ready);
    
    io.to(socket.sessionId).emit('ready_status_update', { 
      participant_id: socket.participantId, 
      role: socket.role, 
      ready: data.ready 
    });

    if (state.ready.size >= 2 && Array.from(state.ready.values()).every(r => r)) {
      io.to(socket.sessionId).emit('both_ready');
    }
  });

  // Dual-Phone: Reveal Logic
  socket.on('answer_submitted', ({ selectionId }) => {
    if (!socket.sessionId) return;
    const state = getSessionState(socket.sessionId);
    state.answers.set(socket.role, { participantId: socket.participantId, optionId: selectionId });

    if (state.answers.size >= 2) {
      const selections = {};
      state.answers.forEach(val => selections[val.participantId] = val.optionId);
      io.to(socket.sessionId).emit('reveal_answers', { selections });
    } else {
      socket.to(socket.sessionId).emit('partner_answered', { role: socket.role });
    }
  });

  socket.on('reveal_answer', ({ sessionId, question_id } = {}) => {
    const sid = sessionId || socket.sessionId;
    if (!sid) return;
    socket.to(sid).emit('answer_revealed', { question_id, role: socket.role });
  });

  socket.on('partner_switched_mode', ({ newMode } = {}) => {
    if (!socket.sessionId) return;
    socket.to(socket.sessionId).emit('partner_switched_mode', { newMode });
  });

  // Turn Advancement
  socket.on('dual_next_intent', () => {
    const state = getSessionState(socket.sessionId);
    state.nextIntent.add(socket.role);
    io.to(socket.sessionId).emit('next_intent_update', { count: state.nextIntent.size, required: 2 });
    if (state.nextIntent.size >= 2) io.to(socket.sessionId).emit('conversation_start');
  });

  socket.on('advance_turn', async () => {
    const state = getSessionState(socket.sessionId);
    state.advanceIntent.add(socket.role);
    if (state.advanceIntent.size >= 2) {
      const res = await db.query('SELECT * FROM sessions WHERE session_id = $1', [socket.sessionId]);
      if (res.rows[0]) {
        await deckService.advanceDeck(res.rows[0]);
        clearSessionState(socket.sessionId);
        io.to(socket.sessionId).emit('advance_question');
      }
    } else {
      socket.to(socket.sessionId).emit('partner_waiting_to_advance');
    }
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
       RETURNING fresh_intent_a, fresh_intent_b, table_token, dual_group_id, mode, dual_status`,
      [sessionId]
    );

    socket.to(sessionId).emit('partner_requested_fresh', { role });

    const row = result.rows[0];
    if (row?.fresh_intent_a && row?.fresh_intent_b) {
      await db.query(`UPDATE sessions SET dual_status = 'ended', expires_at = NOW() WHERE session_id = $1`, [sessionId]);
      if (row.dual_group_id) {
        await db.query(`UPDATE dual_groups SET terminated_at = NOW() WHERE dual_group_id = $1`, [row.dual_group_id]);
        await db.query(`UPDATE sessions SET dual_status = 'ended', expires_at = NOW() WHERE dual_group_id = $1`, [row.dual_group_id]);
      }
      if (row.table_token) clearSetupLockForTable(row.table_token);
      io.to(sessionId).emit('dual_group_terminated');
    } else {
      if (row?.mode === 'dual-phone' && row?.dual_status === 'paired') {
        await db.query(`UPDATE sessions SET dual_status = 'waiting' WHERE session_id = $1`, [sessionId]);
        io.to(sessionId).emit('session_updated', { dual_status: 'waiting', waiting_reason: 'partner_fresh' });
      }
    }
  });

  socket.on('disconnect', async () => {
    if (socket.participantId) {
      await db.query(`UPDATE session_participants SET disconnected_at = NOW() WHERE participant_id = $1`, [socket.participantId]);
      io.to(socket.sessionId).emit('partner_disconnected', { role: socket.role });
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

    if (next.A && next.B && next.A === next.B) {
      pendingContexts.delete(sessionId);
      const updated = await db.query(
        `UPDATE sessions SET context = $1 WHERE session_id = $2 RETURNING restaurant_id, table_token, session_group_id, mode, dual_status`,
        [context, sessionId]
      );

      if (s) {
        await deckService.getDeckSession(s.restaurant_id || DEFAULT_RESTAURANT_ID, s.table_token, context, s.session_group_id);
      }

      clearSessionState(sessionId);
      io.to(sessionId).emit('session_updated', { context });
    }
  });

  socket.on('cancel_context_switch', () => {
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
  });
});

// --- Server Startup ---
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    🚀 Server ready on port ${PORT}
    🌍 Environment: ${process.env.NODE_ENV || 'development'}
    `);
  });
}

module.exports = app;
app.io = io;
app.server = server;
app.clearSetupLockForTable = clearSetupLockForTable;
