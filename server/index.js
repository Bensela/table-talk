const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const sessionRoutes = require('./routes/sessionRoutes');
const db = require('./db');
require('dotenv').config();

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
app.use('/api/sessions', sessionRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Socket.io Logic
// Store pending next clicks: { sessionId: Set(socketId) }
const pendingNextClicks = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_session', (sessionId) => {
    socket.join(sessionId);
    console.log(`Socket ${socket.id} joined session ${sessionId}`);
  });

  socket.on('reveal_answer', ({ sessionId }) => {
    // Broadcast to everyone else in the room
    socket.to(sessionId).emit('answer_revealed');
  });

  socket.on('request_next', async ({ sessionId }) => {
    // 1. Check if session is dual mode
    try {
      const result = await db.query('SELECT mode FROM sessions WHERE session_id = $1', [sessionId]);
      if (result.rows.length === 0) return;
      
      const mode = result.rows[0].mode;

      if (mode === 'single') {
        // Single mode: Client usually calls API, but if they use socket:
        // We should update DB here too if we want to support socket-only flow
        // But for now, let's assume Single Mode uses API as per frontend code
        // Just emit advance to be safe
        io.to(sessionId).emit('advance_question');
      } else {
        // Dual mode: wait for both
        if (!pendingNextClicks.has(sessionId)) {
          pendingNextClicks.set(sessionId, new Set());
        }

        const clicks = pendingNextClicks.get(sessionId);
        clicks.add(socket.id);

        // Get room size
        const room = io.sockets.adapter.rooms.get(sessionId);
        const clientCount = room ? room.size : 0;

        // If everyone clicked (or at least 2 people), advance
        // Or if only 1 person is connected, just advance (fallback)
        if (clicks.size >= Math.max(2, clientCount)) {
          // UPDATE DB
          await db.query(
            `UPDATE sessions 
             SET current_question_index = current_question_index + 1 
             WHERE session_id = $1`,
            [sessionId]
          );

          // Log analytics
          await db.query(
             `INSERT INTO analytics_events (session_id, event_type, event_data)
              VALUES ($1, $2, $3)`,
             [sessionId, 'next_clicked_dual', { socket_advance: true }]
          );

          io.to(sessionId).emit('advance_question');
          pendingNextClicks.delete(sessionId);
        } else {
          // Tell this user we are waiting
          socket.emit('waiting_for_partner');
        }

        // Timeout to clear pending state (30s)
        setTimeout(() => {
           if (pendingNextClicks.has(sessionId)) {
             pendingNextClicks.delete(sessionId);
             io.to(sessionId).emit('wait_timeout'); 
           }
        }, 30000);
      }
    } catch (err) {
      console.error('Socket error:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
