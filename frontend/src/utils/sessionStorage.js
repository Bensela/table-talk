export function storeParticipant(participantId, sessionId) {
  sessionStorage.setItem('participant_id', participantId);
  sessionStorage.setItem('session_id', sessionId);
}

export function getStoredParticipant() {
  return {
    participantId: sessionStorage.getItem('participant_id'),
    sessionId: sessionStorage.getItem('session_id')
  };
}

export function clearStoredParticipant() {
  sessionStorage.removeItem('participant_id');
  sessionStorage.removeItem('session_id');
}
