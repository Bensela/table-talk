import { v4 as uuidv4 } from 'uuid';
import { getDailyDeck } from './deckService.js';
import { broadcastSessionUpdate } from './socketService.js';
import { logEvent } from './analyticsService.js';

// In-memory store for Phase 1
const sessions = new Map();

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_LIFESPAN_MS = 24 * 60 * 60 * 1000; // 24 hours

export const createSession = () => {
  const sessionId = uuidv4();
  const now = Date.now();
  
  // Use daily deck service
  const deck = getDailyDeck();
  
  const newSession = {
    id: sessionId,
    mode: null, // 'single_phone' | 'dual_phone'
    currentQuestionIndex: 0,
    isRevealed: false,
    questions: deck,
    createdAt: now,
    lastActiveAt: now
  };
  
  sessions.set(sessionId, newSession);
  logEvent('session_started', newSession);
  return newSession;
};

export const getSession = (sessionId) => {
  const session = sessions.get(sessionId);
  if (!session) return null;
  
  // Reconnect logic
  session.lastActiveAt = Date.now();
  
  // We log reconnects if we can distinguish them, but `getSession` is called on simple API fetch too.
  // The socket `join_session` is a better place for 'reconnect_occurred', 
  // OR we can infer it if the session exists and is being fetched. 
  // But standard REST get isn't always a "reconnect". 
  // Let's rely on socket for "reconnect" or explicit intent. 
  // However, PRD says "reconnect_occurred" is an event.
  // We'll log it in the socketService when a user joins an existing session.
  
  return session;
};

export const setMode = (sessionId, mode) => {
  const session = sessions.get(sessionId);
  if (!session) return null;
  
  if (session.mode && session.mode !== mode) {
     throw new Error('Mode already selected');
  }
  
  if (mode !== 'single_phone' && mode !== 'dual_phone') {
    throw new Error('Invalid mode');
  }

  // Idempotent update
  if (!session.mode) {
    session.mode = mode;
    session.lastActiveAt = Date.now();
    broadcastSessionUpdate(sessionId, session);
    logEvent('mode_selected', session);
  }
  
  return session;
};

export const revealQuestion = (sessionId) => {
  const session = sessions.get(sessionId);
  if (!session) return null;

  // Idempotent: If already revealed, do nothing but return success
  if (!session.isRevealed) {
    session.isRevealed = true;
    session.lastActiveAt = Date.now();
    broadcastSessionUpdate(sessionId, session);
    // Note: 'question_revealed' isn't in minimum events list, but good for debug. 
    // PRD only asks for 'question_advanced'.
  }
  return session;
};

export const nextQuestion = (sessionId) => {
  const session = sessions.get(sessionId);
  if (!session) return null;

  if (!session.isRevealed) {
    throw new Error('Current question not revealed yet');
  }

  if (session.currentQuestionIndex < session.questions.length - 1) {
    session.currentQuestionIndex++;
    session.isRevealed = false;
    session.lastActiveAt = Date.now();
    broadcastSessionUpdate(sessionId, session);
    logEvent('question_advanced', session);
  } else {
    // End of deck
    logEvent('session_completed', session);
    return session; 
  }

  return session;
};

export const cleanupSessions = () => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    const isIdle = (now - session.lastActiveAt) > IDLE_TIMEOUT_MS;
    const isExpired = (now - session.createdAt) > MAX_LIFESPAN_MS;
    
    if (isIdle || isExpired) {
      sessions.delete(id);
      // Optional: Emit session_expired event if socket still open
      broadcastSessionUpdate(id, { error: 'Session expired' });
    }
  }
};
