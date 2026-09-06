import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
// Removed local io import to use global provider
import api, { createSession } from '../api';
import QuestionCard from '../components/QuestionCard';
import SessionMenu from '../components/SessionMenu';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { getStoredParticipant, clearStoredParticipant, storeParticipant, setLastResetAt, clearDualSession, storeDualSession, getDualSession, getRestaurantSlug } from '../utils/sessionStorage';
import { useSocket, useEnsureSessionRoom } from '../context/SocketContext';
import { SCANNER_ROUTE } from '../constants/routes';
import useAnalytics from '../hooks/useAnalytics';

// #region debug-point session-ready-next bootstrap
// Inline instrumentation bootstrap for Dual-Mode Ready/Next stability debugging.
// Reports to local Debug Server (http://127.0.0.1:7777/event) with sessionId
// `session-ready-next`. No business logic changes — evidence only.
// #endregion

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
  const { fireSession } = useAnalytics();
  
  const questionShownAtRef = useRef(null);
  const previousQuestionIdRef = useRef(null);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [question, setQuestion] = useState(null);
  const questionIdRef = useRef(null);
  useEffect(() => {
    questionIdRef.current = question?.question_id || null;
  }, [question]);

  // Funnel event: each time a distinct question is rendered, emit question_shown
  // and compute the previous question's dwell time.
  useEffect(() => {
    const qid = question?.question_id;
    if (!qid) return;
    if (qid === previousQuestionIdRef.current) return;

    // Hide "Conversation in Progress..." overlay once a NEW question_id loads
    // (either after a dual advance completes, or a local single-mode deck
    // advance). Sync ref first so any subsequent render guard exits fast.
    if (conversationProgressVisibleRef.current) {
      conversationProgressVisibleRef.current = false;
      setConversationProgressVisible(false);
    }
    const now = Date.now();
    const latency_ms = questionShownAtRef.current ? now - questionShownAtRef.current : null;

    if (previousQuestionIdRef.current && latency_ms != null) {
      fireSession({
        event_type: 'question_dwell_complete',
        event_data: {
          question_id: previousQuestionIdRef.current,
          dwell_ms: latency_ms,
          mode,
          context,
          position_index: question?.position_index ?? null
        },
        ids: { session_id: sessionId, participant_id: participantId }
      });
    }

    fireSession({
      event_type: 'question_shown',
      event_data: {
        question_id: qid,
        type: question?.type || null,
        position_index: question?.position_index ?? null,
        difficulty: question?.difficulty ?? null,
        mode,
        context
      },
      ids: { session_id: sessionId, participant_id: participantId }
    });

    fireSession({
      event_type: 'question_viewed',
      event_data: {
        question_id: qid,
        type: question?.type || null,
        position_index: question?.position_index ?? null,
        difficulty: question?.difficulty ?? null,
        mode,
        context
      },
      ids: { session_id: sessionId, participant_id: participantId }
    });

    previousQuestionIdRef.current = qid;
    questionShownAtRef.current = now;
  }, [question?.question_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [isRevealed, setIsRevealed] = useState(false);
  const [waitingForPartner, setWaitingForPartner] = useState(false);
  const [dualStatus, setDualStatus] = useState(null);
  const dualStatusRef = useRef(null);
  const [waitingCause, setWaitingCause] = useState('initial');
  const waitingCauseRef = useRef('initial');
  const [partnerSelections, setPartnerSelections] = useState({});
  const [mode, setMode] = useState('single-phone');
  const modeRef = useRef('single-phone');
  // Absolute deadline for simplified-Start-Fresh 20-second countdown. null means no countdown.
  // Uses absolute timestamp so returning from backgrounding recomputes the remaining seconds
  // correctly (setInterval pauses on mobile, but Date.now() never lies).
  // DECLARATION ORDER MATTERS: state MUST come BEFORE the useEffect sync-ref block below
  // to avoid a Temporal Dead Zone crash (Firefox: "Cannot access 'freshDeadlineMs' before
  // initialization" at line 177).
  const [freshDeadlineMs, setFreshDeadlineMs] = useState(null);
  const [freshCountdown, setFreshCountdown] = useState(null); // Display seconds (20, 19, ..., 0)
  // Synchronous refs (set directly inside event listeners, before any React state
  // setter runs) so any state-setting callbacks invoked mid-batch during socket
  // event storms always read the latest intent value — never waiting on React
  // state batching / useEffect reconciliation (which can be 1-3 ms later and is
  // why mid-batch ref reads via useEffect returned stale "initial" in the
  // Single=>Dual upgrade Start Fresh race).
  const waitingFreshLockRef = useRef(false);  // partner_requested_fresh / Start Fresh intent asserted
  const freshDeadlineMsRef = useRef(null);    // Absolute deadline for Start Fresh 20s window. Synchronous (no batching).
  // If THIS phone initiated Start Fresh (clicked menu Start Fresh itself), never show
  // the Waiting Partner UI. During the 30ms redirect window the socket/poll writes
  // dual_status=waiting+partner_fresh to BOTH phones — skip rendering that on initiator.
  const localFreshInitiatedRef = useRef(false);
  useEffect(() => { dualStatusRef.current = dualStatus; }, [dualStatus]);
  useEffect(() => { waitingCauseRef.current = waitingCause; }, [waitingCause]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { freshDeadlineMsRef.current = freshDeadlineMs; }, [freshDeadlineMs]);
  
  const [context, setContext] = useState('Exploring');
  const [isConnected, setIsConnected] = useState(false);
  const [participantId, setParticipantId] = useState(null);
  const [tableToken, setTableToken] = useState(null);
  const [hasClickedNext, setHasClickedNext] = useState(false);
  const hasClickedNextRef = useRef(false);
  useEffect(() => { hasClickedNextRef.current = hasClickedNext; }, [hasClickedNext]);
  const [partnerIsReady, setPartnerIsReady] = useState(false);
  const partnerIsReadyRef = useRef(false);
  useEffect(() => { partnerIsReadyRef.current = partnerIsReady; }, [partnerIsReady]);
  const [hasPartnerJoined, setHasPartnerJoined] = useState(false);
  const hasPartnerJoinedRef = useRef(false);
  useEffect(() => {
      hasPartnerJoinedRef.current = hasPartnerJoined;
  }, [hasPartnerJoined]);
  
  const [conversationStarted, setConversationStarted] = useState(false);
  const conversationStartedRef = useRef(false);
  useEffect(() => { conversationStartedRef.current = conversationStarted; }, [conversationStarted]);
  const [nextIntentCount, setNextIntentCount] = useState(0); // State 1 ready count (0, 1, 2)
  const nextIntentCountRef = useRef(0);
  useEffect(() => { nextIntentCountRef.current = nextIntentCount; }, [nextIntentCount]);
  const [advanceIntentCount, setAdvanceIntentCount] = useState(0); // State 2 Next Question count (0, 1, 2)
  const advanceIntentCountRef = useRef(0);
  useEffect(() => { advanceIntentCountRef.current = advanceIntentCount; }, [advanceIntentCount]);
  const [conversationProgressVisible, setConversationProgressVisible] = useState(false);
  const conversationProgressVisibleRef = useRef(false); // sync ref, no React batching
  useEffect(() => { conversationProgressVisibleRef.current = conversationProgressVisible; }, [conversationProgressVisible]);
  const [pendingSwitchContext, setPendingSwitchContext] = useState(null);
  const [feedbackMessage, setFeedbackMessage] = useState(null);
  const feedbackMessageRef = useRef(null);
  useEffect(() => { feedbackMessageRef.current = feedbackMessage; }, [feedbackMessage]);
  const [nullQRetry, setNullQRetry] = useState(0);
  const coalesceFetchRef = useRef({ lastRunAt: 0, pendingTimer: null, running: false });
  // #region fix H3:double-click-race — last-click timestamp refs (debounce <300ms)
  const readyLastClickRef = useRef(0);
  const advanceLastClickRef = useRef(0);
  // #endregion
  // #region fix NET:retry — emitWithRetry helper (exponential backoff with acknowledgement)
  // Wraps socket.emit in a Promise + retry loop. Socket.io v4 will not emit when
  // disconnected (queue may flush) — for our case we add explicit acknowledgement:
  // server echoes via next_intent_update/advance_intent_update broadcast, but for
  // reliability we retry a bounded number of times, then surface error to user.
  const emitWithRetry = (socket, eventName, payload, delaysMs = [1000, 2000, 4000]) => {
    return new Promise((resolve, reject) => {
      let attempt = 0;
      const tryOnce = () => {
        try {
          if (!socket) { reject(new Error('socket null')); return; }
          if (!socket.connected) {
            // Attempt connect on next tick
            try { socket.connect(); } catch (_) { /* ignore */ }
          }
          socket.emit(eventName, payload);
          // Treat emit() as success after 250ms if socket stays connected
          // (socket.io locally buffers emit packets internally when disconnected)
          setTimeout(() => {
            if (socket.connected || socket.io?.engine?.transport) {
              resolve(true);
            } else {
              scheduleRetry(new Error('socket not connected after emit'));
            }
          }, 250);
        } catch (e) {
          scheduleRetry(e);
        }
      };
      const scheduleRetry = (err) => {
        if (attempt >= delaysMs.length) { reject(err); return; }
        const delay = delaysMs[attempt]; attempt += 1;
        setTimeout(tryOnce, delay);
      };
      tryOnce();
    });
  };
  // #endregion
  // #region debug-point next-question-perf D:http-reconcile-overwrites | H3:click-race | H1:listener-dup | H2:bg-reconnect | H4:intent-state-stale
  // Evidence reporter — one-liner, no business logic change. Reports to local Debug Server.
  const __dbgRef = useRef({ runId: 'pre-fix', seq: 0, mounts: 0, listenerCounts: new Map() });
  const __dbg = (hypothesisId, location, msg, data = {}) => {
    try {
      __dbgRef.current.seq += 1;
      const payload = {
        sessionId: 'next-question-perf',
        runId: __dbgRef.current.runId,
        hypothesisId,
        location,
        msg: `[DEBUG] ${msg}`,
        data: { seq: __dbgRef.current.seq, pid: participantId || null, sid: sessionId || null, ...data },
        ts: Date.now()
      };
      fetch('http://127.0.0.1:7777/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(() => {});
    } catch (_) { /* silent: no-op if debug server down */ }
  };
  // #endregion
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
        // Remove flaky client-side date checks, trust the backend.
        if (sessionRes.data.dual_status === 'ended') {
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
        const storedPid = (stored.sessionId === sessionId && stored.participantId) ? stored.participantId : null;
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
        const pidParam = storedPid ? `&participant_id=${encodeURIComponent(storedPid)}` : '';
        const stateRes = await api.get(`/sessions/${sessionId}/state?t=${Date.now()}${pidParam}`);
        console.log('[SessionGame] Initial State Response:', stateRes.data);
        if (stateRes.data && stateRes.data.current_question) {
          // Check if we have a stale question locally (unlikely on fresh load, but good practice)
          setQuestion(stateRes.data.current_question);
        } else {
           // Handle case where deck is empty or finished
           console.warn('[SessionGame] current_question is null in initial state:', stateRes.data);
           setQuestion(null);
        }
        if (stateRes.data?.dual_status === 'waiting' && stateRes.data?.waiting_reason) {
          setWaitingCause(stateRes.data.waiting_reason);
        }
        setLoading(false);
      } catch (err) {
        console.error(err);
        // Only treat as error if 404/403 (expired/invalid)
        // If 500 or network error, maybe retry?
        if (err.response && (err.response.status === 404 || err.response.status === 403)) {
           if (err.response.status === 403 && err.response.data?.error === 'INACTIVE') {
             setError('Logged out due to inactivity. Scan the same table QR code to rejoin.');
           } else {
             clearStoredParticipant();
             setError('Session expired or not found. Please start a new one.');
           }
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
      const isReconnect = reconnectAttempts.current > 0;
      setIsConnected(true);
      reconnectAttempts.current = 0;

      if (isReconnect) {
        fireSession({
          event_type: 'reconnect_succeeded',
          event_data: { source: 'socket.connect' },
          ids: { session_id: sessionId, participant_id: participantId }
        });
      }
      
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
        
        if (data && data.participant_id === participantId) {
            return; // Ignore our own join event
        }
        
        // BULLETPROOF early-exit: if Start Fresh / partner_single waiting lock
        // flag is set synchronously by partner_requested_fresh, do NOT mutate
        // any dual state here — not even 'prev === waiting' checks (which rely
        // on React state batching) and not waitingCause (which relies on
        // useEffect reconciliation). This guard catches mid-batch socket events
        // fired within 0-3ms of partner_requested_fresh, before React has
        // committed any of the state setter calls.
        if (waitingFreshLockRef.current === true) {
            fetchCurrentQuestion();
            return;
        }
        
        // Use a callback to get current dualStatus without putting it in dependency array
        setDualStatus(prev => {
             if (prev === 'waiting') {
                  const wc = waitingCauseRef.current;
                  if (wc === 'partner_fresh' || wc === 'partner_single') {
                      return prev; // preserve waiting state - do not overwrite
                  }
                  const message = hasPartnerJoinedRef.current 
                      ? "Partner returned to Dual Mode!" 
                      : "Partner joined the session!";
                  setTimeout(() => {
                      setFeedbackMessage(message);
                      setTimeout(() => setFeedbackMessage(null), 3000);
                  }, 0);
             } else if (prev !== 'paired') {
                  const message = "Partner joined the session!";
                  setTimeout(() => {
                      setFeedbackMessage(message);
                      setTimeout(() => setFeedbackMessage(null), 3000);
                  }, 0);
             }
             return 'paired';
        });
        
        setWaitingCause(prev => {
            if (waitingFreshLockRef.current === true) return prev;
            if (prev === 'partner_fresh' || prev === 'partner_single') return prev;
            return 'initial';
        });
        setHasPartnerJoined(true);
        
        fetchCurrentQuestion();
    };
    
    // Listen for session updates (Context/Mode changes)
    const onSessionUpdated = (data) => {
        console.log('[SessionGame] Session updated:', data);
        if (data.context) {
            setContext(data.context);
            setConversationStarted(false);
            setIsRevealed(false);
            setWaitingForPartner(false);
            setPartnerSelections({});
            setHasClickedNext(false);
            setPartnerIsReady(false);
            setFeedbackMessage(null);
            // Clear pending switch context since it's now applied
            setPendingSwitchContext(null);
            // Close any open modals (e.g. Context Switch Request)
            setModalState(prev => ({ ...prev, isOpen: false }));
        }
        if (data.mode) {
            modeRef.current = data.mode;
            setMode(data.mode);
        }
        if (data.dual_status) {
            dualStatusRef.current = data.dual_status;
            setDualStatus(data.dual_status);
            if (data.dual_status === 'paired') {
              waitingCauseRef.current = 'initial';
              waitingFreshLockRef.current = false;
              freshDeadlineMsRef.current = null;
              setWaitingCause('initial');
              setFreshDeadlineMs(null);
              setFreshCountdown(null);
            } else if (data.dual_status === 'waiting' && data.waiting_reason === 'partner_fresh') {
              // If I'm the one who initiated Start Fresh (clicked menu Start Fresh),
              // ignore this state update — I should be redirected to scanner in 30ms.
              // Only apply to Phone B (the partner staying behind).
              if (!localFreshInitiatedRef.current) {
                waitingFreshLockRef.current = true;
                waitingCauseRef.current = 'partner_fresh';
                if (data.mode) modeRef.current = data.mode;
                else modeRef.current = 'dual-phone';
                setWaitingCause('partner_fresh');
                const secondsLeft = typeof data.seconds_remaining === 'number'
                  ? Math.max(0, data.seconds_remaining)
                  : 20;
                const deadlineMs = Date.now() + secondsLeft * 1000;
                freshDeadlineMsRef.current = deadlineMs;
                setFreshDeadlineMs(deadlineMs);
                setFreshCountdown(secondsLeft);
              }
            } else if (data.dual_status === 'waiting' && data.waiting_reason === 'partner_single') {
              if (!localFreshInitiatedRef.current) {
                waitingFreshLockRef.current = true;
                waitingCauseRef.current = 'partner_single';
                setWaitingCause('partner_single');
              }
            } else if (data.dual_status === 'waiting' && data.waiting_reason) {
              if (!localFreshInitiatedRef.current) {
                waitingCauseRef.current = data.waiting_reason;
                setWaitingCause(data.waiting_reason);
              }
            }
        }
        // ALWAYS fetch current question to ensure sync with server
        fetchCurrentQuestion();
    };

    const onPartnerSwitchedMode = ({ newMode }) => {
        console.log("[SessionGame] Partner switched mode to:", newMode);
        if (newMode === 'single-phone') {
            waitingFreshLockRef.current = true;
            dualStatusRef.current = 'waiting';
            waitingCauseRef.current = 'partner_single';
            setDualStatus('waiting');
            setWaitingCause('partner_single');
            setFeedbackMessage("Partner has switched to Single Mode.");
            setTimeout(() => setFeedbackMessage(null), 5000);
        }
    };

    // #region debug-point H1:listener-duplicate-bind
    __dbgRef.current.mounts += 1;
    const regSocketOn = (evt) => {
      const n = (__dbgRef.current.listenerCounts.get(evt) || 0) + 1;
      __dbgRef.current.listenerCounts.set(evt, n);
      if (n > 1) {
        __dbg('H1', `SessionGame.jsx:${new Error().line || '?'}`, `socket.on(${evt}) registered ${n} times without matching off`, { evt, count: n, mount_seq: __dbgRef.current.mounts });
      } else {
        __dbg('H1', 'SessionGame.jsx:listener-setup', `socket.on(${evt}) first registration (ok)`, { evt, mount_seq: __dbgRef.current.mounts });
      }
    };
    const wrap = (orig, evt) => (...args) => {
      __dbg('H1', 'SessionGame.jsx:listener-fire', `event ${evt} fired`, { evt, mount_seq: __dbgRef.current.mounts });
      return orig(...args);
    };
    // #endregion

    // Attach listeners
    socket.on('connect', wrap(onConnect, 'connect')); regSocketOn('connect');
    socket.on('session_migrated', wrap(onMigrate, 'session_migrated')); regSocketOn('session_migrated');
    socket.on('session_updated', wrap(onSessionUpdated, 'session_updated')); regSocketOn('session_updated');
    socket.on('dual_partner_joined', wrap(onDualPartnerJoined, 'dual_partner_joined')); regSocketOn('dual_partner_joined');
    socket.on('partner_switched_mode', wrap(onPartnerSwitchedMode, 'partner_switched_mode')); regSocketOn('partner_switched_mode');

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
      reconnectAttempts.current = (reconnectAttempts.current || 0) + 1;
      fireSession({
        event_type: 'reconnect_failed',
        event_data: {
          source: 'socket.connect_error',
          message: err && err.message ? String(err.message).slice(0, 400) : null,
          attempt: reconnectAttempts.current
        },
        ids: { session_id: sessionId, participant_id: participantId }
      });
    };

    const onDisconnect = (reason) => {
      console.log('🔌 Disconnected:', reason);
      setIsConnected(false);
      fireSession({
        event_type: 'session_reconnect',
        event_data: { source: 'socket.disconnect', reason: String(reason || '').slice(0, 200) },
        ids: { session_id: sessionId, participant_id: participantId }
      });
    };

    const onReconnect = (attemptNumber) => {
      console.log('🔁 Socket reconnected after', attemptNumber, 'attempts — rejoining session room');
      setIsConnected(true);
      // #region fix H2:reconnect-room-rejoin
      // When Socket.io reconnects, socket.id changes → the new socket is NOT
      // automatically a member of the session_id room from the previous socket.id.
      // Re-emit join_session so the server calls socket.join(session_id) on the
      // NEW socket.id and attaches role/sessionId to it. This is required for
      // Phone B after backgrounding / browser suspend: without this, broadcasts
      // from Phone A (next_intent_update, advance_question) never reach B's new
      // socket.id → buttons never advance → permanent de-sync.
      __dbg('H2', 'SessionGame.jsx:reconnect', 'Socket reconnected, re-emitting join_session to rejoin room', {
        attempt: attemptNumber,
        socket_id: socket.id,
        sid: sessionId,
        pid: participantId,
        table_token: tableToken || null
      });
      if (sessionId && participantId) {
        socket.emit('join_session', {
          session_id: sessionId,
          participant_id: participantId,
          table_token: tableToken || null,
          reconnect: true,
          attempt: attemptNumber || 1
        });
        // Belt-and-suspenders: re-fetch current question state 500ms after rejoin
        // so any broadcast events that were queued / dropped during the reconnect
        // window are server-authoritatively re-applied.
        setTimeout(() => {
          fetchCurrentQuestion().catch(() => {});
        }, 500);
      }
      // #endregion
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

    const onAnswerRevealed = (data) => {
      if (data?.question_id && questionIdRef.current && data.question_id !== questionIdRef.current) return;
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
       
       setFeedbackMessage(null); // Clear waiting message
       
       setPartnerIsReady(false); // Ensure "Partner is ready" is hidden
       // For Multiple Choice, revealing answers completes Phase 1 automatically.
       // Reset Phase 1 local state so Phase 2 ("Next Question") can track properly.
       setHasClickedNext(false); 
       // Auto-start "Conversation Mode" for MCQs so the button becomes "Next Question" immediately
       setConversationStarted(true);
    };

    const onAdvanceQuestion = (data) => {
      console.log('Received advance_question event', data);
      // Hide overlay RIGHT NOW on socket event (before fetch resolves) so there's
      // no dwell. Funnel effect below also clears on new question_id as a double-lock.
      conversationProgressVisibleRef.current = false;
      setConversationProgressVisible(false);
      setNextIntentCount(0);
      setAdvanceIntentCount(0);
      fetchCurrentQuestion();
      setIsRevealed(false);
      setWaitingForPartner(false);
      setPartnerSelections({});
      setHasClickedNext(false); // Reset for the new question
      setPartnerIsReady(false);
      setConversationStarted(false); // Reset Conversation Mode
      
      // Clear any waiting message.
      // We explicitly DO NOT preserve "Partner returned..." here anymore
      // so it naturally clears itself and doesn't get stuck if a user rapidly clicks Next
      setFeedbackMessage(null);
      
      setModalState(prev => ({ ...prev, isOpen: false }));
    };

    const onConversationStart = (payload = {}) => {
        // IMPORTANT CRITICAL FIX (Next Question "not responding" root cause):
        // EVERY state variable referenced inside this socket listener handler
        // closure MUST be read through its SYNC REF, NOT the state variable directly.
        // The socket listener effect runs ONCE without rebinding to state changes
        // (to avoid H1 listener storm regressions). That means all state variable
        // captures at listener install time are FOREVER STALE.
        //
        // Before this fix: isLegitFire = conversationStarted (ALWAYS false, stale)
        // || nextIntentCount>=1 (ALWAYS 0, stale) || partnerIsReady (ALWAYS false)
        // || hasClickedNext (ALWAYS false). So GUARDED_SKIP fired on EVERY legit
        // conversation_start event, and setConversationStarted(true) was NEVER called.
        // Result: Phase1 "Ready" flow worked (display/render only uses props/refs),
        // but Phase2 "Next Question" button never appeared — UI appeared "not responding".
        const csNow = Boolean(conversationStartedRef.current);
        const nicNow = Number(nextIntentCountRef.current) || 0;
        const pirNow = Boolean(partnerIsReadyRef.current);
        const hcnNow = Boolean(hasClickedNextRef.current);

        // #region debug-point H1:H2:H3:H4 — conversation_start event received
        __dbg('dual-round-reset', 'SessionGame.jsx:onConversationStart', 'CS EVENT RECEIVED setConversationStarted(true) — payload may be reconnect_replay', {
          pid: participantId,
          sid: sessionId,
          question_id_before: question?.question_id || null,
          position_before: question?.position_index ?? null,
          conversation_started_before_ref: csNow,
          next_intent_count_before_ref: nicNow,
          advance_intent_count_before_ref: advanceIntentCountRef.current || 0,
          has_clicked_next_before_ref: hcnNow,
          is_reconnect_replay: Boolean(payload?.reconnect_replay),
          ts_ms: Date.now()
        });
        // #endregion
        console.log('[SessionGame] Conversation Started');

        // IMPORTANT belt-and-suspenders guard: do NOT apply conversation_start=true
        // if the current question is clearly in its "waiting for ready" initial state
        // with BOTH next_intent_count=0 AND partner_ready=false AND has_clicked_next=false.
        // This catches late-queued conversation_start broadcasts (from previous question's
        // unstickTimer, previous clearSessionState race, or reconnect_replay when snapshot had
        // a transient bugged conversationStarted=true during a prior advance_question transition).
        // A truly fresh + valid conversation_start for the CURRENT question will always arrive
        // with either next_intent_count >=1 (at least one side clicked Ready) OR partner_ready=true.
        const isLegitFire = Boolean(
          csNow ||
          nicNow >= 1 ||
          pirNow ||
          hcnNow
        );
        if (!isLegitFire) {
          __dbg('dual-round-reset', 'SessionGame.jsx:onConversationStart:GUARDED_SKIP', 'Late/stale CS EVENT GUARDED — skipping setConversationStarted(true). Next intent=0, partner not ready, clicked=false → we are at start of NEW question waiting for Ready; this event belongs to PREVIOUS cycle.', {
            pid: participantId, sid: sessionId,
            qid: question?.question_id || null,
            nic_ref: nicNow, partner_ready_ref: pirNow, has_clicked_ref: hcnNow,
            payload
          });
          return;
        }

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
      setNextIntentCount(count || 0);
      // IMPORTANT: ALL state variables in socket listeners MUST be read via
      // their SYNC refs to avoid stale closures. See onConversationStart for
      // the full discussion. The outer guard here uses conversationStartedRef
      // (NOT conversationStarted stale closure) so state 2 (after conversation
      // start) won't incorrectly receive state 1's partnerIsReady mutations.
      const csActive = Boolean(conversationStartedRef.current);
      if (!csActive) {
        setPartnerIsReady((prev) => {
          const clicked = Boolean(hasClickedNextRef.current);
          if (!clicked && count >= 1 && !prev) return true;
          if (clicked && count < 2) return prev;
          if (count >= 2) return true;
          return prev;
        });
      }
    };

    const onAdvanceIntentUpdate = ({ count }) => {
      setAdvanceIntentCount(count || 0);
    };

    const onHintTapRevealed = ({ question_id }) => {
      fireSession({
        event_type: 'hint_revealed',
        event_data: { question_id: question_id || null, source: 'socket.hint_tap_revealed' },
        ids: { session_id: sessionId, participant_id: participantId }
      });
      // propagate to QuestionCard by setting the parent isRevealed via handleReveal's non-socket path:
      // emit an event via window so QuestionCard component listener can pick it up.
      window.dispatchEvent(new CustomEvent('tt:hint_revealed_sync', { detail: { question_id } }));
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
        // If *I* was the one who clicked Start Fresh, ignore this event — the
        // server broadcasts partner_requested_fresh to both phones, but Phone A
        // (initiator) should never show a Waiting screen on its own Start Fresh.
        if (localFreshInitiatedRef.current) return;
        // === SYNC REF SETTERS FIRST (before any React state setter) ===
        // These MUST run synchronously inside the listener so that state
        // callbacks (setDualStatus in onDualPartnerJoined) that are invoked
        // mid-batch (e.g. dual_partner_joined fires 1ms later via reconnect)
        // read the latest intent instead of a stale ref value.
        waitingFreshLockRef.current = true;
        modeRef.current = 'dual-phone';
        waitingCauseRef.current = 'partner_fresh';
        dualStatusRef.current = 'waiting';
        // Simplified rules: one Start Fresh → 20 second countdown on the partner's device.
        // SET REF FIRST (synchronous, no React batching) so later render-guard reads from
        // ref (which is instant) instead of state (Firefox batches 1-3 frames behind).
        const deadline = Date.now() + 20 * 1000;
        freshDeadlineMsRef.current = deadline;
        setMode('dual-phone');
        setWaitingCause('partner_fresh');
        setDualStatus('waiting');
        setFreshDeadlineMs(deadline);
        setFreshCountdown(20);
    };
    
    const onDualGroupTerminated = () => {
        // Both users confirmed Start Fresh → mutual → no countdown, instantly bounce to scanner.
        console.log('[SessionGame] Dual Group Terminated. Redirecting...');
        setFreshDeadlineMs(null);
        setFreshCountdown(null);
        setLastResetAt();
        clearStoredParticipant();
        if (tableToken) {
            clearDualSession(tableToken);
        }
        // Flush socket buffer (Firefox drops pending packets otherwise).
        try { if (socketRef.current) socketRef.current.disconnect(false); } catch (e) { console.warn(e); }
        setTimeout(() => {
          try { window.location.replace(SCANNER_ROUTE); } catch (e) { window.location.href = SCANNER_ROUTE; }
        }, 20);
    };

    // Simplified rule: after 20s server terminates single-sided Start Fresh dual session.
    // Server-side emits `single_fresh_timeout` → bounce this device to scanner too.
    const onSingleFreshTimeout = () => {
        console.log('[SessionGame] single_fresh_timeout. Bounce to scanner.');
        setFreshDeadlineMs(null);
        setFreshCountdown(null);
        setLastResetAt();
        clearStoredParticipant();
        if (tableToken) {
            clearDualSession(tableToken);
        }
        try { if (socketRef.current) socketRef.current.disconnect(false); } catch (e) { console.warn(e); }
        setTimeout(() => {
          try { window.location.replace(SCANNER_ROUTE); } catch (e) { window.location.href = SCANNER_ROUTE; }
        }, 20);
    };

    const onPartnerWaitingToAdvance = () => {
        // IMPORTANT (stale closure fix): hasClickedNext is stale inside socket
        // listeners → use the sync ref hasClickedNextRef to know if we have
        // actually already clicked Next. Without the ref, feedback message
        // displays even when the local user has already clicked, because the
        // closure only sees the listener-install-time value false (forever).
        const localClicked = Boolean(hasClickedNextRef.current);
        // Also only show when in state 2 (conversationStarted true), not
        // during state 1's Ready phase. Again use REF, not stale variable.
        const csActive = Boolean(conversationStartedRef.current);
        if (!localClicked && csActive) {
            setFeedbackMessage("Partner is waiting for you to click Next!");
        }
    };

    // #region debug-point H1:listener-duplicate-batch-2
    const reg2 = (evt) => regSocketOn(evt);
    socket.on('connect_error', wrap(onConnectError, 'connect_error')); reg2('connect_error');
    socket.on('disconnect', wrap(onDisconnect, 'disconnect')); reg2('disconnect');
    socket.on('reconnect', wrap(onReconnect, 'reconnect')); reg2('reconnect');
    socket.on('error', wrap(onError, 'error')); reg2('error');
    socket.on('partner_status', wrap(onPartnerStatus, 'partner_status')); reg2('partner_status');
    socket.on('answer_revealed', wrap(onAnswerRevealed, 'answer_revealed')); reg2('answer_revealed');
    socket.on('partner_answered', wrap(onPartnerAnswered, 'partner_answered')); reg2('partner_answered');
    socket.on('reveal_answers', wrap(onRevealAnswers, 'reveal_answers')); reg2('reveal_answers');
    socket.on('advance_question', wrap(onAdvanceQuestion, 'advance_question')); reg2('advance_question');
    socket.on('conversation_start', wrap(onConversationStart, 'conversation_start')); reg2('conversation_start');
    socket.on('waiting_for_partner', wrap(onWaitingForPartner, 'waiting_for_partner')); reg2('waiting_for_partner');
    socket.on('partner_waiting_to_advance', wrap(onPartnerWaitingToAdvance, 'partner_waiting_to_advance')); reg2('partner_waiting_to_advance');
    socket.on('both_ready', wrap(onBothReady, 'both_ready')); reg2('both_ready');
    socket.on('wait_timeout', wrap(onWaitTimeout, 'wait_timeout')); reg2('wait_timeout');
    socket.on('next_intent_update', wrap(onNextIntentUpdate, 'next_intent_update')); reg2('next_intent_update');
    socket.on('advance_intent_update', wrap(onAdvanceIntentUpdate, 'advance_intent_update')); reg2('advance_intent_update');
    socket.on('hint_tap_revealed', wrap(onHintTapRevealed, 'hint_tap_revealed')); reg2('hint_tap_revealed');
    socket.on('partner_context_intent', wrap(onPartnerContextIntent, 'partner_context_intent')); reg2('partner_context_intent');
    socket.on('context_switch_cancelled', wrap(onContextSwitchCancelled, 'context_switch_cancelled')); reg2('context_switch_cancelled');
    socket.on('partner_requested_fresh', wrap(onPartnerRequestedFresh, 'partner_requested_fresh')); reg2('partner_requested_fresh');
    socket.on('dual_group_terminated', wrap(onDualGroupTerminated, 'dual_group_terminated')); reg2('dual_group_terminated');
    socket.on('single_fresh_timeout', wrap(onSingleFreshTimeout, 'single_fresh_timeout')); reg2('single_fresh_timeout');
    // #endregion

    return () => {
      // #region debug-point H1:listener-cleanup
      const decrement = (evt) => {
        const n = Math.max(0, (__dbgRef.current.listenerCounts.get(evt) || 1) - 1);
        __dbgRef.current.listenerCounts.set(evt, n);
        __dbg('H1', 'SessionGame.jsx:cleanup', `socket.off(${evt})`, { evt, remaining_after_cleanup: n, mount_seq: __dbgRef.current.mounts });
      };
      ['connect','session_migrated','session_updated','dual_partner_joined','partner_switched_mode',
       'connect_error','disconnect','reconnect','error','partner_status','answer_revealed','partner_answered',
       'reveal_answers','advance_question','conversation_start','waiting_for_partner',
       'partner_waiting_to_advance','both_ready','wait_timeout','next_intent_update',
       'advance_intent_update','hint_tap_revealed','partner_context_intent','context_switch_cancelled',
       'partner_requested_fresh','dual_group_terminated','single_fresh_timeout'].forEach(decrement);
      // #endregion
      // CLEANUP: Remove listeners but DO NOT disconnect socket
      socket.off('connect', onConnect);
      socket.off('session_migrated', onMigrate);
      socket.off('session_updated', onSessionUpdated);
      socket.off('dual_partner_joined', onDualPartnerJoined);
      socket.off('partner_switched_mode', onPartnerSwitchedMode);
      socket.off('dual_group_terminated', onDualGroupTerminated);
      socket.off('single_fresh_timeout', onSingleFreshTimeout);
      socket.off('connect_error', onConnectError);
      socket.off('disconnect', onDisconnect);
      socket.off('reconnect', onReconnect);
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
      socket.off('advance_intent_update', onAdvanceIntentUpdate);
      socket.off('hint_tap_revealed', onHintTapRevealed);
      socket.off('partner_context_intent', onPartnerContextIntent);
      socket.off('context_switch_cancelled', onContextSwitchCancelled);
      socket.off('partner_requested_fresh', onPartnerRequestedFresh);
    };
    // #region fix H1:listener-leak — stable dep array without hasClickedNext
    // hasClickedNext was removed from dep array because it toggles on every click
    // → caused full 25-listener unmount+remount during the exact window when
    // socket broadcasts next_intent_update/conversation_start arrive. Closures
    // now read latest state via refs (see __dbgRef, eventFnRefs below) so the
    // listeners do NOT need to rebind when local-only click state changes.
    // #endregion
  }, [sessionId, participantId, globalSocket]);

  // Handle Visibility Change (Background/Foreground)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // #region debug-point H2:bg-fg-reconnect
        __dbg('H2', 'SessionGame.jsx:visibilitychange', 'app foregrounded, running reconcile + reconnect-if-needed', {
          connected: socketRef.current ? socketRef.current.connected : false,
          has_clicked_next: hasClickedNext,
          conversation_started: conversationStarted,
          deck_position: question?.position_index ?? null,
          question_id: question?.question_id || null
        });
        // #endregion
        console.log('[SessionGame] App foregrounded. Syncing state...');
        fetchCurrentQuestion();
        if (socketRef.current && !socketRef.current.connected) {
          socketRef.current.connect();
        }
        // Recompute countdown absolute deadline on foreground (background tick pause →
        // recompute against wall clock keeps deadline accurate even after 10min sleep)
        if (freshDeadlineMs) {
          const now = Date.now();
          const seconds = Math.max(0, Math.ceil((freshDeadlineMs - now) / 1000));
          setFreshCountdown(seconds);
          // CROSS-BROWSER: if tab was sleeping in Firefox for more than 20s, the
          // setInterval above never fired → redirect IMMEDIATELY instead of waiting
          // for next tick (which might still be paused for a while). This is the
          // #1 Firefox "countdown stuck" report.
          if (now >= freshDeadlineMs) {
            setFreshDeadlineMs(null);
            setFreshCountdown(null);
            setLastResetAt();
            clearStoredParticipant();
            if (tableToken) clearDualSession(tableToken);
            try { if (socketRef.current) socketRef.current.disconnect(false); } catch (e) { console.warn(e); }
            setTimeout(() => {
              try { window.location.replace(SCANNER_ROUTE); } catch (e) { window.location.href = SCANNER_ROUTE; }
            }, 10);
            return;
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sessionId, freshDeadlineMs, tableToken]);

  // Synchronous deadline check: runs AFTER every DOM paint synchronously (before browser
  // paints). Catches every React setState batching (Firefox) that "misses" a tick
  // event. If the countdown is already past 0 and we somehow still have
  // freshDeadlineMs set → redirect immediately.
  useLayoutEffect(() => {
    if (!freshDeadlineMs) return;
    if (Date.now() >= freshDeadlineMs) {
      setFreshDeadlineMs(null);
      setFreshCountdown(null);
      freshDeadlineMsRef.current = null;
      setLastResetAt();
      clearStoredParticipant();
      if (tableToken) clearDualSession(tableToken);
      try { if (socketRef.current) socketRef.current.disconnect(false); } catch (e) { console.warn(e); }
      setTimeout(() => {
        try { window.location.replace(SCANNER_ROUTE); } catch (e) { window.location.href = SCANNER_ROUTE; }
      }, 10);
    }
  }, [freshDeadlineMs, tableToken]);

  // CROSS-BROWSER (Firefox): HTTP reconciliation poll while in Dual Phone mode
  // OR while partner_fresh waiting. Belt + suspenders: socket events get silently
  // dropped in Firefox when partner page navigates away (socket.close + page unload race).
  // The state endpoint is source-of-truth and (now) returns seconds_remaining + waiting_reason.
  // CRITICAL: call fetchCurrentQuestion() IMMEDIATELY on effect start, then every 4s.
  // The original setInterval-only setup left a 4-second "blind window" where Firefox
  // showed the Question card with no countdown exactly as in the user's screenshot #1.
  useEffect(() => {
    if (!sessionId) return undefined;
    const needsPoll =
      modeRef.current === 'dual-phone' ||
      waitingCauseRef.current === 'partner_fresh' ||
      mode === 'dual-phone' ||
      waitingCause === 'partner_fresh';
    if (!needsPoll) return undefined;
    // Immediate first tick (closes the 4-second blind window)
    try { fetchCurrentQuestion(); } catch (e) { console.warn('[Reconcile] immediate fetch failed:', e); }
    const id = setInterval(() => {
      fetchCurrentQuestion();
    }, 4000);
    return () => clearInterval(id);
  }, [mode, waitingCause, sessionId]);

  // Start Fresh 20-second countdown tick (absolute deadline, background-safe).
  // Belt-and-suspenders redirect when countdown hits 0 (server also sends
  // single_fresh_timeout socket event; this is client-side redundant guard so we
  // don't stuck on "Partner left" forever if network disconnected during emit).
  useEffect(() => {
    if (!freshDeadlineMs) {
      setFreshCountdown(null);
      return undefined;
    }
    // CROSS-BROWSER RACE GUARD: if we are currently mid "Switch to Single Mode"
    // transition (refs already cleared to single state), the tick should not
    // fire a scanner redirect on top of the pending navigate. Return early and
    // clean up; user is being moved to their brand-new single session.
    if (modeRef.current === 'single-phone' || (dualStatusRef.current !== 'waiting' && dualStatusRef.current !== 'paired')) {
      setFreshDeadlineMs(null);
      setFreshCountdown(null);
      freshDeadlineMsRef.current = null;
      return undefined;
    }
    const tick = () => {
      // Re-check mode ref inside tick — in Firefox, React can commit the
      // setState/setRef writes during the first microtask phase, but the
      // setInterval callback already has a scheduled call on the stack.
      if (modeRef.current === 'single-phone') return;
      const secondsLeft = Math.max(0, Math.ceil((freshDeadlineMs - Date.now()) / 1000));
      setFreshCountdown(secondsLeft);
      if (secondsLeft <= 0) {
        setFreshDeadlineMs(null);
        setFreshCountdown(null);
        setLastResetAt();
        clearStoredParticipant();
        if (tableToken) {
          clearDualSession(tableToken);
        }
        // Firefox: flush socket + replace history so back button doesn't rehydrate stale dual.
        try { if (socketRef.current) socketRef.current.disconnect(false); } catch (e) { console.warn(e); }
        setTimeout(() => {
          try { window.location.replace(SCANNER_ROUTE); } catch (e) { window.location.href = SCANNER_ROUTE; }
        }, 20);
      }
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [freshDeadlineMs, tableToken]);

  // Simplified rule: switch to Single Mode ONLY when inside the 20-second window
  // after partner pressed Start Fresh. This uses the EXACT same ordering that fixed
  // the "Failed to start new session" alert earlier (backup creds → notify partner →
  // clear old creds → disconnect socket → create session POST → store new creds).
  // CROSS-BROWSER (Firefox): uses socket.emit+ACK (not blind 100ms sleep) so the
  // partner_switched_mode event is actually received by backend before we drop the
  // socket. socket.disconnect(false) flushes pending writes (default is true in some
  // socket.io versions which drops pending buffer on Firefox).
  const handleSwitchDualToSingleMode = async (contextArg) => {
    if (!tableToken) return;
    const currentStored = getStoredParticipant();
    if (!currentStored || !currentStored.sessionId) {
      setFeedbackMessage('No active session. Please scan the QR code again.');
      setTimeout(() => {
        window.location.href = SCANNER_ROUTE;
      }, 800);
      return;
    }
    const newCtx = contextArg || context;
    const socket = socketRef.current;
    // =========================================================================
    // SYNC STATE CLEAR (synchronous, before any await):
    //  - Cancels the countdown tick redirect (modeRef === 'single-phone' guard)
    //  - Hides the Waiting-for-Partner early-return path immediately so the
    //    user sees a local transition even while the HTTP POST is in flight.
    //  - Prevents the "stale same-page while waiting for network" look that
    //    made users think the button did "nothing".
    // =========================================================================
    waitingCauseRef.current = 'initial';
    setWaitingCause('initial');
    dualStatusRef.current = null;
    setDualStatus(null);
    modeRef.current = 'single-phone';
    setMode('single-phone');
    freshDeadlineMsRef.current = null;
    setFreshDeadlineMs(null);
    setFreshCountdown(null);
    try {
      // 1. Back up dual credentials in case user wants to come back.
      //    IMPORTANT: storeDualSession(tableToken, sessionId, participantId, participantToken)
      //    takes 4 POSITIONAL args, NOT an object arg — do not change ordering.
      storeDualSession(
        tableToken,
        currentStored.sessionId,
        currentStored.participantId,
        currentStored.participantToken
      );
      // 2. Notify partner that this participant has switched to Single Mode.
      //    Use emit-with-ACK so we KNOW the backend received and broadcast the event
      //    before we disconnect the socket (Firefox silently drops pending emits when
      //    disconnecting or navigating away too quickly).
      if (socket && socket.connected) {
        try {
          await new Promise((resolve) => {
            let resolved = false;
            const done = () => { if (!resolved) { resolved = true; resolve(); } };
            // Race: wait up to 400ms for ACK. If backend is slow, fall through.
            const fallback = setTimeout(done, 400);
            try {
              socket.emit('partner_switched_mode', {
                session_id: sessionId,
                participant_id: participantId,
                newMode: 'single-phone'
              }, () => { clearTimeout(fallback); done(); });
            } catch (e) {
              clearTimeout(fallback);
              done();
            }
          });
        } catch (e) {
          console.warn('emit partner_switched_mode failed (non-fatal):', e);
        }
      }
      // 3. Clear stored dual participant NOW (critical fix) — so the subsequent
      //    createSession() POST does NOT send the old cached dual participant token
      //    and trigger resolveSession resume-with-old-id → destructuring undefined crash.
      clearStoredParticipant();
      // 4. Disconnect socket with flush (false = keep transport open long enough to
      //    drain any remaining packets). Firefox drops buffered writes on default true.
      if (socket && typeof socket.disconnect === 'function') {
        try { socket.disconnect(false); } catch (e) { console.warn(e); }
      }
      // 5. Settle + create NEW single-phone session.
      setLastResetAt();
      const restaurantSlug = getRestaurantSlug();
      const { data } = await createSession({
        mode: 'single-phone',
        context: newCtx,
        table_token: tableToken,
        restaurant_slug: restaurantSlug || undefined
      });
      if (!data || !data.session_id || !data.participant_id) {
        throw new Error('createSession response missing session_id or participant_id');
      }
      // 6. Store participant — storeParticipant(participantId, sessionId, participantToken)
      //    takes 3 POSITIONAL args, NOT an object arg. Object arg previously wrote
      //    "[object Object]" strings into sessionStorage keys → next load returned null.
      storeParticipant(
        data.participant_id,
        data.session_id,
        data.participant_token || null
      );
      // 7. Navigate to the new Single session (defer to next tick so React finishes
      //    any pending setState writes before unmounting — Firefox React strict mode
      //    double-invokes and can swallow navigations when synchronous).
      //    Use location.replace so scanner back-stack doesn't have dead dual.
      setTimeout(() => {
        try {
          window.location.replace(`/session/${data.session_id}/game`);
        } catch (e) {
          navigate(`/session/${data.session_id}/game`);
        }
      }, 10);
    } catch (err) {
      console.error('handleSwitchDualToSingleMode failed:', err);
      // Rollback: restore old dual participant token + waiting state so the user can
      // still continue the dual session (e.g. they're inside the 20s window but
      // createSession 500'd). Do NOT clear refs again on rollback.
      try {
        const prev = getDualSession(tableToken);
        if (prev && prev.sessionId) {
          storeParticipant(prev.participantId, prev.sessionId, prev.participantToken || null);
        }
      } catch (rollbackErr) {
        console.warn('rollback restore failed:', rollbackErr);
      }
      // Restore the partner_fresh waiting refs that we cleared at the top so the
      // countdown and UI come back exactly as before the click. The 400/500 caught
      // above means no navigation happened. Re-bootstrap the deadline from the
      // server state endpoint immediately (bypass 250ms coalesce) so countdown
      // shows the true remaining seconds, not 0 or stale.
      waitingCauseRef.current = 'partner_fresh';
      dualStatusRef.current = 'waiting';
      modeRef.current = 'dual-phone';
      freshDeadlineMsRef.current = null;
      setWaitingCause('partner_fresh');
      setDualStatus('waiting');
      setMode('dual-phone');
      setFreshDeadlineMs(null);
      setFreshCountdown(null);
      coalesceFetchRef.current.lastRunAt = 0;
      coalesceFetchRef.current.pendingTimer = null;
      // Fire-and-forget: server syncs waiting state + countdown in one call.
      __fetchCurrentQuestionRaw().catch(() => null);
      setFeedbackMessage('Failed to switch to Single Mode. Please try again.');
    }
  };

  const __fetchCurrentQuestionRaw = async () => {
    try {
      coalesceFetchRef.current.running = true;
      const pidParam = participantId ? `&participant_id=${encodeURIComponent(participantId)}` : '';
      const snapshot_before = {
        deck_position: question?.position_index ?? null,
        question_id: question?.question_id || null,
        conversation_started: conversationStarted,
        next_intent_count: nextIntentCount,
        advance_intent_count: advanceIntentCount,
        has_clicked_next: hasClickedNext,
        ts_before: Date.now()
      };
      const res = await api.get(`/sessions/${sessionId}/state?t=${Date.now()}${pidParam}`);
      // #region debug-point H4:http-reconcile-overwrites-socket-state
      const data = res.data || {};
      __dbg('H4', 'SessionGame.jsx:reconcile-http-result', 'GET /sessions/:id/state returned', {
        http_deck_position: data.current_question?.position_index ?? null,
        http_question_id: data.current_question?.question_id || null,
        http_conversation_started: data.conversation_started,
        http_next_intent_count: data.next_intent_count,
        http_advance_intent_count: data.advance_intent_count,
        http_dual_status: data.dual_status,
        snapshot_before,
        is_lower_position: typeof data.current_question?.position_index === 'number' && typeof snapshot_before.deck_position === 'number'
          ? data.current_question.position_index < snapshot_before.deck_position
          : null,
        ts_after: Date.now(),
        roundtrip_ms: Date.now() - snapshot_before.ts_before
      });
      // #endregion
      console.log('[SessionGame] State Data:', res.data);
      
      // IMPORTANT (match old working SessionGame.jsx L768-810 pattern):
      // Round state transitions (conversationStarted, nextIntentCount,
      // advanceIntentCount, partnerIsReady, waitingForPartner, hasClickedNext)
      // are NEVER inferred from HTTP reconcile responses. They are applied
      // EXCLUSIVELY by socket.io broadcasts (conversation_start, advance_question,
      // next_intent_update, advance_intent_update, waiting_for_partner). This
      // eliminates the race where:
      //   (1) socket advance_question fires → setConversationStarted(false)
      //   (2) async fetchCurrentQuestion() inside onAdvanceQuestion resolves
      //       → HTTP reconcile overwrites it back to true (stale nextIntent/
      //       advanceIntent inference, sameQuestion monotonic, server restart
      //       fallback heuristics, DB position_index > 0 heuristics all can
      //       cause the regression).
      //
      // HTTP reconcile is used ONLY for static/structural state:
      //   - current_question + position_index (with deck position anti-regression
      //     guard so stale HTTP never un-does a socket broadcasted advance)
      //   - mode / context / dual_status / has_partner_joined / waiting_reason
      //   - Start Fresh seconds_remaining countdown bootstrap
      // Round state is intentionally NOT touched here.
      if (res.data.mode === 'dual-phone' || (res.data.dual_status && res.data.dual_status !== 'ended')) {
        const prevDeckPos = typeof question?.position_index === 'number' ? question.position_index : -Infinity;
        const httpDeckPos = typeof res.data.current_question?.position_index === 'number' ? res.data.current_question.position_index : prevDeckPos;
        const finalDeckIsHigherOrSame = httpDeckPos >= prevDeckPos;
        if (res.data.current_question && finalDeckIsHigherOrSame) {
          setQuestion(res.data.current_question);
          setNullQRetry(0);
        }
      }
      if (res.data && res.data.current_question) {
        if (!(res.data.mode === 'dual-phone' || (res.data.dual_status && res.data.dual_status !== 'ended'))) {
          console.log('[SessionGame] Setting question:', res.data.current_question);
          setQuestion(res.data.current_question);
          setNullQRetry(0);
        }
      } else if (!(res.data.mode === 'dual-phone' || (res.data.dual_status && res.data.dual_status !== 'ended'))) {
        console.warn('[SessionGame] current_question is missing/null:', res.data);
        setQuestion(null);
        setNullQRetry(prev => Math.min(prev + 1, 10));
      }

          // Ensure mode/context is up to date in case it changed remotely
          if (res.data) {
              setMode(res.data.mode);
              setContext(res.data.context);
              if (res.data.dual_status) {
                  dualStatusRef.current = res.data.dual_status;
                  setDualStatus(res.data.dual_status);
              }
              if (res.data.has_partner_joined !== undefined) {
                  setHasPartnerJoined(res.data.has_partner_joined);
              }
              if (res.data.dual_status === 'waiting' && res.data.waiting_reason) {
                  if (!localFreshInitiatedRef.current) {
                    waitingCauseRef.current = res.data.waiting_reason;
                    setWaitingCause(res.data.waiting_reason);
                  }
              }
              // CROSS-BROWSER HTTP fallback reconciliation: if state endpoint says
              // partner_fresh but we haven't set the deadline yet (socket event was
              // dropped by Firefox mid-disconnect of partner), bootstrap countdown
              // from seconds_remaining supplied by server (just added to response).
              // Skip if *I* initiated Start Fresh — I should be on my way to scanner.
              if (
                !localFreshInitiatedRef.current &&
                res.data.dual_status === 'waiting' &&
                res.data.waiting_reason === 'partner_fresh' &&
                typeof res.data.seconds_remaining === 'number' &&
                res.data.seconds_remaining > 0 &&
                !freshDeadlineMsRef.current
              ) {
                  waitingFreshLockRef.current = true;
                  waitingCauseRef.current = 'partner_fresh';
                  dualStatusRef.current = 'waiting';
                  modeRef.current = res.data.mode || modeRef.current;
                  const secondsLeft = Math.max(0, Math.min(20, Math.floor(res.data.seconds_remaining)));
                  const deadlineMs = Date.now() + secondsLeft * 1000;
                  freshDeadlineMsRef.current = deadlineMs;
                  setWaitingCause('partner_fresh');
                  setDualStatus('waiting');
                  setFreshDeadlineMs(deadlineMs);
                  setFreshCountdown(secondsLeft);
              }
              // If HTTP says session is ended, redirect IMMEDIATELY (backend already
              // terminated it after 20s timeout — socket event could have been dropped).
              if (res.data.dual_status === 'ended') {
                  setFreshDeadlineMs(null);
                  setFreshCountdown(null);
                  freshDeadlineMsRef.current = null;
                  setLastResetAt();
                  clearStoredParticipant();
                  if (tableToken) clearDualSession(tableToken);
                  try { if (socketRef.current) socketRef.current.disconnect(false); } catch (e) { console.warn(e); }
                  setTimeout(() => {
                    try { window.location.replace(SCANNER_ROUTE); } catch (e) { window.location.href = SCANNER_ROUTE; }
                  }, 10);
              }
          }
    } catch (err) {
      console.error('Error syncing state:', err);
      if (err.response?.status === 403 && err.response.data?.error === 'INACTIVE') {
        setError('Logged out due to inactivity. Scan the same table QR code to rejoin.');
      }
      setNullQRetry(prev => Math.min(prev + 1, 10));
    } finally {
      coalesceFetchRef.current.running = false;
      coalesceFetchRef.current.lastRunAt = Date.now();
    }
  };

  /**
   * Coalesced fetchCurrentQuestion:
   * If called many times in a short window (< 250ms), we schedule ONE run at the end.
   * If nothing is running and > 250ms since last run, execute immediately.
   * Eliminates the triple-fire on initial load.
   */
  const fetchCurrentQuestion = () => {
    const COALESCE_MS = 250;
    const now = Date.now();
    const ref = coalesceFetchRef.current;
    const timeSinceLast = now - ref.lastRunAt;
    if (timeSinceLast >= COALESCE_MS && !ref.running && !ref.pendingTimer) {
      __fetchCurrentQuestionRaw();
      return;
    }
    if (ref.pendingTimer) return;
    const delay = Math.max(0, COALESCE_MS - timeSinceLast);
    ref.pendingTimer = setTimeout(() => {
      ref.pendingTimer = null;
      if (ref.running) return;
      __fetchCurrentQuestionRaw();
    }, delay);
  };

  // Auto-retry when question is null: up to 3 retries with backoff, then context fallback
  useEffect(() => {
    if (loading || error) return;
    if (question) return; // Nothing to retry

    const attempt = nullQRetry;
    if (attempt >= 3) {
      // Fallback: try context switch to Exploring — it's guaranteed to have questions.
      if (context !== 'Exploring') {
        console.warn(`[SessionGame] 3 null-question retries exhausted; falling back to Exploring context automatically.`);
        (async () => {
          try {
            await api.patch(`/sessions/${sessionId}`, { context: 'Exploring' });
          } catch (err) {
            console.warn('[SessionGame] Fallback context switch patch failed:', err);
          }
          fetchCurrentQuestion();
        })();
      } else {
        console.warn(`[SessionGame] 3 retries exhausted even with Exploring context; stopping further auto-retries.`);
      }
      return;
    }
    const delays = [0, 300, 900];
    const delay = delays[attempt] ?? 0;
    const t = setTimeout(() => fetchCurrentQuestion(), delay);
    return () => clearTimeout(t);
  }, [nullQRetry, question, loading, error, context, sessionId]);

  const handleReveal = async () => {
    // If dual mode, emit socket event first for sync
    if (mode === 'dual-phone') {
        if (socketRef.current && isConnected) {
            socketRef.current.emit('reveal_answer', { sessionId, question_id: question?.question_id });
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
    // Capture when the user requested advance so we can measure sync latency on the next question_shown
    const clickedAt = Date.now();

    // #region debug-point H3:click-race-next | H3:double-click
    __dbg('H3', 'SessionGame.jsx:handleNext', 'Phase 1 handleNext (I am Ready) clicked', {
      clicked_at_ms: clickedAt,
      has_clicked_next_before: hasClickedNext,
      socket_connected: socketRef.current?.connected || false,
      mode: mode,
      question_id: question?.question_id || null,
      deck_position: question?.position_index ?? null,
      next_intent_count: nextIntentCount,
      partner_is_ready: partnerIsReady,
      conversation_started: conversationStarted
    });
    // #endregion

    // Single Phone Logic
    if (mode === 'single-phone' || mode === 'single') {
      try {
        fireSession({
          event_type: 'question_advance',
          event_data: {
            direction: 'next',
            source: 'single_next_click',
            from_question_id: question?.question_id || null,
            click_ts: clickedAt
          },
          ids: { session_id: sessionId, participant_id: participantId }
        });
        fireSession({
          event_type: 'question_advanced',
          event_data: {
            direction: 'next',
            source: 'single_next_click',
            from_question_id: question?.question_id || null
          },
          ids: { session_id: sessionId, participant_id: participantId }
        });
        await api.post(`/sessions/${sessionId}/questions/next`);
        fetchCurrentQuestion();
        setIsRevealed(false);
      } catch (err) {
        console.error('Error advancing deck:', err);
      }
      return;
    } 
    
    // Dual Phone Logic
    fireSession({
      event_type: 'next_question_intent_clicked',
      event_data: {
        phase: 'phase_1_ready_toggle',
        from_question_id: question?.question_id || null,
        click_ts: clickedAt,
        has_partner: hasPartnerJoined
      },
      ids: { session_id: sessionId, participant_id: participantId }
    });

    // #region fix H3:double-click-race — debounce + disabled-on-click guard (Phase 1)
    // hasClickedNext is checked BEFORE any socket action — if already true we short circuit.
    // Also use a click-timestamp ref to prevent 2x double-fire within 300ms window
    // (native click handlers can sometimes fire twice for touch-tap double-trigger).
    if (hasClickedNext) {
      __dbg('H3', 'SessionGame.jsx:handleNext:debounced', 'handleNext (I am Ready) debounced: hasClickedNext already true, ignoring duplicate click', {
        clicked_at_ms: clickedAt, pid: participantId, sid: sessionId
      });
      return;
    }
    const now300 = Date.now();
    if (readyLastClickRef.current && (now300 - readyLastClickRef.current) < 300) {
      __dbg('H3', 'SessionGame.jsx:handleNext:debounced-300', 'handleNext debounced: 2 clicks within 300ms (touch double-trigger)', {
        delta: now300 - readyLastClickRef.current, pid: participantId
      });
      return;
    }
    readyLastClickRef.current = now300;
    // #endregion

    if (socketRef.current?.connected) {
        // We do not setHasClickedNext(true) globally anymore here, because handleNext is used for both Phase 1 and Phase 2.
        // Wait, handleNext is passed to QuestionCard as `onNext`. QuestionCard ONLY calls it for Phase 1 (`handleNextIntent`).
        // For Phase 2, QuestionCard calls `onAdvanceTurn` directly!
        // So `handleNext` is ONLY Phase 1 (dual_next_intent).
        // #region fix H3:set-disabled-first — disable BEFORE network emit so fast 2nd click never emits twice
        setHasClickedNext(true); // Mark locally as clicked (for Phase 1) — MUST come before emit()
        // #endregion
        // #region fix retry + user feedback: emitWithRetry wrapper with exponential backoff 1-2-4s
        // socket.emit can silently fail when network flaps — add acknowledgement retry.
        emitWithRetry(socketRef.current, 'dual_next_intent', {}, [1000, 2000, 4000]).catch((emitErr) => {
          console.warn('[Ready] emit dual_next_intent failed after retries:', emitErr?.message || String(emitErr));
          __dbg('NET', 'SessionGame.jsx:handleNext:emit-failed', 'dual_next_intent failed after 3 retries, showing user toast', {
            pid: participantId, sid: sessionId, err: emitErr?.message || String(emitErr).slice(0, 200)
          });
          setHasClickedNext(false); // re-enable so user can retry
          setModalState({
            isOpen: true, title: 'Network Error', icon: '⚠️',
            message: 'Your ready status could not be sent. Please check your connection and try again.',
            action: () => { setModalState(p => ({ ...p, isOpen: false })); }
          });
        });
    } else {
        // Attempt to reconnect if disconnected
        console.warn('Socket disconnected, attempting reconnect...');
        try { socketRef.current?.connect(); } catch (_) { /* ignore */ }

        setModalState({
          isOpen: true,
          title: 'Reconnecting...',
          message: 'Connection to partner lost. Attempting to reconnect...',
          action: () => {
            setModalState(prev => ({ ...prev, isOpen: false }));
            if (socketRef.current?.connected) {
               setHasClickedNext(true);
               emitWithRetry(socketRef.current, 'dual_next_intent', {}, [1000, 2000, 4000]).catch(() => setHasClickedNext(false));
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

  // === CRITICAL ORDERING: Waiting for Partner (Start Fresh) screen ===
  // Check this BEFORE the loading spinner / no-question early returns, because if a
  // Start Fresh waiting state can arrive while we are still fetching a question, and we
  // must not suppress the Waiting Partner UI must render even if no question loaded or
  // loading === true. The Waiting UI has no dependency on a question being
  // present, so its render should unconditionally wins over loading states
  // (otherwise Start Fresh intent can be visually suppressed by the spinner / loading
  // "Loading conversation..." spinner / placeholder.
  if (dualStatusRef.current === 'waiting' && modeRef.current === 'dual-phone' && !localFreshInitiatedRef.current) {
    const wc = waitingCauseRef.current;
    const refDeadline = freshDeadlineMsRef.current;
    const displaySeconds =
      (refDeadline && refDeadline > Date.now())
        ? Math.max(0, Math.ceil((refDeadline - Date.now()) / 1000))
        : (freshCountdown && freshCountdown > 0 ? freshCountdown : null);
    const inFreshWindow = displaySeconds !== null && displaySeconds > 0;
    return (
      <div className="min-h-screen bg-[#F3EDE1] flex flex-col p-6 font-sans selection:bg-[#DCD3C2] selection:text-[#35332E] relative overflow-hidden">
        <header className="flex justify-between items-center mb-8 relative z-10">
          <SessionMenu
            tableToken={tableToken}
            currentContext={context}
            currentMode={modeRef.current}
            socketRef={socketRef}
            canSwitchToSingle={inFreshWindow}
            onSwitchToSingle={handleSwitchDualToSingleMode}
            localFreshInitiatedRef={localFreshInitiatedRef}
            feedbackMessage={feedbackMessage}
            setFeedbackMessage={setFeedbackMessage}
            onSessionChange={(data) => {
               if (data.pendingContext) setPendingSwitchContext(data.pendingContext);
            }}
          />
        </header>
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 bg-[#FBF7EF] rounded-full flex items-center justify-center mb-6 shadow-[inset_0_2px_6px_rgba(53,51,46,0.08)] relative">
              <div className="absolute inset-0 border-4 border-[#35332E] rounded-full border-t-transparent animate-spin opacity-60"></div>
              <img src="/catalyst-logo.png" alt="" className="w-10 h-10 object-contain relative z-10" draggable={false} />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3 tracking-tight">Waiting for Partner</h2>
            <p className="text-gray-500 max-w-xs mx-auto text-base">
              {wc === 'partner_fresh'
                ? (displaySeconds && displaySeconds > 0
                    ? `Your partner requested Start Fresh. You have ${displaySeconds} seconds to switch to Single Mode or this session will end automatically.`
                    : "Your partner requested Start Fresh. Wait here or switch to Single Mode...")
                : wc === 'partner_single'
                  ? "Your partner has switched to Single Mode. Wait or switch to Single Mode..."
                  : "Ask them to scan the QR code on the table to sync their device."}
            </p>
            {wc === 'partner_fresh' && inFreshWindow && (
              <div className="w-full max-w-sm flex flex-col gap-3 mt-8">
                <Button
                  onClick={() => handleSwitchDualToSingleMode(context)}
                  variant="ink"
                  fullWidth
                  className="py-3.5 text-base font-semibold rounded-2xl"
                >
                  Switch to Single Mode
                </Button>
                <button
                  onClick={() => {
                    setFreshDeadlineMs(null);
                    setFreshCountdown(null);
                    freshDeadlineMsRef.current = null;
                    setLastResetAt();
                    clearStoredParticipant();
                    if (tableToken) clearDualSession(tableToken);
                    try { if (socketRef.current) socketRef.current.disconnect(false); } catch (e) { console.warn(e); }
                    setTimeout(() => {
                      try { window.location.replace(SCANNER_ROUTE); } catch (e) { window.location.href = SCANNER_ROUTE; }
                    }, 20);
                  }}
                  className="w-full py-2 text-sm font-semibold text-[#6E6A60] underline bg-transparent border-0 rounded-none hover:opacity-80 transition-opacity"
                >
                  Go to Scanner Now
                </button>
              </div>
            )}
        </div>
      </div>
    );
  }

  if (loading && !question) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F3EDE1]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-20 h-20 bg-[#FBF7EF] rounded-full flex items-center justify-center relative shadow-[inset_0_2px_6px_rgba(53,51,46,0.08)]">
            <div className="absolute inset-0 rounded-full border-4 border-[#35332E] border-t-transparent animate-spin opacity-60"></div>
            <img src="/catalyst-logo.png" alt="" className="w-10 h-10 object-contain relative z-10" draggable={false} />
          </div>
          <p className="text-[#6E6A60] font-bold animate-pulse">Loading conversation...</p>
        </div>
      </div>
    );
  }

  if (!question && !loading && !error) {
    return (
      <div className="min-h-screen bg-[#F3EDE1] flex items-center justify-center p-6">
        <div className="text-center space-y-3 max-w-sm">
          <div className="w-20 h-20 bg-[#FBF7EF] rounded-full flex items-center justify-center mb-6 shadow-[inset_0_2px_6px_rgba(53,51,46,0.08)] relative mx-auto">
            <div className="absolute inset-0 border-4 border-[#35332E] rounded-full border-t-transparent animate-spin opacity-60"></div>
            <img src="/catalyst-logo.png" alt="" className="w-10 h-10 object-contain relative z-10" draggable={false} />
          </div>
          <h2 className="text-xl font-bold text-[#35332E]">Loading Question</h2>
          <p className="text-[#6E6A60] text-sm">
            {nullQRetry < 3
              ? 'Syncing deck with table…'
              : 'Preparing your first question…'}
          </p>
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
    <div className="min-h-screen bg-[#F3EDE1] flex flex-col p-6 font-sans selection:bg-[#DCD3C2] selection:text-[#35332E] relative overflow-hidden">

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
          canSwitchToSingle={Boolean(
            (freshDeadlineMsRef.current && freshDeadlineMsRef.current > Date.now()) ||
            (freshCountdown !== null && freshCountdown > 0)
          )}
          onSwitchToSingle={handleSwitchDualToSingleMode}
          localFreshInitiatedRef={localFreshInitiatedRef}
          feedbackMessage={feedbackMessage}
          setFeedbackMessage={setFeedbackMessage}
          onSessionChange={(data) => {
             if (data.pendingContext) {
                 setPendingSwitchContext(data.pendingContext);
             }
          }}
        />
      </header>

      {(dualStatusRef.current === 'waiting' || dualStatus === 'waiting') && (modeRef.current === 'dual-phone' || mode === 'dual-phone') && !localFreshInitiatedRef.current ? (
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center">
          {(() => {
            const wc = waitingCauseRef.current || waitingCause;
            const refDeadline = freshDeadlineMsRef.current;
            const displaySeconds =
              (refDeadline && refDeadline > Date.now())
                ? Math.max(0, Math.ceil((refDeadline - Date.now()) / 1000))
                : (freshCountdown && freshCountdown > 0 ? freshCountdown : null);
            const inFreshWindow = displaySeconds !== null && displaySeconds > 0;
            const isPartnerFresh = wc === 'partner_fresh' || (waitingCause === 'partner_fresh');
            return (
              <>
                <div className="w-20 h-20 bg-[#FBF7EF] rounded-full flex items-center justify-center mb-6 shadow-[inset_0_2px_6px_rgba(53,51,46,0.08)] relative">
                  <div className="absolute inset-0 border-4 border-[#35332E] rounded-full border-t-transparent animate-spin opacity-60"></div>
                  <img src="/catalyst-logo.png" alt="" className="w-10 h-10 object-contain relative z-10" draggable={false} />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-3 tracking-tight">Waiting for Partner</h2>
                <p className="text-gray-500 max-w-xs mx-auto text-base">
                  {isPartnerFresh
                    ? (displaySeconds && displaySeconds > 0
                        ? `Your partner requested Start Fresh. You have ${displaySeconds} seconds to switch to Single Mode or this session will end automatically.`
                        : "Your partner requested Start Fresh. Wait here or switch to Single Mode...")
                    : wc === 'partner_single' || waitingCause === 'partner_single'
                      ? "Your partner has switched to Single Mode. Wait or switch to Single Mode..."
                      : "Ask them to scan the QR code on the table to sync their device."}
                </p>
                {isPartnerFresh && inFreshWindow && (
                  <div className="w-full max-w-sm flex flex-col gap-3 mt-8">
                    <Button
                      onClick={() => handleSwitchDualToSingleMode(context)}
                      variant="ink"
                      fullWidth
                      className="py-3.5 text-base font-semibold rounded-2xl"
                    >
                      Switch to Single Mode
                    </Button>
                    <button
                      onClick={() => {
                        setFreshDeadlineMs(null);
                        setFreshCountdown(null);
                        freshDeadlineMsRef.current = null;
                        setLastResetAt();
                        clearStoredParticipant();
                        if (tableToken) clearDualSession(tableToken);
                        try { if (socketRef.current) socketRef.current.disconnect(false); } catch (e) { console.warn(e); }
                        setTimeout(() => {
                          try { window.location.replace(SCANNER_ROUTE); } catch (e) { window.location.href = SCANNER_ROUTE; }
                        }, 20);
                      }}
                      className="w-full py-2 text-sm font-semibold text-[#6E6A60] underline bg-transparent border-0 rounded-none hover:opacity-80 transition-opacity"
                    >
                      Go to Scanner Now
                    </button>
                  </div>
                )}
              </>
            );
          })()}
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
            nextIntentCount={nextIntentCount}
            advanceIntentCount={advanceIntentCount}
            hasClickedNext={hasClickedNext}
            onAdvanceTurn={() => {
                // #region debug-point H3:click-race-advance | H3:double-fire
                const clickedAt2 = Date.now();
                __dbg('H3', 'SessionGame.jsx:onAdvanceTurn', 'Phase 2 onAdvanceTurn (Next Question) clicked', {
                  clicked_at_ms: clickedAt2,
                  has_clicked_next_before: hasClickedNext,
                  socket_connected: socketRef.current?.connected || false,
                  question_id: question?.question_id || null,
                  deck_position: question?.position_index ?? null,
                  advance_intent_count: advanceIntentCount,
                  partner_is_ready: partnerIsReady,
                  conversation_started: conversationStarted
                });
                // #endregion
                // #region fix H3:double-click-race — debounce + disabled-first for Phase 2 Next Question
                if (hasClickedNext) {
                  __dbg('H3', 'SessionGame.jsx:onAdvanceTurn:debounced', 'onAdvanceTurn debounced: hasClickedNext already true, ignoring duplicate', {
                    pid: participantId, clicked_at_ms: clickedAt2
                  });
                  return;
                }
                const nowAdv = Date.now();
                if (advanceLastClickRef.current && (nowAdv - advanceLastClickRef.current) < 300) {
                  __dbg('H3', 'SessionGame.jsx:onAdvanceTurn:debounced-300', 'onAdvanceTurn debounced: 2 clicks within 300ms (touch double-trigger)', {
                    delta: nowAdv - advanceLastClickRef.current, pid: participantId
                  });
                  return;
                }
                advanceLastClickRef.current = nowAdv;
                // Disable first — BEFORE emit or any state change — so a fast 2nd tap never queues 2 packets
                setHasClickedNext(true);
                // #endregion
                conversationProgressVisibleRef.current = true;
                setConversationProgressVisible(true);
                const clickedAt = Date.now();
                fireSession({
                  event_type: 'question_advance',
                  event_data: {
                    direction: 'next',
                    source: 'dual_phase_2_next_question_click',
                    from_question_id: question?.question_id || null,
                    click_ts: clickedAt,
                    conversation_started: conversationStarted
                  },
                  ids: { session_id: sessionId, participant_id: participantId }
                });
                fireSession({
                  event_type: 'question_advanced',
                  event_data: {
                    direction: 'next',
                    source: 'dual_phase_2_next_question_click',
                    from_question_id: question?.question_id || null
                  },
                  ids: { session_id: sessionId, participant_id: participantId }
                });
                if (socketRef.current?.connected) {
                    // #region fix NET:retry + user feedback for advance_turn emit + rollback on failure
                    emitWithRetry(socketRef.current, 'advance_turn', {}, [1000, 2000, 4000]).catch((advErr) => {
                      console.warn('[Advance] emit advance_turn failed after retries:', advErr?.message || String(advErr));
                      __dbg('NET', 'SessionGame.jsx:onAdvanceTurn:emit-failed', 'advance_turn failed after 3 retries, showing user toast + rollback disabled', {
                        pid: participantId, sid: sessionId, err: advErr?.message || String(advErr).slice(0, 200)
                      });
                      // Rollback so user can try again
                      setHasClickedNext(false);
                      setConversationProgressVisible(false);
                      conversationProgressVisibleRef.current = false;
                      setModalState({
                        isOpen: true, title: 'Network Error', icon: '⚠️',
                        message: 'Next Question could not be synced with partner. Please check your connection and try again.',
                        action: () => { setModalState(p => ({ ...p, isOpen: false })); }
                      });
                    });
                } else {
                  // Disconnected — rollback disabled + show reconnect modal with retry
                  setHasClickedNext(false);
                  setConversationProgressVisible(false);
                  conversationProgressVisibleRef.current = false;
                  try { socketRef.current?.connect(); } catch (_) { /* ignore */ }
                  setModalState({
                    isOpen: true,
                    title: 'Reconnecting...',
                    message: 'Connection to partner lost. Attempting to reconnect...',
                    action: () => {
                      setModalState(prev => ({ ...prev, isOpen: false }));
                      if (socketRef.current?.connected) {
                         setHasClickedNext(true);
                         setConversationProgressVisible(true);
                         conversationProgressVisibleRef.current = true;
                         emitWithRetry(socketRef.current, 'advance_turn', {}, [1000, 2000, 4000]).catch(() => {
                           setHasClickedNext(false);
                           setConversationProgressVisible(false);
                           conversationProgressVisibleRef.current = false;
                         });
                      }
                    },
                    icon: '🔄'
                  });
                }
            }}
          />
        </div>
      )}

      {/* Conversation in Progress overlay: blurred backdrop + bottom caption ONLY (no center pill, no spinner, no Table Talk card) */}
      <AnimatePresence>
        {Boolean(conversationProgressVisible && (mode === 'dual-phone' || modeRef.current === 'dual-phone')) && (
          <motion.div
            key="conversation-progress-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 flex flex-col items-center bg-[#111111]/35 backdrop-blur-[1.5px]"
            style={{ touchAction: 'none', pointerEvents: 'none' }}
          >
            <div className="mt-auto mb-12 flex flex-col items-center gap-1">
              <div className="text-[14px] font-semibold tracking-wide text-[#FBF7EF] drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
                Conversation in Progress…
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
