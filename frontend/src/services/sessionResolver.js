
import { getSessionByTable, joinDualSession, resumeSessionByQr } from '../api';
import { getStoredParticipant, storeParticipant } from '../utils/sessionStorage';
import { v4 as uuidv4 } from 'uuid';

/**
 * Deterministically resolves the session state for a QR scan.
 * 
 * Rules:
 * 1. Attempt to resume existing session for this device (within 24h).
 * 2. If no resume, check for waiting dual-phone session (auto-join).
 * 3. If no waiting session, indicate new session start.
 * 
 * @param {string} tableToken - The table identifier from the QR code
 * @returns {Promise<{ action: 'resume'|'join'|'new', data: any }>}
 */
export async function resolveSessionForScan(tableToken) {
  // 1. Attempt Device Resume
  // Check local storage for existing participant token
  let stored = getStoredParticipant();
  
  // If no participant ID exists on this device at all, generate one now.
  // This ensures every device has a stable identity for the 24h window.
  if (!stored.participantId) {
    const newId = uuidv4();
    // We don't have a session yet, but we store the ID.
    // Note: storeParticipant expects (id, sessionId, token). 
    // We might need to update sessionStorage utils to handle partial data or just store ID manually.
    sessionStorage.setItem('participant_id', newId);
    stored = { participantId: newId };
  }

  // If we have a session ID and token locally, try to validate resume with backend
  if (stored.sessionId && stored.participantToken) {
    try {
      const resumeRes = await resumeSessionByQr({
        table_token: tableToken,
        participant_token: stored.participantToken
      });
      
      if (resumeRes.data && resumeRes.data.session_id) {
        console.log('[Resolver] Resumed existing session');
        return { action: 'resume', data: resumeRes.data };
      }
    } catch (err) {
      // Resume failed (expired, invalid token, or different table)
      // We proceed to check for new/join
      console.log('[Resolver] Resume failed, proceeding to resolve new state');
    }
  }

  // 2. Check for Waiting Dual Session (Auto-Join)
  try {
    const { data: waitingSession } = await getSessionByTable(tableToken);
    
    if (waitingSession && waitingSession.session_id && waitingSession.dual_status === 'waiting') {
      console.log('[Resolver] Found waiting partner');
      
      // Auto-join as Role B
      // Note: In a real "resolver" pattern, we might want to just RETURN that we should join,
      // but to keep it "deterministic" and "action-oriented", we can perform the join here.
      // However, usually resolvers just read. Let's read, then the caller acts?
      // The user prompt says "Scanning always routes immediately".
      // So let's perform the join if we are sure.
      
      const joinRes = await joinDualSession({ 
        session_id: waitingSession.session_id,
        table_token: tableToken 
      });
      
      // Store new session data
      storeParticipant(
        joinRes.data.participant_id,
        joinRes.data.session_id,
        joinRes.data.participant_token
      );
      
      return { action: 'join', data: joinRes.data };
    }
  } catch (err) {
    // 404 means no waiting session, which is fine.
  }

  // 3. Start New Session
  // No resume, no waiting partner -> New Session
  return { action: 'new', data: { tableToken } };
}
