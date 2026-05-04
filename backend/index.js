const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const sessionRoutes = require('./routes/sessionRoutes');
const db = require('./db');
const deckService = require('./services/deckService');

// Load environment variables
try {
  require('dotenv').config();
} catch (e) {
  console.log('No .env file found, relying on system environment variables');
}

const { cleanupSessions } = require('./jobs/cleanup');

const app = express();
const server = http.createServer(app);

// --- CORS Configuration ---
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "https://september-internation-overelliptically.ngrok-free.dev",
  "https://sea-lion-app-6mjje.ondigitalocean.app",
  "https://orca-app-be8he.ondigitalocean.app",
  "https://octopus-app-ibal3.ondigitalocean.app"
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
  path: "/socket.io/",
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

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

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
  socket.on('fresh_intent', async () => {
    const role = socket.role;
    const field = role === 'A' ? 'fresh_intent_a' : 'fresh_intent_b';
    const result = await db.query(`UPDATE sessions SET ${field} = TRUE, fresh_intent_at = NOW() WHERE session_id = $1 RETURNING *`, [socket.sessionId]);
    
    socket.to(socket.sessionId).emit('partner_requested_fresh', { role });

    if (result.rows[0]?.fresh_intent_a && result.rows[0]?.fresh_intent_b) {
      await db.query(`UPDATE sessions SET dual_status = 'ended' WHERE session_id = $1`, [socket.sessionId]);
      io.to(socket.sessionId).emit('dual_group_terminated');
    }
  });

  socket.on('disconnect', async () => {
    if (socket.participantId) {
      await db.query(`UPDATE session_participants SET disconnected_at = NOW() WHERE participant_id = $1`, [socket.participantId]);
      io.to(socket.sessionId).emit('partner_disconnected', { role: socket.role });
    }
  });
});

// --- Server Startup ---
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  🚀 Server ready on port ${PORT}
  🌍 Environment: ${process.env.NODE_ENV || 'development'}
  `);
});

module.exports = { app, io, server };