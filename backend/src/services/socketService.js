import { getSession } from './sessionService.js';

let ioInstance;

export const setupSocket = (io) => {
  ioInstance = io;

  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('join_session', (sessionId) => {
      const session = getSession(sessionId);
      if (session) {
        socket.join(sessionId);
        console.log(`Socket ${socket.id} joined session ${sessionId}`);
        // Send immediate state sync
        socket.emit('session_update', session);
      } else {
        socket.emit('error', { message: 'Session not found' });
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
};

export const broadcastSessionUpdate = (sessionId, session) => {
  if (ioInstance) {
    ioInstance.to(sessionId).emit('session_update', session);
  }
};
