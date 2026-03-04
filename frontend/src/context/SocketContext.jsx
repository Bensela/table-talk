import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getStoredParticipant } from '../utils/sessionStorage';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  // Initialize Socket once
  const socketRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  
  // Use state to force re-render when socket is ready, but keep ref for stability
  const [socketInstance, setSocketInstance] = useState(null);

  useEffect(() => {
    // Only init once
    if (socketRef.current) return;

    const isDev = import.meta.env.DEV;
    const socketUrl = isDev 
      ? 'http://localhost:5000' 
      : 'https://octopus-app-ibal3.ondigitalocean.app';

    console.log('[SocketProvider] Initializing socket...');
    const socket = io(socketUrl, {
      path: isDev ? '/socket.io/' : '/api/socket.io/',
      transports: ['websocket'],
      upgrade: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 20000,
      secure: !isDev,
      rejectUnauthorized: false,
      autoConnect: false // Don't connect until we have a session/participant
    });

    socketRef.current = socket;
    setSocketInstance(socket);

    socket.on('connect', () => {
      console.log('✅ [SocketProvider] Connected:', socket.id);
      setIsConnected(true);
    });

    socket.on('disconnect', (reason) => {
      console.log('🔌 [SocketProvider] Disconnected:', reason);
      setIsConnected(false);
    });
    
    socket.on('connect_error', (err) => {
        console.error('❌ [SocketProvider] Connection Error:', err.message);
        setIsConnected(false);
    });

    // Cleanup on unmount (app close)
    return () => {
      console.log('[SocketProvider] Cleaning up socket...');
      socket.disconnect();
    };
  }, []);

  // Helper to ensure connection and join room
  const ensureConnection = (sessionId, participantId) => {
    const socket = socketRef.current;
    if (!socket) {
        console.warn('[SocketProvider] Socket not initialized yet');
        return;
    }

    if (!socket.connected) {
      console.log('[SocketProvider] Connecting socket...');
      socket.connect();
    }
    
    if (sessionId && participantId) {
        // Idempotent join: server handles duplicates gracefully
        // We emit this every time we want to "ensure" we are in the room (e.g. route change)
        console.log(`[SocketProvider] Ensuring join for session ${sessionId}`);
        socket.emit('join_session', { session_id: sessionId, participant_id: participantId });
    }
  };

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, isConnected, ensureConnection }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}

// Hook to ensure room membership matches current route/session
export function useEnsureSessionRoom(sessionId, mode) {
  const { ensureConnection } = useSocket();
  
  useEffect(() => {
    if (mode === 'dual-phone' && sessionId) {
       const stored = getStoredParticipant();
       if (stored.sessionId === sessionId && stored.participantId) {
           ensureConnection(sessionId, stored.participantId);
       }
    }
  }, [sessionId, mode, ensureConnection]);
}