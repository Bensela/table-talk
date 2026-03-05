import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
// Removed local io import to use global provider
import api from '../api';
import QuestionCard from '../components/QuestionCard';
import SessionMenu from '../components/SessionMenu';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { getStoredParticipant, clearStoredParticipant, storeParticipant, setLastResetAt } from '../utils/sessionStorage';
import { useSocket, useEnsureSessionRoom } from '../context/SocketContext';

// Hook for session activity tracking
function useSessionActivity(sessionId, participantId) {
  useEffect(() => {
    if (!participantId) return;
    
    // Heartbeat every 60 seconds
    const heartbeat = setInterval(async () => {
      try {
        await api.post(`/sessions/${sessionId}/heartbeat`, { participant_id: participantId });
      } catch (err) {
        console.error('Heartbeat failed', err);
      }
    }, 60000);

    return () => clearInterval(heartbeat);
  }, [sessionId, participantId]);
}

import { SCANNER_ROUTE } from '../constants/routes';

export default function SessionGame() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [question, setQuestion] = useState(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [waitingForPartner, setWaitingForPartner] = useState(false);
  const [partnerSelections, setPartnerSelections] = useState({});
  const [mode, setMode] = useState('single-phone');
  const [context, setContext] = useState('Exploring');
  const [isConnected, setIsConnected] = useState(false);
  const [participantId, setParticipantId] = useState(null);
  const [tableToken, setTableToken] = useState(null);
  const [hasClickedNext, setHasClickedNext] = useState(false);
  const [partnerIsReady, setPartnerIsReady] = useState(false);
  const [pendingSwitchContext, setPendingSwitchContext] = useState(null);
  const [modalState, setModalState] = useState({ 
    isOpen: false, 
    title: '', 
    message: '', 
    action: null,
    icon: null
  });
  
  // Use Global Socket Provider
  const { socket: globalSocket, isConnected: globalIsConnected, ensureConnection } = useSocket();
  const socketRef = useRef(null); // Keep ref for local compatibility if needed, or replace usages
  
  // Sync global socket to local ref for minimal code changes
  useEffect(() => {
      socketRef.current = globalSocket;
  }, [globalSocket]);

  // Ensure we are in the right room
  useEnsureSessionRoom(sessionId, mode);

  const reconnectAttempts = useRef(0);

  // Initialize Session
  useEffect(() => {
    const initSession = async () => {
      try {
        // 1. Get Session Data
        const sessionRes = await api.get(`/sessions/${sessionId}`);
        if (sessionRes.data.expires_at && new Date(sessionRes.data.expires_at) < new Date()) {
          setError('Session expired. Please start a new one.');
          setLoading(false);
          return;
        }
        setMode(sessionRes.data.mode);
        setContext(sessionRes.data.context);
        setTableToken(sessionRes.data.table_token);

        // 2. Get Participant ID
        const stored = getStoredParticipant();
        if (stored.sessionId === sessionId && stored.participantId) {
          setParticipantId(stored.participantId);
        } else if (sessionRes.data.mode === 'dual-phone') {
           console.warn('Missing participant ID for dual session. Redirecting to join...');
           // Redirect to table landing to resolve/join properly
           if (sessionRes.data.table_token) {
             window.location.href = `/t/${sessionRes.data.table_token}`;
             return; // Stop execution to prevent loading invalid state
           }
        }

        // 3. Get Initial State
        // Only fetch if not already loaded (though useEffect dep is sessionId, so it runs once per session load)
        const stateRes = await api.get(`/sessions/${sessionId}/state?t=${Date.now()}`);
        console.log('[SessionGame] Initial State Response:', stateRes.data);
        if (stateRes.data && stateRes.data.current_question) {
          // Check if we have a stale question locally (unlikely on fresh load, but good practice)
          setQuestion(stateRes.data.current_question);
        } else {
           // Handle case where deck is empty or finished
           console.warn('[SessionGame] current_question is null in initial state:', stateRes.data);
           setQuestion(null);
        }
        setLoading(false);
      } catch (err) {
        console.error(err);
        // Only treat as error if 404/403 (expired/invalid)
        // If 500 or network error, maybe retry?
        if (err.response && (err.response.status === 404 || err.response.status === 403)) {
           clearStoredParticipant();
           setError('Session expired or not found. Please start a new one.');
        } else {
           setError('Connection error. Please refresh.');
        }
        setLoading(false);
      }
    };

    initSession();
  }, [sessionId]);

  // Activate Heartbeat
  useSessionActivity(sessionId, participantId);

  // Socket Connection Logic
  useEffect(() => {
    if (!participantId || !globalSocket) return; // Wait for participant ID and socket init

    // Join the session room
    ensureConnection(sessionId, participantId);

    const socket = globalSocket;
    
    // Listeners
    const onConnect = () => {
      console.log('✅ [SessionGame] Socket Connected');
      setIsConnected(true);
      reconnectAttempts.current = 0;
      
      // Re-assert join on reconnect
      socket.emit('join_session', { 
        session_id: sessionId, 
        participant_id: participantId 
      });

      // FORCE STATE SYNC:
      // Fetch current question state on reconnect to ensure sync
      // This overrides any local state that might have drifted while offline
      fetchCurrentQuestion();
    };

    const onMigrate = (data) => {
      if (data && data.newSessionId) {
        console.log('[SessionGame] Partner migrated session. Following...');
        window.location.href = `/session/${data.newSessionId}/game`;
      }
    };
    
    // Listen for session updates (Context/Mode changes)
    const onSessionUpdated = (data) => {
        console.log('[SessionGame] Session updated:', data);
        if (data.context) {
            setContext(data.context);
            // Clear pending switch context since it's now applied
            setPendingSwitchContext(null);
            // Close any open modals (e.g. Context Switch Request)
            setModalState(prev => ({ ...prev, isOpen: false }));
        }
        if (data.mode) {
            setMode(data.mode);
        }
        // ALWAYS fetch current question to ensure sync with server
        fetchCurrentQuestion();
    };

    // Attach listeners
    socket.on('connect', onConnect);
    socket.on('session_migrated', onMigrate);
    socket.on('session_updated', onSessionUpdated);
    
    // Also run onConnect immediately if already connected
    if (socket.connected) {
        onConnect();
    } else {
        socket.connect();
    }

    // Other listeners...
    const onConnectError = (err) => {
      console.error('❌ Socket Connection Error:', err.message);
      setIsConnected(false);
    };

    const onDisconnect = (reason) => {
      console.log('🔌 Disconnected:', reason);
      setIsConnected(false);
    };

    const onError = (data) => {
      console.error('Socket Error:', data);
      if (data.message === 'Invalid participant or session') {
         setError('Connection refused. Invalid session.');
      }
    };

    const onPartnerStatus = (data) => {
      console.log('Partner status:', data);
    };

    const onAnswerRevealed = () => {
      setIsRevealed(true);
    };

    const onRevealAnswers = (data) => {
       console.log('[SessionGame] Received reveal_answers:', data);
       if (data && data.selections) {
         setPartnerSelections(data.selections);
       }
       setIsRevealed(true);
       setWaitingForPartner(false);
    };

    const onAdvanceQuestion = (data) => {
      console.log('Received advance_question event', data);
      fetchCurrentQuestion();
      setIsRevealed(false);
      setWaitingForPartner(false);
      setPartnerSelections({});
      setHasClickedNext(false);
      setPartnerIsReady(false);
      setModalState(prev => ({ ...prev, isOpen: false }));
    };

    const onWaitingForPartner = () => {
      setWaitingForPartner(true);
    };
    
    const onBothReady = () => {
       setWaitingForPartner(false);
    };

    const onWaitTimeout = () => {
      setWaitingForPartner(false);
      setModalState({
        isOpen: true,
        title: 'Sync Timeout',
        message: 'It seems your partner is taking a while. You can try clicking Next again.',
        action: () => setModalState(prev => ({ ...prev, isOpen: false })),
        icon: '⏳'
      });
    };

    const onNextIntentUpdate = ({ count }) => {
      if (count >= 1 && !hasClickedNext) {
          setPartnerIsReady(true);
      }
    };
    
    // Listen for partner context switch intent
    const onPartnerContextIntent = ({ context, initiator_role }) => {
        // If I am the initiator, ignore this event
        // We can check role via local storage or if stored in state?
        // We don't have local role stored in state easily, but we know who initiated.
        // Wait, socket.io broadcasts to 'room'. If I am in the room, I get it.
        // We should check if we initiated it.
        // But the event says "initiator_role".
        // We need to know OUR role.
        // We fetch role in initSession but don't store it in state?
        // Let's store role in state or check against socket.role if accessible?
        // Actually, we can check if `socketRef.current` exists and check a property? No.
        
        // Easier: The server implementation of `socket.to(sessionId).emit(...)`
        // `socket.to(...)` sends to everyone in the room EXCEPT the sender.
        // So Phone A (sender) should NOT receive this event if the server uses `socket.to()`.
        
        // Let's verify backend code.
        // Backend: `socket.to(sessionId).emit('partner_context_intent', ...)`
        // This is correct. Phone A should NOT see it.
        
        // HOWEVER, Phone A *does* see the confirmation when Phone B clicks OK?
        // When Phone B clicks OK, it emits `context_switch_intent` too.
        // Then Server sees match -> broadcasts `session_updated`.
        
        // Why is Phone A seeing a popup "Context Switch Request"?
        // If Phone A initiates, Server sends `partner_context_intent` to Phone B.
        // Phone B sees popup. Phone B clicks OK.
        // Phone B emits `context_switch_intent`.
        // Server sees match.
        // Server sends `partner_context_intent` to Phone A?
        // In backend:
        // `socket.on('context_switch_intent')` -> `socket.to(sessionId).emit('partner_context_intent')`
        // YES. When Phone B confirms, it emits the intent.
        // The server receives it, stores it, sees it matches A's pending intent.
        // BUT it *also* emits `partner_context_intent` to A before checking the match?
        // Let's check backend logic.
        
        /* Backend Logic:
          // Store intent
          const pending = getPendingContextState(sessionId);
          pending[role] = context;
          
          // Notify partner
          socket.to(sessionId).emit('partner_context_intent', { ... });
          
          // Check if both match
          if (pending.A && pending.B && pending.A === pending.B) { ... }
        */
        
        // So YES, when B confirms (sends intent), A gets the notification "Partner wants to switch".
        // But since A *already* wants to switch (pending.A is set), A shouldn't see a request popup.
        // A should just wait for the switch.
        
        // Fix: We need to filter this on the frontend.
        // If I have already requested this context, I should ignore the partner's request (because it's just them agreeing).
        // Or better: The backend shouldn't send it if it completes the handshake?
        // Backend sends it *before* checking match.
        
        // Frontend Fix:
        // We need to track "I have pending switch intent".
        // But we don't have that state here easily.
        // We can add `pendingSwitchContext` state.
        
        // If I requested "Established", and I get a request for "Established", I know it's a handshake completion.
        // I should ignore the popup.
        
        // Let's add state `pendingSwitchContext`.
        
        if (pendingSwitchContext === context) {
            console.log("Ignoring partner context intent (handshake match):", context);
            return;
        }

        // Show modal informing user that partner wants to switch
        setModalState({
            isOpen: true,
            title: "Context Switch Request",
            message: `Your partner wants to switch to "${context}".`,
            action: async () => {
                // User Confirmed: Send intent to match partner
                setModalState(prev => ({ ...prev, isOpen: false }));
                // Set pending state so we don't get a loop if re-emitted
                setPendingSwitchContext(context);
                
                if (socketRef.current?.connected) {
                    console.log("[SessionGame] Confirming partner context switch:", context);
                    socketRef.current.emit('context_switch_intent', { context });
                }
            },
            icon: '🔄'
        });
    };
    
    // Listen for partner fresh intent
    const onPartnerRequestedFresh = () => {
        // Just show a toast/modal?
        // "Partner has requested to Start Fresh. If you also Start Fresh, the session will end permanently."
        // We don't force them out.
        // We can just log it or show subtle indicator.
        console.log('[SessionGame] Partner requested fresh intent.');
    };
    
    const onDualGroupTerminated = () => {
        // Both users confirmed Start Fresh.
        // Force redirect to scanner.
        console.log('[SessionGame] Dual Group Terminated. Redirecting...');
        setLastResetAt();
        clearStoredParticipant();
        window.location.href = SCANNER_ROUTE;
    };

    socket.on('connect_error', onConnectError);
    socket.on('disconnect', onDisconnect);
    socket.on('error', onError);
    socket.on('partner_status', onPartnerStatus);
    socket.on('answer_revealed', onAnswerRevealed);
    socket.on('reveal_answers', onRevealAnswers);
    socket.on('advance_question', onAdvanceQuestion);
    socket.on('waiting_for_partner', onWaitingForPartner);
    socket.on('both_ready', onBothReady);
    socket.on('wait_timeout', onWaitTimeout);
    socket.on('next_intent_update', onNextIntentUpdate);
    socket.on('partner_context_intent', onPartnerContextIntent);
    socket.on('partner_requested_fresh', onPartnerRequestedFresh);
    socket.on('dual_group_terminated', onDualGroupTerminated);

    return () => {
      // CLEANUP: Remove listeners but DO NOT disconnect socket
      socket.off('connect', onConnect);
      socket.off('session_migrated', onMigrate);
      socket.off('session_updated', onSessionUpdated);
      socket.off('connect_error', onConnectError);
      socket.off('disconnect', onDisconnect);
      socket.off('error', onError);
      socket.off('partner_status', onPartnerStatus);
      socket.off('answer_revealed', onAnswerRevealed);
      socket.off('reveal_answers', onRevealAnswers);
      socket.off('advance_question', onAdvanceQuestion);
      socket.off('waiting_for_partner', onWaitingForPartner);
      socket.off('both_ready', onBothReady);
      socket.off('wait_timeout', onWaitTimeout);
      socket.off('next_intent_update', onNextIntentUpdate);
      socket.off('partner_context_intent', onPartnerContextIntent);
      socket.off('partner_requested_fresh', onPartnerRequestedFresh);
      socket.off('dual_group_terminated', onDualGroupTerminated);
    };
  }, [sessionId, participantId, hasClickedNext, globalSocket]);

  // Handle Visibility Change (Background/Foreground)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[SessionGame] App foregrounded. Syncing state...');
        fetchCurrentQuestion();
        if (globalSocket && !globalSocket.connected) {
            globalSocket.connect();
        }
      }
    };
    
    // ... rest of visibility logic
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sessionId, globalSocket]); 

  // Handle Visibility Change (Background/Foreground)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[SessionGame] App foregrounded. Syncing state...');
        fetchCurrentQuestion();
        if (socketRef.current && !socketRef.current.connected) {
          socketRef.current.connect();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sessionId]); // Re-bind if sessionId changes 

  const fetchCurrentQuestion = async () => {
      try {
        const res = await api.get(`/sessions/${sessionId}/state?t=${Date.now()}`);
        console.log('[SessionGame] State Response (Raw):', res);
        console.log('[SessionGame] State Data:', res.data);
        
        if (res.data && res.data.current_question) {
          console.log('[SessionGame] Setting question:', res.data.current_question);
          setQuestion(res.data.current_question);
        } else {
          console.warn('[SessionGame] current_question is missing/null:', res.data);
          setQuestion(null);
        }
        
        // Ensure mode/context is up to date in case it changed remotely
        if (res.data) {
            setMode(res.data.mode);
            setContext(res.data.context);
        }
      } catch (err) {
        console.error('Error syncing state:', err);
      }
    };

  const handleReveal = async () => {
    // If dual mode, emit socket event first for sync
    if (mode === 'dual-phone') {
        if (socketRef.current && isConnected) {
            socketRef.current.emit('reveal_answer', { sessionId });
        }
    }
    
    setIsRevealed(true);
    
    try {
      await api.post(`/sessions/${sessionId}/answer/reveal`, { 
        question_id: question.question_id 
      });
    } catch (err) { console.error(err); }
  };

  const handleNext = async () => {
    // Single Phone Logic
    if (mode === 'single-phone' || mode === 'single') {
      try {
        await api.post(`/sessions/${sessionId}/questions/next`);
        fetchCurrentQuestion();
        setIsRevealed(false);
      } catch (err) {
        console.error('Error advancing deck:', err);
      }
      return;
    } 
    
    // Dual Phone Logic
    if (socketRef.current?.connected) {
        // Emit dual_next_intent (New Flow)
        socketRef.current.emit('dual_next_intent');
        setHasClickedNext(true); // Mark locally as clicked
    } else {
        // Attempt to reconnect if disconnected
        console.warn('Socket disconnected, attempting reconnect...');
        socketRef.current?.connect();
        
        setModalState({
          isOpen: true,
          title: 'Reconnecting...',
          message: 'Connection to partner lost. Attempting to reconnect...',
          action: () => {
            setModalState(prev => ({ ...prev, isOpen: false }));
            if (socketRef.current?.connected) {
               socketRef.current.emit('dual_next_intent');
               setHasClickedNext(true); // Mark locally as clicked
            }
          },
          icon: '🔄'
        });
    }
  };

  const handleRestart = () => {
    if (!tableToken) return;
    setLastResetAt(); // Mark that user explicitly reset
    clearStoredParticipant();
    
    // Do not disconnect socket manually, provider handles it or keeps it alive.
    // window.location.href = `/t/${tableToken}`; // Old behavior
    window.location.href = '/'; // Correct behavior: Front Page
  };

  if (loading && !question) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
          <p className="text-gray-500 font-bold animate-pulse">Loading conversation...</p>
        </div>
      </div>
    );
  }

  // Ensure question exists before rendering QuestionCard to prevent null prop errors
  if (!question && !loading && !error) {
      // Fallback for empty deck or state sync issue
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-white">
           <div className="text-center">
              <h2 className="text-xl font-bold text-gray-800 mb-2">No Question Available</h2>
              <p className="text-gray-500 mb-6">We couldn't load the current question.</p>
              <Button onClick={() => window.location.reload()} variant="black">Reload</Button>
           </div>
        </div>
      );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-white">
        <div className="bg-gray-50 p-8 rounded-3xl border border-gray-100 text-center max-w-sm w-full">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold mb-2">Session Error</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <Button 
            onClick={() => navigate('/')}
            variant="black"
            fullWidth
          >
            Go Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col p-6 font-sans selection:bg-blue-100 selection:text-blue-900 relative overflow-hidden">
      
      {/* Background Ambience */}
      <div className="absolute top-[-20%] left-[-20%] w-[500px] h-[500px] bg-blue-50/60 rounded-full blur-3xl pointer-events-none opacity-40" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[500px] h-[500px] bg-purple-50/60 rounded-full blur-3xl pointer-events-none opacity-40" />

      {/* Modal Popup */}
      <Modal
        isOpen={modalState.isOpen}
        onClose={() => setModalState(prev => ({ ...prev, isOpen: false }))}
        title={modalState.title}
        actionLabel="OK"
        onAction={modalState.action}
        icon={modalState.icon}
      >
        {modalState.message}
      </Modal>

      {/* Header */}
      <header className="flex justify-between items-center mb-8 relative z-10">
        <SessionMenu 
          tableToken={tableToken}
          currentContext={context}
          currentMode={mode}
          socketRef={socketRef}
          onSessionChange={(data) => {
             if (data.pendingContext) {
                 setPendingSwitchContext(data.pendingContext);
             }
          }}
        />
        
        <div className="flex items-center gap-2">
          {/* Connection Status Indicator */}
          {mode === 'dual-phone' && (
            <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500 animate-pulse'}`} 
                 title={isConnected ? 'Connected' : 'Disconnected'}
            />
          )}
          
          <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border ${
            mode === 'dual-phone' 
              ? 'bg-purple-50 text-purple-700 border-purple-100' 
              : 'bg-blue-50 text-blue-700 border-blue-100'
          }`}>
            {mode === 'dual-phone' ? 'Dual Sync' : 'Single Mode'}
          </div>
        </div>
      </header>

      <div className="relative z-10 flex-1 flex flex-col">
        <QuestionCard 
          question={question} 
          isRevealed={isRevealed}
          onReveal={handleReveal}
          onNext={handleNext}
          waitingForPartner={waitingForPartner}
          mode={mode}
          socket={socketRef.current}
          sessionId={sessionId}
          userId={participantId}
          partnerSelectionsData={partnerSelections}
          partnerIsReady={partnerIsReady}
        />
      </div>
    </div>
  );
}
