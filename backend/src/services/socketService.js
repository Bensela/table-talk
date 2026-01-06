import { getSession } from './sessionService.js';
import { logEvent } from './analyticsService.js';

let ioInstance;

export const setupSocket = (io) => {
  ioInstance = io;

  io.on('connection', (socket) => {
    // console.log('New client connected:', socket.id);

    socket.on('join_session', (sessionId) => {
      const session = getSession(sessionId);
      if (session) {
        socket.join(sessionId);
        // console.log(`Socket ${socket.id} joined session ${sessionId}`);
        
        // Broadcast participant count update
        broadcastParticipantCount(sessionId);

        // Send immediate state sync
        socket.emit('session_update', session);
        
        logEvent('reconnect_occurred', session);
      } else {
        socket.emit('error', { message: 'Session not found' });
      }
    });

    socket.on('disconnecting', () => {
      // Access rooms before they are left
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          // It's a session room
          // We need to broadcast AFTER the disconnect is fully processed or just subtract 1?
          // socket.io 'disconnecting' event is fired BEFORE leaving rooms.
          // So count is still inclusive.
          // We can schedule a broadcast for slightly later or calculate manually.
          // Better: Wait a tick.
          setTimeout(() => broadcastParticipantCount(room), 100);
        }
      }
    });

    socket.on('disconnect', () => {
      // console.log('Client disconnected:', socket.id);
    });
  });
};

const getParticipantCount = (sessionId) => {
  if (!ioInstance) return 0;
  const room = ioInstance.sockets.adapter.rooms.get(sessionId);
  return room ? room.size : 0;
};

export const broadcastParticipantCount = (sessionId) => {
  if (ioInstance) {
    const count = getParticipantCount(sessionId);
    ioInstance.to(sessionId).emit('participant_count', count);
  }
};

export const broadcastSessionUpdate = (sessionId, session) => {
  if (ioInstance) {
    ioInstance.to(sessionId).emit('session_update', session);
  }
};
