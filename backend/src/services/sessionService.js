import { v4 as uuidv4 } from 'uuid';
import { SEED_QUESTIONS } from '../data/questions.js';
import { broadcastSessionUpdate } from './socketService.js';

// In-memory store for Phase 1
const sessions = new Map();

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_LIFESPAN_MS = 24 * 60 * 60 * 1000; // 24 hours

export const createSession = () => {
  const sessionId = uuidv4();
  const now = Date.now();
  const newSession = {
    id: sessionId,
    mode: null, // 'single_phone' | 'dual_phone'
    currentQuestionIndex: 0,
    isRevealed: false,
    questions: [...SEED_QUESTIONS],
    createdAt: now,
    lastActiveAt: now
  };
  sessions.set(sessionId, newSession);
  return newSession;
};

export const getSession = (sessionId) => {
  const session = sessions.get(sessionId);
  if (!session) return null;
  
  // Update last active on read? 
  // PRD says "Idle timeout: 30 minutes". Usually implies interaction. 
  // Simply reading state (reconnect) should probably count or not?
  // Let's say only actions count for "Active".
  // But reconnecting implies user is there. Let's update it to be safe.
  session.lastActiveAt = Date.now();
  return session;
};

export const setMode = (sessionId, mode) => {
  const session = sessions.get(sessionId);
  if (!session) return null;
  
  if (session.mode && session.mode !== mode) {
    // PRD: "Lock mode after selection". 
    // If user tries to select a different mode, throw error.
    // If user selects SAME mode (re-click or sync race), it's idempotent.
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
  }
  return session;
};

export const nextQuestion = (sessionId) => {
  const session = sessions.get(sessionId);
  if (!session) return null;

  if (!session.isRevealed) {
    throw new Error('Current question not revealed yet');
  }

  // If next is called multiple times, we need to be careful.
  // We can track a "lastActionId" or just rely on state.
  // If User A clicks Next, index increments, isRevealed becomes false.
  // If User B clicks Next immediately after, the state is now (index+1, hidden).
  // User B's request will fail "revealed check" if they are out of sync?
  // OR if they send "next for index 0", we can check provided index.
  // But strict requirement: "First valid action wins".
  // If A wins, state changes. B's request comes in. 
  // If B's request is "Next", check if current state allows Next.
  // Current state is (Index+1, Hidden). "Next" requires Revealed.
  // So B's request will fail with "Current question not revealed yet".
  // This IS correct conflict handling (reject invalid actions).
  
  if (session.currentQuestionIndex < session.questions.length - 1) {
    session.currentQuestionIndex++;
    session.isRevealed = false;
    session.lastActiveAt = Date.now();
    broadcastSessionUpdate(sessionId, session);
  } else {
    // End of deck
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
