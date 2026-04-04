import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
// Removed local io import to use global provider
import api from '../api';
import QuestionCard from '../components/QuestionCard';
import SessionMenu from '../components/SessionMenu';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { getStoredParticipant, clearStoredParticipant, storeParticipant, setLastResetAt, clearDualSession } from '../utils/sessionStorage';
import { useSocket, useEnsureSessionRoom } from '../context/SocketContext';
import { SCANNER_ROUTE } from '../constants/routes';

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

// Logout Screen Component
function LogoutScreen({ navigate }) {
    useEffect(() => {
        const timer = setTimeout(() => {
            navigate('/');
        }, 3000);
        return () => clearTimeout(timer);
    }, [navigate]);

    return (
        <div className="min-h-screen flex items-center justify-center px-4 bg-gray-900/60 backdrop-blur-sm fixed inset-0 z-50">
            <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="relative bg-[#2f2f3a] w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden p-6 text-left"
            >
                {/* Header */}
                <div className="flex items-center gap-2 mb-4">
                    <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span className="text-gray-300 font-medium text-sm tracking-wide">
                        Session Expired
                    </span>
                </div>
                
                {/* Body Text */}
                <p className="text-gray-300 text-[15px] leading-relaxed mb-6">
                    You have been logged out due to inactivity. You will be redirected to the home page to scan a new QR code.
                </p>

                {/* Auto-redirect progress bar */}
                <div className="w-full bg-gray-700 h-1 rounded-full overflow-hidden mb-6">
                    <motion.div 
                        initial={{ width: "0%" }}
                        animate={{ width: "100%" }}
                        transition={{ duration: 3, ease: "linear" }}
                        className="h-full bg-[#06b6d4]"
                    />
                </div>
                
                {/* Footer / Action */}
                <div className="flex justify-end">
                    <button
                        onClick={() => navigate('/')}
                        className="bg-[#06b6d4] hover:bg-[#0891b2] text-gray-900 font-bold px-6 py-2 rounded-lg shadow-md transition-colors"
                    >
                        OK
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

export default function SessionGame() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [question, setQuestion] = useState(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [waitingForPartner, setWaitingForPartner] = useState(false);
  const [dualStatus, setDualStatus] = useState(null);
  const [partnerSelections, setPartnerSelections] = useState({});
  const [mode, setMode] = useState('single-phone');
  const [context, setContext] = useState('Exploring');
  const [isConnected, setIsConnected] = useState(false);
  const [participantId, setParticipantId] = useState(null);
  const [tableToken, setTableToken] = useState(null);
  const [hasClickedNext, setHasClickedNext] = useState(false);
  const [partnerIsReady, setPartnerIsReady] = useState(false);
  const [conversationStarted, setConversationStarted] = useState(false);
  const [pendingSwitchContext, setPendingSwitchContext] = useState(null);
  const [feedbackMessage, setFeedbackMessage] = useState(null);
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
        setDualStatus(sessionRes.data.dual_status);

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
    
    const onDualPartnerJoined = (data) => {
        console.log('[SessionGame] Partner joined dual session:', data);
        setDualStatus('paired');
        setFeedbackMessage("Partner joined the session!");
        setTimeout(() => setFeedbackMessage(null), 3000);
        // Fetch question to ensure we're synced
        fetchCurrentQuestion();
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
        if (data.dual_status) {
            setDualStatus(data.dual_status);
        }
        // ALWAYS fetch current question to ensure sync with server
        fetchCurrentQuestion();
    };

    // Attach listeners
    socket.on('connect', onConnect);
    socket.on('session_migrated', onMigrate);
    socket.on('session_updated', onSessionUpdated);
    socket.on('dual_partner_joined', onDualPartnerJoined);
    socket.on('dual_group_terminated', onDualGroupTerminated);
    
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
      if (data.message === 'Invalid participant or session' || data.message === 'Session expired') {
         setError('Session expired or not found. Please start a new one.');
         // Clear local storage so they don't try to auto-reconnect to a dead session
         clearStoredParticipant();
         if (tableToken) {
             clearDualSession(tableToken);
         }
      }
    };

    const onPartnerStatus = (data) => {
      console.log('Partner status:', data);
    };

    const onAnswerRevealed = () => {
      setIsRevealed(true);
    };

    const onPartnerAnswered = ({ role }) => {
        setFeedbackMessage("Partner has locked in their answer!");
        // Clear after a few seconds
        setTimeout(() => setFeedbackMessage(null), 5000);
    };

    const onRevealAnswers = (data) => {
       console.log('[SessionGame] Received reveal_answers:', data);
       if (data && data.selections) {
         setPartnerSelections(data.selections);
       }
       setIsRevealed(true);
       setWaitingForPartner(false);
       setFeedbackMessage(null); // Clear any waiting message
       setPartnerIsReady(false); // Ensure "Partner is ready" is hidden
       // For Multiple Choice, revealing answers completes Phase 1 automatically.
       // Reset Phase 1 local state so Phase 2 ("Next Question") can track properly.
       setHasClickedNext(false); 
       // Auto-start "Conversation Mode" for MCQs so the button becomes "Next Question" immediately
       setConversationStarted(true);
    };

    const onAdvanceQuestion = (data) => {
      console.log('Received advance_question event', data);
      fetchCurrentQuestion();
      setIsRevealed(false);
      setWaitingForPartner(false);
      setPartnerSelections({});
      setHasClickedNext(false); // Reset for the new question
      setPartnerIsReady(false);
      setConversationStarted(false); // Reset Conversation Mode
      setFeedbackMessage(null); // Clear any waiting message
      setModalState(prev => ({ ...prev, isOpen: false }));
    };

    const onConversationStart = () => {
        console.log('[SessionGame] Conversation Started');
        setConversationStarted(true);
        // Clear partner readiness text when moving to conversation mode
        setPartnerIsReady(false);
        // We must also reset hasClickedNext so that Phase 2 (Next Question) tracking starts fresh
        setHasClickedNext(false);
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
      // Only set partnerIsReady if we are NOT in conversation mode. 
      // If we are already in conversation mode, "Next Question" clicks shouldn't trigger "Partner is ready!"
      if (!conversationStarted) {
        setPartnerIsReady((prev) => {
            if (!hasClickedNext && count >= 1) return true;
            return prev;
        });
      }
    };
    
    // Listen for context switch intents
    const onPartnerContextIntent = ({ context: newContext }) => {
        // Partner requested to switch context. Show prompt.
        console.log("[SessionGame] Partner requested context switch to:", newContext);
        
        // If we also have a pending intent for the SAME context, we can just apply it locally
        // or let the backend's 'session_updated' event handle it.
        // We will just show the modal for now if they don't match.
        if (pendingSwitchContext === newContext) {
            console.log("[SessionGame] Mutual intent matched locally.");
            return;
        }

        setModalState({
            isOpen: true,
            title: 'Change Deck?',
            message: `Your partner wants to switch the conversation deck to "${newContext}". Do you agree?`,
            actionLabel: 'Yes, switch',
            closeLabel: 'No, keep current',
            action: async () => {
                // User Confirmed: Send intent to match partner
                setModalState(prev => ({ ...prev, isOpen: false }));
                // Set pending state so we don't get a loop if re-emitted
                setPendingSwitchContext(newContext);
                
                if (socketRef.current?.connected) {
                    console.log("[SessionGame] Confirming partner context switch:", newContext);
                    socketRef.current.emit('context_switch_intent', { context: newContext });
                }
            },
            // If user closes/declines, we must notify server to cancel the pending intent
            onClose: () => {
                console.log("[SessionGame] Declining partner context switch");
                if (socketRef.current?.connected) {
                    socketRef.current.emit('cancel_context_switch');
                }
                setModalState(prev => ({ ...prev, isOpen: false }));
            }
        });
    };
    
    // Listen for partner cancellation
    const onContextSwitchCancelled = () => {
        console.log("[SessionGame] Partner cancelled context switch");
        setPendingSwitchContext(null); // Clear my pending state
        
        // Show non-intrusive feedback below the button
        setFeedbackMessage("Partner declined the request");
        
        // Clear feedback after 5 seconds
        setTimeout(() => {
            setFeedbackMessage(null);
        }, 5000);
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
        if (tableToken) {
            clearDualSession(tableToken);
        }
        window.location.href = SCANNER_ROUTE;
    };

    const onPartnerWaitingToAdvance = () => {
        // Only show if we haven't clicked next ourselves
        if (!hasClickedNext) {
            setFeedbackMessage("Partner is waiting for you to click Next!");
        }
    };

    socket.on('connect_error', onConnectError);
    socket.on('disconnect', onDisconnect);
    socket.on('error', onError);
    socket.on('partner_status', onPartnerStatus);
    socket.on('answer_revealed', onAnswerRevealed);
    socket.on('partner_answered', onPartnerAnswered);
    socket.on('reveal_answers', onRevealAnswers);
    socket.on('advance_question', onAdvanceQuestion);
    socket.on('conversation_start', onConversationStart);
    socket.on('waiting_for_partner', onWaitingForPartner);
    socket.on('partner_waiting_to_advance', onPartnerWaitingToAdvance);
    socket.on('both_ready', onBothReady);
    socket.on('wait_timeout', onWaitTimeout);
    socket.on('next_intent_update', onNextIntentUpdate);
    socket.on('partner_context_intent', onPartnerContextIntent);
    socket.on('context_switch_cancelled', onContextSwitchCancelled);
    socket.on('partner_requested_fresh', onPartnerRequestedFresh);
    socket.on('dual_group_terminated', onDualGroupTerminated);

    return () => {
      // CLEANUP: Remove listeners but DO NOT disconnect socket
      socket.off('connect', onConnect);
      socket.off('session_migrated', onMigrate);
      socket.off('session_updated', onSessionUpdated);
      socket.off('dual_partner_joined', onDualPartnerJoined);
      socket.off('dual_group_terminated', onDualGroupTerminated);
      socket.off('connect_error', onConnectError);
      socket.off('disconnect', onDisconnect);
      socket.off('error', onError);
      socket.off('partner_status', onPartnerStatus);
      socket.off('answer_revealed', onAnswerRevealed);
      socket.off('partner_answered', onPartnerAnswered);
      socket.off('reveal_answers', onRevealAnswers);
      socket.off('advance_question', onAdvanceQuestion);
      socket.off('conversation_start', onConversationStart);
      socket.off('waiting_for_partner', onWaitingForPartner);
      socket.off('partner_waiting_to_advance', onPartnerWaitingToAdvance);
      socket.off('both_ready', onBothReady);
      socket.off('wait_timeout', onWaitTimeout);
      socket.off('next_intent_update', onNextIntentUpdate);
      socket.off('partner_context_intent', onPartnerContextIntent);
      socket.off('context_switch_cancelled', onContextSwitchCancelled);
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
            if (res.data.dual_status) {
                setDualStatus(res.data.dual_status);
            }
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
        // We do not setHasClickedNext(true) globally anymore here, because handleNext is used for both Phase 1 and Phase 2.
        // Wait, handleNext is passed to QuestionCard as `onNext`. QuestionCard ONLY calls it for Phase 1 (`handleNextIntent`).
        // For Phase 2, QuestionCard calls `onAdvanceTurn` directly!
        // So `handleNext` is ONLY Phase 1 (dual_next_intent).
        socketRef.current.emit('dual_next_intent');
        setHasClickedNext(true); // Mark locally as clicked (for Phase 1)
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
    // Remove clearStoredParticipant to remember device token so server can block/resume them
    // clearStoredParticipant();
    
    // Redirect to Front Page
    window.location.href = '/';
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
    // Check if it's a specific "logged out" error or general error
    // If the error message indicates expiration/inactivity, we can customize the UI.
    const isLogout = error.includes('expired') || error.includes('not found') || error.includes('Invalid session');
    
    if (isLogout) {
        // We use a separate useEffect to handle the redirect to avoid state/render conflicts during the timeout
        return (
            <LogoutScreen navigate={navigate} />
        );
    }

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
        onClose={modalState.onClose || (() => setModalState(prev => ({ ...prev, isOpen: false })))}
        title={modalState.title}
        actionLabel={modalState.actionLabel || "OK"}
        onAction={modalState.action}
        closeLabel={modalState.closeLabel || "Close"}
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

      {dualStatus === 'waiting' && mode === 'dual-phone' ? (
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-6 shadow-inner relative">
              <div className="absolute inset-0 border-4 border-blue-500 rounded-full border-t-transparent animate-spin opacity-50"></div>
              <span className="text-3xl">📱</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3 tracking-tight">Waiting for Partner</h2>
            <p className="text-gray-500 max-w-xs mx-auto text-base">
              Ask them to scan the QR code on the table to sync their device.
            </p>
        </div>
      ) : (
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
            feedbackMessage={feedbackMessage}
            conversationStarted={conversationStarted}
            onAdvanceTurn={() => {
                if (socketRef.current?.connected) {
                    socketRef.current.emit('advance_turn');
                    // We need to mark that THIS client has clicked the advance button
                    // so that they don't see the "Partner is waiting for you" message.
                    setHasClickedNext(true); 
                }
            }}
          />
        </div>
      )}
    </div>
  );
}
