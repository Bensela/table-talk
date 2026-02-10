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

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for MVP
    methods: ["GET", "POST", "PATCH"]
  }
});

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
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
const sessionStates = new Map(); // sessionId -> { ready: Map<userId, bool>, answers: Map<userId, optionId> }
const socketToSession = new Map(); // socketId -> sessionId

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
  console.log('User connected:', socket.id);

  socket.on('join_session', (sessionId) => {
    socket.join(sessionId);
    socketToSession.set(socket.id, sessionId);
    console.log(`Socket ${socket.id} joined session ${sessionId}`);
    
    // Notify room about new user (for connection status)
    const room = io.sockets.adapter.rooms.get(sessionId);
    const size = room ? room.size : 0;
    io.to(sessionId).emit('partner_joined', { users_connected: size });
  });

  socket.on('reveal_answer', ({ sessionId }) => {
    // Broadcast to everyone else in the room
    socket.to(sessionId).emit('answer_revealed');
  });

  // Dual-Phone: Ready Ritual (Open-Ended)
  socket.on('ready_toggled', ({ sessionId, user_id, ready }) => {
    const state = getSessionState(sessionId);
    state.ready.set(user_id || socket.id, ready);
    
    // Broadcast status to partner
    socket.to(sessionId).emit('ready_status_update', { user_id: user_id || socket.id, ready });

    // Check if both ready
    const room = io.sockets.adapter.rooms.get(sessionId);
    const clientCount = room ? room.size : 0;
    // Assuming 2 users for Dual Mode
    if (clientCount >= 2 && state.ready.size >= 2) {
      const allReady = Array.from(state.ready.values()).every(r => r);
      if (allReady) {
        io.to(sessionId).emit('both_ready', { sessionId });
        // Optional: log event
      }
    }
  });

  // Dual-Phone: Reveal Ritual (Multiple-Choice)
  socket.on('answer_submitted', ({ sessionId, user_id, question_id, option_id }) => {
    const state = getSessionState(sessionId);
    state.answers.set(user_id || socket.id, option_id);

    // Check if both submitted
    const room = io.sockets.adapter.rooms.get(sessionId);
    const clientCount = room ? room.size : 0;

    if (clientCount >= 2 && state.answers.size >= 2) {
      // Reveal answers
      const selections = Object.fromEntries(state.answers);
      io.to(sessionId).emit('reveal_answers', { selections });
      
      // Log analytics (without specific answer content if strictly adhering to privacy, but prompt asks to store temp state then log)
      // Prompt says: "Log analytics event: answer_submitted... NO actual selection stored"
      // We already logged the fact that they submitted. We can log the reveal event here.
    } else {
      socket.emit('waiting_for_partner');
    }
  });

  socket.on('request_next', async ({ sessionId }) => {
    // 1. Check if session is dual mode
    try {
      const result = await db.query('SELECT * FROM sessions WHERE session_id = $1', [sessionId]);
      if (result.rows.length === 0) return;
      
      const session = result.rows[0];
      const mode = session.mode;

      if (mode === 'single' || mode === 'single-phone') {
        // Single mode
        await deckService.advanceDeck(session);
        await db.query(
          `INSERT INTO analytics_events (session_id, event_type, event_data)
           VALUES ($1, $2, $3)`,
          [sessionId, 'next_clicked_single_socket', { socket_advance: true }]
        );
        io.to(sessionId).emit('advance_question');
      } else {
        // Dual mode: wait for both
        if (!pendingNextClicks.has(sessionId)) {
          pendingNextClicks.set(sessionId, new Set());
        }

        const clicks = pendingNextClicks.get(sessionId);
        clicks.add(socket.id);

        const room = io.sockets.adapter.rooms.get(sessionId);
        const clientCount = room ? room.size : 0;

        // If everyone clicked (or at least 2 people), advance
        if (clicks.size >= Math.max(2, clientCount)) {
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

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    const sessionId = socketToSession.get(socket.id);
    
    if (sessionId) {
      // Notify partner
      socket.to(sessionId).emit('partner_disconnected');
      
      // Update connection count
      const room = io.sockets.adapter.rooms.get(sessionId);
      const size = room ? room.size : 0;
      io.to(sessionId).emit('partner_joined', { users_connected: size });
      
      socketToSession.delete(socket.id);
    }
  });
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
