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
  "http://127.0.0.1:5173",
  "https://september-internation-overelliptically.ngrok-free.dev",
  "https://sea-lion-app-6mjje.ondigitalocean.app",
  "https://orca-app-be8he.ondigitalocean.app",
  "https://octopus-app-ibal3.ondigitalocean.app"
];

// Add FRONTEND_URL to whitelist if set
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

// Development: Allow wildcard in dev mode if origin is not explicitly whitelisted
// This helps when Vite uses different ports or hostnames locally.
// But corsOptions must handle it properly.

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check against whitelist or allow ngrok subdomains
    if (allowedOrigins.includes(origin) || origin.endsWith('.ngrok-free.dev')) {
      callback(null, true);
    } else {
      // In development, allow localhost variations
      if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
         callback(null, true);
      } else {
         // Default to allow for MVP robustness, but warn
         console.warn(`[CORS] Allowing non-whitelisted origin: ${origin}`);
         callback(null, true);
      }
    }
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  credentials: true
};

const io = new Server(server, {
  // MUST match the frontend exactly
  path: "/socket.io/",
  cors: {
    origin: (origin, callback) => {
      // Allow mobile apps/curl (no origin)
      if (!origin) return callback(null, true);
      // Check against whitelist or allow ngrok subdomains
      if (allowedOrigins.includes(origin) || origin.endsWith('.ngrok-free.dev')) {
        callback(null, true);
      } else {
        // Fallback for dev/unexpected origins
        callback(null, true);
      }
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
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

// Export io before setting up routes so controllers can use it
module.exports = { app, io, server };

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Request Logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Root Endpoint
// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// API Routes
app.use('/sessions', sessionRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// Socket.io Logic
// Store pending states
const pendingNextClicks = new Map();
const sessionStates = new Map(); // sessionId -> { ready: Map<participantId, bool>, answers: Map<participantId, optionId> }
// Pending Context Switching States
// sessionId -> { pendingContext: { A: 'Exploring', B: null }, active: boolean }
const pendingContexts = new Map();

// Setup Locks for Welcome Screen Synchronization
// tableToken -> { socketId: string, timestamp: number }
const setupLocks = new Map();

function getSessionState(sessionId) {
  if (!sessionStates.has(sessionId)) {
    sessionStates.set(sessionId, {
      ready: new Map(),
      answers: new Map(),
      nextIntent: new Set(), // Track roles who pressed "I'm Ready"
      advanceIntent: new Set() // Track roles who pressed "Next Question"
    });
  }
  return sessionStates.get(sessionId);
}

function getPendingContextState(sessionId) {
    if (!pendingContexts.has(sessionId)) {
        pendingContexts.set(sessionId, {
            A: null,
            B: null
        });
    }
    return pendingContexts.get(sessionId);
}

function clearSessionState(sessionId) {
  const state = sessionStates.get(sessionId);
  if (state) {
      state.ready.clear();
      state.answers.clear();
      state.nextIntent.clear();
      state.advanceIntent.clear();
  }
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
      const participantResult = await db.query(`
        SELECT p.participant_id, p.role, p.disconnected_at, s.mode, s.dual_status, s.session_group_id, s.expires_at
        FROM session_participants p
        JOIN sessions s ON p.session_id = s.session_id
        WHERE p.participant_id = $1
          AND s.session_id = $2
      `, [participant_id, session_id]);

      if (participantResult.rows.length === 0) {
        console.warn(`Invalid join attempt: Session ${session_id}, Participant ${participant_id}`);
        socket.emit('error', { message: 'Invalid participant or session' });
        return;
      }

      const participantRow = participantResult.rows[0];

      // Check if session has explicitly ended or expired
      const now = new Date();
      if (participantRow.dual_status === 'ended' || new Date(participantRow.expires_at) <= now) {
          socket.emit('error', { message: 'Session expired' });
          return;
      }

      // Reconnection / Join Allowed!
      if (participantRow.disconnected_at !== null) {
          // Clear disconnected_at
          await db.query(`
            UPDATE session_participants
            SET disconnected_at = NULL, last_seen_at = NOW()
            WHERE participant_id = $1
          `, [participant_id]);
      } else {
          // Valid active participant, just update last_seen
          await db.query(`
            UPDATE session_participants
            SET last_seen_at = NOW()
            WHERE participant_id = $1
          `, [participant_id]);
      }

      // Proceed with this participant
      const participant = { rows: [participantRow] };

      // Attach data to socket
      socket.join(session_id);
      socket.participantId = participant_id;
      socket.sessionId = session_id;
      socket.role = participant.rows[0].role;
      socket.sessionGroupId = participant.rows[0].session_group_id;

      console.log(`Participant ${participant_id} (${socket.role}) joined session ${session_id}`);

      // Clear any pending Fresh Intent for this user (they are back!)
      // Update DB to clear the flag
      const intentField = socket.role === 'A' ? 'fresh_intent_a' : 'fresh_intent_b';
      await db.query(`
        UPDATE sessions 
        SET ${intentField} = FALSE
        WHERE session_id = $1
      `, [session_id]);
      
      // Clear fresh_intent_at if both are now false
      await db.query(`
        UPDATE sessions 
        SET fresh_intent_at = NULL 
        WHERE session_id = $1 AND fresh_intent_a = FALSE AND fresh_intent_b = FALSE
      `, [session_id]);
      console.log(`[Socket] Cleared ${intentField} for session ${session_id}`);

      // Notify room
      // Emit 'dual_partner_joined' to other participants so they know this role joined/returned
      socket.to(session_id).emit('dual_partner_joined', {
        session_id,
        joined_role: socket.role
      });

      const updatedRoom = io.sockets.adapter.rooms.get(session_id);
      const size = updatedRoom ? updatedRoom.size : 0;
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
    if (!socket.participantId || !socket.role) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    const state = getSessionState(socket.sessionId);
    // Use role to overwrite old disconnected participants
    state.ready.set(socket.role, data.ready);
    
    // Broadcast status to room (including self, to confirm receipt)
    io.to(socket.sessionId).emit('ready_status_update', { 
      participant_id: socket.participantId, 
      role: socket.role, 
      ready: data.ready 
    });

    // Check if both ready
    if (state.ready.size >= 2) {
      const allReady = Array.from(state.ready.values()).every(r => r);
      if (allReady) {
        io.to(socket.sessionId).emit('both_ready', { session_id: socket.sessionId });
      }
    }
  });

  // Dual-Phone: Reveal Ritual (Multiple-Choice)
  socket.on('answer_submitted', ({ selectionId, user_id }) => {
    console.log(`[Backend] Answer submitted by ${user_id || socket.participantId}:`, selectionId);

    // If no participantId on socket, try to use user_id from payload (fallback)
    const pId = socket.participantId || user_id;
    if (!pId || !socket.role) return;

    const state = getSessionState(socket.sessionId);
    // Ensure selectionId is not undefined (use null to preserve key in JSON)
    const safeSelectionId = selectionId === undefined ? null : selectionId;
    
    // Store by role to automatically overwrite old/disconnected participants who reclaimed the same role
    state.answers.set(socket.role, {
        participantId: pId,
        optionId: safeSelectionId
    });

    console.log(`[Backend] Current answers for session ${socket.sessionId}:`, Array.from(state.answers.entries()));

    // A dual session requires 2 answers.
    if (state.answers.size >= 2) {
      // Reveal answers, mapping back to participantId for the frontend
      const selections = {};
      for (const [role, data] of state.answers.entries()) {
          selections[data.participantId] = data.optionId;
      }
      console.log('[Backend] Emitting reveal_answers:', selections);
      io.to(socket.sessionId).emit('reveal_answers', { selections });
    } else {
      socket.emit('waiting_for_partner');
      // Notify partner that this user has answered
      socket.to(socket.sessionId).emit('partner_answered', { role: socket.role });
    }
  });

  // Dual Mode Next Intent Gating (Phase 1: Mark Ready)
  socket.on('dual_next_intent', async () => {
    if (!socket.participantId || !socket.role) return;
    const sessionId = socket.sessionId;
    
    try {
        const state = getSessionState(sessionId);
        
        // Idempotency: Add to set (duplicates ignored)
        // Use ROLE instead of participantId to prevent bugs when users reconnect/reclaim a spot
        state.nextIntent.add(socket.role);
        console.log(`[Socket] Next Intent from ${socket.role} (Total: ${state.nextIntent.size})`);

        // A dual session always requires exactly 2 intents.
        // Using room.size is dangerous because of "ghost" sockets from mobile disconnects
        // or users opening multiple tabs, which could make room.size > 2 and block progress.
        const requiredCount = 2;

        // Emit 'next_intent_update' to notify clients of current intent count
        io.to(sessionId).emit('next_intent_update', { count: state.nextIntent.size, required: requiredCount });

        if (state.nextIntent.size >= requiredCount) {
            console.log(`[Socket] All players ready. Starting conversation mode for session ${sessionId}...`);
            // DO NOT ADVANCE DECK YET
            // Instead, tell clients to enter "Conversation Mode" (Blur question, show Next button)
            io.to(sessionId).emit('conversation_start');
        } else {
            socket.emit('waiting_for_partner_next');
        }
    } catch (err) {
        console.error('Error in dual_next_intent:', err);
    }
  });

  // Dual Mode Manual Advance (Phase 2: Next Question)
  socket.on('advance_turn', async () => {
      if (!socket.participantId || !socket.sessionId || !socket.role) return;
      const sessionId = socket.sessionId;
      
      try {
          const state = getSessionState(sessionId);
          
          // Add to advanceIntent using role
          state.advanceIntent.add(socket.role);
          console.log(`[Socket] Advance Intent from ${socket.role} (Total: ${state.advanceIntent.size})`);
          
          // A dual session always requires exactly 2 intents.
          const requiredCount = 2;
          
          if (state.advanceIntent.size >= requiredCount) {
             // Check if session exists
             const sessionResult = await db.query('SELECT * FROM sessions WHERE session_id = $1', [sessionId]);
             if (sessionResult.rows.length === 0) return;
             const session = sessionResult.rows[0];

             // Advance Deck
             await deckService.advanceDeck(session);

             // Log Analytics
             await db.query(
                 `INSERT INTO analytics_events (session_id, event_type, event_data)
                  VALUES ($1, $2, $3)`,
                 [sessionId, 'question_advanced_dual_manual', { initiator: socket.participantId }]
             );

             // Reset Intents & State
             clearSessionState(sessionId);

             // Broadcast New Question Trigger
             io.to(sessionId).emit('advance_question');
          } else {
             // Notify that we are waiting for partner
             // Emit to the partner (everyone EXCEPT sender)
             socket.to(sessionId).emit('partner_waiting_to_advance');
          }
          
      } catch (err) {
          console.error('Error in advance_turn:', err);
      }
  });

  // Handle Session Migration (Menu Switch)
  socket.on('migrate_session', ({ newSessionId }) => {
    if (!socket.participantId || !newSessionId) return;
    console.log(`[Socket] Migrating session ${socket.sessionId} to ${newSessionId}`);
    
    // Notify all other clients in the room to move
    socket.to(socket.sessionId).emit('session_migrated', { 
      newSessionId,
      initiator: socket.participantId 
    });
  });

  socket.on('partner_switched_mode', ({ newMode }) => {
    console.log(`[Socket] ${socket.role} switched to ${newMode}. Notifying partner in ${socket.sessionId}`);
    socket.to(socket.sessionId).emit('partner_switched_mode', { newMode });
  });

  // Handle Dual Mode Context Switch Intent
  socket.on('context_switch_intent', async ({ context }) => {
      if (!socket.participantId || !socket.sessionId || !socket.role) return;
      
      const sessionId = socket.sessionId;
      const role = socket.role;
      
      console.log(`[Socket] Context Switch Intent from ${role}: ${context}`);
      
      // Store intent
      const pending = getPendingContextState(sessionId);
      pending[role] = context;
      
      // Check if both match
      // We need both A and B to have selected the SAME context
      const isMatch = pending.A && pending.B && pending.A === pending.B;

      if (!isMatch) {
          // Notify partner ONLY if it's not a match yet (requesting a switch)
          socket.to(sessionId).emit('partner_context_intent', { 
              context,
              initiator_role: role
          });
      } else {
          // It IS a match (Handshake complete)
          const newContext = pending.A;
          console.log(`[Socket] Context Switch Confirmed: ${newContext}`);
          
          try {
              // Perform the update (using Option A: Mutation)
              // We can reuse the updateSession logic, but we need to do it here since this is socket-driven
              // OR we can call the controller logic if we extract it.
              // For simplicity, let's just do the DB update here or emit an event that triggers client to call API?
              // Better: Server does it to be authoritative.
              
              // 1. Update Session Context in DB
              await db.query(
                `UPDATE sessions SET context = $1 WHERE session_id = $2`,
                [newContext, sessionId]
              );
              
              // 2. Ensure Deck Session Exists
              // We need session details to get table/restaurant/group
              const sessionRes = await db.query('SELECT * FROM sessions WHERE session_id = $1', [sessionId]);
              if (sessionRes.rows.length > 0) {
                  const session = sessionRes.rows[0];
                  await deckService.getDeckSession(
                      session.restaurant_id || 'default', 
                      session.table_token, 
                      newContext, 
                      session.session_group_id
                  );
                  
                  // 3. Log Analytics
                  await db.query(
                    `INSERT INTO analytics_events (session_id, event_type, event_data)
                     VALUES ($1, $2, $3)`,
                    [sessionId, 'dual_context_switched_confirmed', { context: newContext }]
                  );
                  
                  // 4. Clear pending state
                  pendingContexts.delete(sessionId);
                  
                  // 5. Broadcast Final Change
                  // This tells both clients to update their UI to the new context and fetch the new question
                  io.to(sessionId).emit('session_updated', { 
                      context: newContext,
                      mode: 'dual-phone' // Implicit
                  });
              }
          } catch (err) {
              console.error('Error executing context switch:', err);
              io.to(sessionId).emit('error', { message: 'Failed to switch context' });
          }
      }
  });

  // Handle Cancel Context Switch
  socket.on('cancel_context_switch', () => {
      if (!socket.sessionId) return;
      console.log(`[Socket] Context switch cancelled by ${socket.participantId}`);
      pendingContexts.delete(socket.sessionId);
      // Notify partner that the request was declined/cancelled
      socket.to(socket.sessionId).emit('context_switch_cancelled', { 
          initiator: socket.participantId 
      });
  });

  // Handle Dual Mode Fresh Intent (Termination)
  socket.on('fresh_intent', async () => {
      if (!socket.participantId || !socket.sessionId || !socket.role) return;
      const sessionId = socket.sessionId;
      const role = socket.role;
      
      console.log(`[Socket] Fresh Intent from ${role} in session ${sessionId}`);
      
      try {
          // 1. Update DB with intent and timestamp if first intent
          const intentField = role === 'A' ? 'fresh_intent_a' : 'fresh_intent_b';
          
          // Only set fresh_intent_at if it's not already set
          const updateResult = await db.query(
              `UPDATE sessions 
               SET ${intentField} = TRUE, 
                   fresh_intent_at = COALESCE(fresh_intent_at, NOW())
               WHERE session_id = $1 
               RETURNING fresh_intent_a, fresh_intent_b`,
              [sessionId]
          );
          
          if (updateResult.rows.length === 0) return;
          const { fresh_intent_a, fresh_intent_b } = updateResult.rows[0];
          
          // Notify partner
          socket.to(sessionId).emit('partner_requested_fresh', { role });
          
          // 2. Check if both want fresh
          if (fresh_intent_a && fresh_intent_b) {
              console.log(`[Socket] Both confirmed Fresh Intent. Terminating session ${sessionId}`);
              
              // Mark session as ended in DB
              // IMPORTANT: Use RETURNING * to confirm update
              const endResult = await db.query(`
                UPDATE sessions 
                SET dual_status = 'ended', expires_at = NOW() 
                WHERE session_id = $1
                RETURNING *
              `, [sessionId]);
              
              if (endResult.rows.length === 0) {
                  console.error('Failed to mark session as ended in DB');
              } else {
                  console.log('Session marked as ended in DB');
              }
              
              // Also terminate dual_group if using it
              const sessionRes = await db.query('SELECT dual_group_id FROM sessions WHERE session_id = $1', [sessionId]);
              if (sessionRes.rows.length > 0 && sessionRes.rows[0].dual_group_id) {
                  const dualGroupId = sessionRes.rows[0].dual_group_id;
                  await db.query(`
                    UPDATE dual_groups 
                    SET terminated_at = NOW() 
                    WHERE dual_group_id = $1
                  `, [dualGroupId]);
                  
                  // Also expire ALL sessions in this group
                  await db.query(`
                    UPDATE sessions 
                    SET dual_status = 'ended', expires_at = NOW()
                    WHERE dual_group_id = $1
                  `, [dualGroupId]);
              }

              // Log Analytics
              await db.query(
                `INSERT INTO analytics_events (session_id, event_type, event_data)
                 VALUES ($1, $2, $3)`,
                [sessionId, 'dual_session_terminated_mutual', {}]
              );
              
              // Broadcast termination
              io.to(sessionId).emit('dual_group_terminated');
              
              // Clean up memory
              pendingContexts.delete(sessionId);
              clearSessionState(sessionId);
              sessionStates.delete(sessionId);
          }
      } catch (err) {
          console.error('Error handling fresh_intent:', err);
      }
  });

  // Legacy/Single Mode Handler
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
        // Dual Mode should use 'dual_next_intent' event instead.
        // But for backward compatibility or if frontend sends this by mistake, we can redirect logic?
        // Let's just log a warning and ignore, enforcing the new flow.
        console.warn(`[Socket] Received request_next for Dual Mode session ${sessionId}. Ignored. Use dual_next_intent.`);
      }
    } catch (err) {
      console.error('Socket error:', err);
    }
  });

  // --- Welcome Screen Setup Synchronization ---

  socket.on('join_table_setup', ({ tableToken, lockToken }) => {
    if (!tableToken) return;
    const room = `setup_${tableToken}`;
    socket.join(room);
    socket.tableSetupToken = tableToken; // Track for disconnect
    console.log(`[Socket] ${socket.id} joined setup room for ${tableToken}`);
    
    // Check if locked
    const lock = setupLocks.get(tableToken);
    if (lock) {
      if (lockToken && lock.lockToken === lockToken) {
         socket.emit('setup_status', { status: 'granted' });
      } else {
         // If they don't have the token, they are busy unless stale
         const now = Date.now();
         if (now - lock.timestamp > 2 * 60 * 1000) {
            setupLocks.delete(tableToken);
            socket.emit('setup_status', { status: 'available' });
         } else {
            socket.emit('setup_status', { status: 'busy' });
         }
      }
    } else {
      socket.emit('setup_status', { status: 'available' });
    }
  });

  socket.on('claim_setup', ({ tableToken, lockToken }, callback) => {
    if (!tableToken) return;
    
    const lock = setupLocks.get(tableToken);
    const now = Date.now();
    
    // Check if locked by someone else
    if (lock && lock.lockToken !== lockToken) {
       // Check staleness
       if (now - lock.timestamp > 2 * 60 * 1000) {
          // Steal lock
          const newLockToken = require('crypto').randomUUID();
          setupLocks.set(tableToken, { lockToken: newLockToken, timestamp: now });
          io.to(`setup_${tableToken}`).emit('setup_claimed', { lockToken: newLockToken });
          if (callback) callback({ status: 'granted', lockToken: newLockToken });
       } else {
          if (callback) callback({ status: 'busy' });
       }
    } else {
       // Grant lock (or renew if they already had it)
       const newLockToken = lockToken || require('crypto').randomUUID();
       setupLocks.set(tableToken, { lockToken: newLockToken, timestamp: now });
       // Notify others in room
       socket.to(`setup_${tableToken}`).emit('setup_claimed', { lockToken: newLockToken });
       if (callback) callback({ status: 'granted', lockToken: newLockToken });
    }
  });
  
  socket.on('release_setup', ({ tableToken }) => {
      const lock = setupLocks.get(tableToken);
      if (lock && lock.socketId === socket.id) {
          setupLocks.delete(tableToken);
          io.to(`setup_${tableToken}`).emit('setup_released');
      }
  });

  socket.on('setup_completed', ({ tableToken, mode, sessionId }) => {
      // Clear the lock regardless of socket.id because the user might have reconnected
      // with a new socket.id during the setup flow.
      setupLocks.delete(tableToken);
      io.to(`setup_${tableToken}`).emit('setup_completed', { mode, sessionId });
  });

  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);
    
    // We intentionally DO NOT release the setup lock on disconnect anymore.
    // Mobile browsers frequently drop websocket connections during page navigation.
    // If we release the lock here, Phone B might slip in and start a concurrent setup.
    // The lock will naturally expire after 5 minutes, or be cleared by 'setup_completed'.
    
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

        // Check if session should terminate (no active phones + fresh intent exists)
        const sessionCheck = await db.query(`
          SELECT s.session_id, s.fresh_intent_a, s.fresh_intent_b, s.dual_group_id,
                 (SELECT COUNT(*) FROM session_participants p WHERE p.session_id = s.session_id AND p.disconnected_at IS NULL) as active_count
          FROM sessions s
          WHERE s.session_id = $1 AND s.dual_status != 'ended'
        `, [socket.sessionId]);

        if (sessionCheck.rows.length > 0) {
            const s = sessionCheck.rows[0];
            // Only terminate if both users have explicitly clicked Start Fresh and no one is active.
            if (s.active_count == 0 && s.fresh_intent_a && s.fresh_intent_b) {
                console.log(`[Socket] No active phones and mutual fresh_intent exists. Terminating session ${s.session_id}`);
                await db.query(`
                  UPDATE sessions SET dual_status = 'ended', expires_at = NOW() WHERE session_id = $1
                `, [s.session_id]);
                if (s.dual_group_id) {
                    await db.query(`UPDATE dual_groups SET terminated_at = NOW() WHERE dual_group_id = $1`, [s.dual_group_id]);
                    await db.query(`UPDATE sessions SET dual_status = 'ended', expires_at = NOW() WHERE dual_group_id = $1`, [s.dual_group_id]);
                }
                
                // Log Analytics
                await db.query(
                  `INSERT INTO analytics_events (session_id, event_type, event_data)
                   VALUES ($1, $2, $3)`,
                  [s.session_id, 'dual_session_terminated_inactive', { source: 'socket_disconnect' }]
                );
            }
        }

      } catch (err) {
        console.error('Error handling disconnect:', err);
      }
    }
  });
});

// IMPORTANT: Make sure this is at the END of the file
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}
