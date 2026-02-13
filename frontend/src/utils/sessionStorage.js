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
    participantToken: sessionStorage.getItem('participant_token')
  };
}

export function clearStoredParticipant() {
  sessionStorage.removeItem('participant_id');
  sessionStorage.removeItem('session_id');
  sessionStorage.removeItem('participant_token');
}
