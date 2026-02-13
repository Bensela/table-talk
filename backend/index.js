const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const sessionRoutes = require('./routes/sessionRoutes');
const db = require('./db');
const deckService = require('./services/deckService');
try {
  require('dotenv').config();
} catch (e) {
  // .env file is missing, but that's okay in production where env vars are injected
  console.log('No .env file found, relying on environment variables');
}

const { cleanupSessions } = require('./jobs/cleanup');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:4173",
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
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check against whitelist or allow ngrok subdomains
    if (allowedOrigins.includes(origin) || origin.endsWith('.ngrok-free.dev')) {
      callback(null, true);
    } else {
      // For MVP, default to allow to prevent blocking unexpected valid sources
      callback(null, true);
    }
  },
  methods: ["GET", "POST", "PATCH"],
  credentials: true
};

const io = new Server(server, {
  // MUST match the frontend exactly
  path: "/api/socket.io/",
  cors: {
    origin: [
      "http://localhost:5173",
      "http://localhost:4173",
      "https://september-internation-overelliptically.ngrok-free.dev",
      "https://sea-lion-app-6mjje.ondigitalocean.app",
      "https://orca-app-be8he.ondigitalocean.app",
      "https://octopus-app-ibal3.ondigitalocean.app"
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket"],
  allowUpgrades: false,
  pingTimeout: 30000,
  pingInterval: 10000
});

// Run cleanup once on startup
cleanupSessions();

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Routes
app.use('/sessions', sessionRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Root Endpoint
app.get('/', (req, res) => {
  res.send('Table Talk API is running. Please visit the frontend application.');
});

// Socket.io Logic
// Store pending states
const pendingNextClicks = new Map();
const sessionStates = new Map(); // sessionId -> { ready: Map<participantId, bool>, answers: Map<participantId, optionId> }
// socketToSession map is less useful now that we have socket.participantId, but can keep for disconnect cleanup if needed
// Actually, with auth, we should rely on socket.participantId

function getSessionState(sessionId) {
  if (!sessionStates.has(sessionId)) {
    sessionStates.set(sessionId, {
      ready: new Map(),
      answers: new Map()
    });
  }
  return sessionStates.get(sessionId);
}

function clearSessionState(sessionId) {
  sessionStates.delete(sessionId);
  pendingNextClicks.delete(sessionId);
}

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // Authentication Handler
  socket.on('join_session', async ({ session_id, participant_id }) => {
    if (!session_id || !participant_id) {
      socket.emit('error', { message: 'Missing session_id or participant_id' });
      return;
    }

    try {
      // Verify participant belongs to session
      const participant = await db.query(`
        SELECT p.participant_id, p.role, s.mode, s.dual_status, s.session_group_id
        FROM session_participants p
        JOIN sessions s ON p.session_id = s.session_id
        WHERE p.participant_id = $1
          AND s.session_id = $2
          AND s.expires_at > NOW()
          AND p.disconnected_at IS NULL
      `, [participant_id, session_id]);

      if (participant.rows.length === 0) {
        console.warn(`Invalid join attempt: Session ${session_id}, Participant ${participant_id}`);
        socket.emit('error', { message: 'Invalid participant or session' });
        return;
      }

      // Update last_seen_at
      await db.query(`
        UPDATE session_participants
        SET last_seen_at = NOW()
        WHERE participant_id = $1
      `, [participant_id]);

      // Attach data to socket
      socket.join(session_id);
      socket.participantId = participant_id;
      socket.sessionId = session_id;
      socket.role = participant.rows[0].role;
      socket.sessionGroupId = participant.rows[0].session_group_id;

      console.log(`Participant ${participant_id} (${socket.role}) joined session ${session_id}`);

      // Notify room
      const room = io.sockets.adapter.rooms.get(session_id);
      const size = room ? room.size : 0;
      io.to(session_id).emit('partner_status', {
        status: size >= 2 ? 'connected' : 'waiting',
        users_connected: size
      });

      // Send current readiness state to re-connecting user
      const state = getSessionState(session_id);
      if (state.ready.size > 0) {
        // Send state of all participants
        state.ready.forEach((isReady, pId) => {
           socket.emit('ready_status_update', { participant_id: pId, ready: isReady });
        });
      }

    } catch (err) {
      console.error('Error joining session:', err);
      socket.emit('error', { message: 'Server error during join' });
    }
  });

  socket.on('reveal_answer', ({ sessionId }) => {
     // Verify auth
     if (!socket.participantId || socket.sessionId !== sessionId) return;
     socket.to(sessionId).emit('answer_revealed');
  });

  // Dual-Phone: Ready Ritual (Open-Ended)
  socket.on('ready_toggled', (data) => {
    if (!socket.participantId) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    const state = getSessionState(socket.sessionId);
    state.ready.set(socket.participantId, data.ready);
    
    // Broadcast status to room (including self, to confirm receipt)
    io.to(socket.sessionId).emit('ready_status_update', { 
      participant_id: socket.participantId, 
      role: socket.role, 
      ready: data.ready 
    });

    // Check if both ready
    const room = io.sockets.adapter.rooms.get(socket.sessionId);
    const clientCount = room ? room.size : 0;
    
    if (clientCount >= 2 && state.ready.size >= 2) {
      const allReady = Array.from(state.ready.values()).every(r => r);
      if (allReady) {
        io.to(socket.sessionId).emit('both_ready', { session_id: socket.sessionId });
      }
    }
  });

  // Dual-Phone: Reveal Ritual (Multiple-Choice)
  socket.on('answer_submitted', ({ selectionId }) => {
    if (!socket.participantId) return;

    const state = getSessionState(socket.sessionId);
    state.answers.set(socket.participantId, selectionId);

    // Check if both submitted
    const room = io.sockets.adapter.rooms.get(socket.sessionId);
    const clientCount = room ? room.size : 0;

    if (clientCount >= 2 && state.answers.size >= 2) {
      // Reveal answers
      const selections = Object.fromEntries(state.answers);
      io.to(socket.sessionId).emit('reveal_answers', { selections });
    } else {
      socket.emit('waiting_for_partner');
    }
  });

  socket.on('request_next', async () => {
    if (!socket.participantId) return;
    const sessionId = socket.sessionId;

    try {
      // 1. Check if session is dual mode (we can trust socket.role/sessionGroupId context implies valid session)
      // But let's check mode from DB to be safe or store in socket on join
      // Optimally, we fetched mode on join. Let's assume we store it.
      // For now, re-fetch or assume dual if role is present. 
      // Actually, single mode might also use this socket event in updated frontend? 
      // Phase 2 prompt says "Complete Single-Phone mode" but "Both Click Next" is for Dual.
      
      // Let's verify mode.
      const result = await db.query('SELECT mode FROM sessions WHERE session_id = $1', [sessionId]);
      if (result.rows.length === 0) return;
      const mode = result.rows[0].mode;

      if (mode === 'single' || mode === 'single-phone') {
        // Single mode: Immediate advance
        // Need session object for advanceDeck
        // Re-fetch full session is safest
         const sessionResult = await db.query('SELECT * FROM sessions WHERE session_id = $1', [sessionId]);
         const session = sessionResult.rows[0];

        await deckService.advanceDeck(session);
        await db.query(
          `INSERT INTO analytics_events (session_id, event_type, event_data)
           VALUES ($1, $2, $3)`,
          [sessionId, 'next_clicked_single_socket', { socket_advance: true, participant_id: socket.participantId }]
        );
        io.to(sessionId).emit('advance_question');
      } else {
        // Dual mode: wait for both
        if (!pendingNextClicks.has(sessionId)) {
          pendingNextClicks.set(sessionId, new Set());
        }

        const clicks = pendingNextClicks.get(sessionId);
        clicks.add(socket.participantId); // Track by participant_id now

        const room = io.sockets.adapter.rooms.get(sessionId);
        const clientCount = room ? room.size : 0;

        // If everyone clicked (or at least 2 people), advance
        if (clicks.size >= Math.max(2, clientCount)) {
           const sessionResult = await db.query('SELECT * FROM sessions WHERE session_id = $1', [sessionId]);
           const session = sessionResult.rows[0];

          await deckService.advanceDeck(session);

          await db.query(
             `INSERT INTO analytics_events (session_id, event_type, event_data)
              VALUES ($1, $2, $3)`,
             [sessionId, 'next_clicked_dual', { socket_advance: true }]
          );

          // Reset session state for new question
          clearSessionState(sessionId);

          io.to(sessionId).emit('advance_question');
        } else {
          socket.emit('waiting_for_partner');
        }

        // Timeout (2 minutes)
        setTimeout(() => {
           if (pendingNextClicks.has(sessionId)) {
             pendingNextClicks.delete(sessionId);
             io.to(sessionId).emit('wait_timeout'); 
           }
        }, 120000);
      }
    } catch (err) {
      console.error('Socket error:', err);
    }
  });

  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);
    
    if (socket.participantId) {
      try {
        await db.query(`
          UPDATE session_participants
          SET disconnected_at = NOW()
          WHERE participant_id = $1
        `, [socket.participantId]);

        io.to(socket.sessionId).emit('partner_disconnected', {
          participant_id: socket.participantId,
          role: socket.role
        });
        
        // Update connection count
        const room = io.sockets.adapter.rooms.get(socket.sessionId);
        const size = room ? room.size : 0;
        io.to(socket.sessionId).emit('partner_status', { 
           status: size >= 2 ? 'connected' : 'waiting',
           users_connected: size 
        });

      } catch (err) {
        console.error('Error handling disconnect:', err);
      }
    }
  });
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
