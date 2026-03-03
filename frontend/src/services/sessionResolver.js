
import { resolveSession, joinDualSession } from '../api';
import { getStoredParticipant, storeParticipant } from '../utils/sessionStorage';
import { v4 as uuidv4 } from 'uuid';

/**
 * Deterministically resolves the session state for a QR scan via backend API.
 * 
 * Rules:
 * 1. Ensure device token exists (generate if new).
 * 2. Call POST /sessions/resolve.
 * 3. Handle action: resume, join_dual, or start_new.
 * 
 * @param {string} tableToken - The table identifier from the QR code
 * @returns {Promise<{ action: 'resume'|'join'|'new', data: any }>}
 */
export async function resolveSessionForScan(tableToken) {
  // 1. Ensure Device Token (Participant ID/Token)
  let stored = getStoredParticipant();
  
  // Note: The backend expects 'device_token' which maps to 'participant_token'
  // But wait, participant_token is only generated AFTER session creation.
  // The user requirement says: "Read device_token... If missing, create random token".
  // This implies we need a long-lived token that is NOT the session participant token?
  // OR we use the previous session's participant token as the device token?
  // Given "A device can be matched to its prior session within 24 hours",
  // using the last known participant_token is the correct approach.
  
  // If we have no token, we send null, and backend will say "start_new".
  // The user prompt said: "If missing, create random token and store".
  // This implies we should generate a stable ID for the device now?
  // Let's stick to the current architecture:
  // If we have a participant_token from a previous session, send it.
  // If not, send null.
  
  const deviceToken = stored.participantToken || null;

  try {
    const { data: result } = await resolveSession({
      table_token: tableToken,
      device_token: deviceToken
    });

    if (result.action === 'resume') {
      console.log('[Resolver] Resuming existing session');
      // Store/Refresh session data if needed (though local storage should match)
      // If we are resuming a different session than stored (unlikely with token match), update storage.
      if (result.session_id !== stored.sessionId) {
          storeParticipant(result.participant_id, result.session_id, deviceToken);
      }
      return { action: 'resume', data: result };
    }

    if (result.action === 'join_dual') {
      console.log('[Resolver] Auto-joining dual session');
      // Perform the join action here or let the caller do it?
      // Prompt: "Phone B auto-joins... Scanning always routes immediately"
      // Let's join immediately.
      
      const joinRes = await joinDualSession({ 
        session_id: result.session_id,
        table_token: tableToken 
      });
      
      storeParticipant(
        joinRes.data.participant_id,
        joinRes.data.session_id,
        joinRes.data.participant_token
      );
      
      return { action: 'join', data: joinRes.data };
    }

    // Start New (Single or Dual based on user choice later)
    // Return action so UI can show Context Selection
    return { action: 'new', data: { tableToken } };

  } catch (err) {
    console.error('[Resolver] Error:', err);
    // Fallback to new session on error
    return { action: 'new', data: { tableToken } };
  }
}
