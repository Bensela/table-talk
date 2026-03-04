export function storeParticipant(participantId, sessionId, participantToken = null) {
  sessionStorage.setItem('participant_id', participantId);
  sessionStorage.setItem('session_id', sessionId);
  if (participantToken) {
    sessionStorage.setItem('participant_token', participantToken);
  }
}

export function getStoredParticipant() {
  return {
    participantId: sessionStorage.getItem('participant_id'),
    sessionId: sessionStorage.getItem('session_id'),
    participantToken: sessionStorage.getItem('participant_token'),
    lastResetAt: sessionStorage.getItem('last_reset_at')
  };
}

export function storeDualSession(tableToken, sessionId, participantId, participantToken) {
  const data = {
    sessionId,
    participantId,
    participantToken,
    timestamp: new Date().toISOString()
  };
  sessionStorage.setItem(`last_dual_data_${tableToken}`, JSON.stringify(data));
}

export function getDualSession(tableToken) {
  const raw = sessionStorage.getItem(`last_dual_data_${tableToken}`);
  if (!raw) return null;
  
  try {
    const data = JSON.parse(raw);
    
    // Check 24h expiry
    const now = new Date();
    const sessionTime = new Date(data.timestamp);
    const diffHours = (now - sessionTime) / (1000 * 60 * 60);
    
    if (diffHours > 24) {
      clearDualSession(tableToken);
      return null;
    }
    
    return data;
  } catch (e) {
    return null;
  }
}

export function clearDualSession(tableToken) {
  sessionStorage.removeItem(`last_dual_data_${tableToken}`);
}

export function clearStoredParticipant() {
  sessionStorage.removeItem('participant_id');
  sessionStorage.removeItem('session_id');
  sessionStorage.removeItem('participant_token');
  // NOTE: We intentionally do NOT clear last_reset_at here, 
  // because we might be clearing to start fresh, and we want to remember the reset time.
}

export function setLastResetAt() {
  sessionStorage.setItem('last_reset_at', new Date().toISOString());
}
