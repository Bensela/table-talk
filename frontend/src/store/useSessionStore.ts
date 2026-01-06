import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { Session } from '../types';
import { sessionApi } from '@/api/client';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface SessionState {
  session: Session | null;
  isLoading: boolean;
  error: string | null;
  socket: Socket | null;
  participantCount: number;
  isConnected: boolean;
  
  createSession: () => Promise<void>;
  fetchSession: (sessionId: string) => Promise<void>;
  setMode: (mode: 'single_phone' | 'dual_phone') => Promise<void>;
  revealQuestion: () => Promise<void>;
  nextQuestion: () => Promise<void>;
  connectSocket: (sessionId: string) => void;
  disconnectSocket: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  session: null,
  isLoading: false,
  error: null,
  socket: null,
  participantCount: 0,
  isConnected: false,

  createSession: async () => {
    set({ isLoading: true, error: null });
    try {
      const session = await sessionApi.createSession();
      set({ session, isLoading: false });
    } catch (err) {
      set({ error: 'Failed to create session', isLoading: false });
    }
  },

  fetchSession: async (sessionId: string) => {
    set({ isLoading: true, error: null });
    try {
      const session = await sessionApi.getSession(sessionId);
      set({ session, isLoading: false });
      // Connect socket after successful fetch
      get().connectSocket(sessionId);
    } catch (err) {
      set({ error: 'Failed to load session', isLoading: false });
    }
  },

  connectSocket: (sessionId: string) => {
    const { socket } = get();
    if (socket && socket.connected) return;

    // Use URL from env
    const newSocket = io(SOCKET_URL); 

    newSocket.on('connect', () => {
      console.log('Socket connected');
      newSocket.emit('join_session', sessionId);
      set({ isConnected: true, error: null });
    });

    newSocket.on('disconnect', () => {
      console.log('Socket disconnected');
      set({ isConnected: false });
    });

    newSocket.on('session_update', (updatedSession: Session) => {
      console.log('Received session update:', updatedSession);
      set({ session: updatedSession });
    });
    
    newSocket.on('participant_count', (count: number) => {
      console.log('Participant count:', count);
      set({ participantCount: count });
    });

    newSocket.on('error', (err) => {
      console.error('Socket error:', err);
      // Optional: set({ error: 'Connection error' });
    });

    set({ socket: newSocket });
  },

  disconnectSocket: () => {
    const { socket } = get();
    if (socket) {
      socket.disconnect();
      set({ socket: null, isConnected: false, participantCount: 0 });
    }
  },

  setMode: async (mode) => {
    const { session } = get();
    if (!session) return;
    
    set({ isLoading: true, error: null });
    try {
      const updatedSession = await sessionApi.setMode(session.id, mode);
      set({ session: updatedSession, isLoading: false });
    } catch (err) {
      set({ error: 'Failed to set mode', isLoading: false });
    }
  },

  revealQuestion: async () => {
    const { session } = get();
    if (!session) return;

    // Optimistic update
    set((state) => ({
      session: state.session ? { ...state.session, isRevealed: true } : null
    }));

    try {
      const updatedSession = await sessionApi.revealQuestion(session.id);
      set({ session: updatedSession });
    } catch (err) {
      // Revert on failure
      set((state) => ({
        session: state.session ? { ...state.session, isRevealed: false } : null,
        error: 'Failed to reveal'
      }));
    }
  },

  nextQuestion: async () => {
    const { session } = get();
    if (!session) return;

    set({ isLoading: true, error: null });
    try {
      const updatedSession = await sessionApi.nextQuestion(session.id);
      set({ session: updatedSession, isLoading: false });
    } catch (err) {
      set({ error: 'Failed to advance question', isLoading: false });
    }
  },
}));
