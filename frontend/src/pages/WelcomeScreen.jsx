import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Button from '../components/ui/Button';
import { resolveSession, joinDualSession, publicHandshake } from '../api';
import { storeParticipant, getStoredParticipant, getDualSession, storeDualSession } from '../utils/sessionStorage';
import { useSocket } from '../context/SocketContext';

export default function WelcomeScreen() {
  const { tableToken, restaurantSlug } = useParams();
  const navigate = useNavigate();

  const activeRestaurantSlug = restaurantSlug || null;

  const { socket, isConnected, ensureConnection } = useSocket();
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState(null);
  const [setupStatus, setSetupStatus] = useState('available'); // 'available', 'busy', 'granted'
  const [waitingForA, setWaitingForA] = useState(false);
  const [blockedError, setBlockedError] = useState(null);
  const [subscriptionError, setSubscriptionError] = useState(null); // 'suspended' | 'invalid'
  const setupCompletedRef = useRef(false);
  const validatedRef = useRef(false);

  // Save the resolved restaurant slug to session state on mount / update
  useEffect(() => {
    if (!activeRestaurantSlug) {
      setSubscriptionError('invalid');
      return;
    }
    sessionStorage.setItem('restaurant_slug', activeRestaurantSlug);
  }, [activeRestaurantSlug]);

  // ── Subscription & Table Validation ────────────────────────────────────────────
  // Runs once after socket connects to validate restaurant is active and table registered.
  useEffect(() => {
    if (!tableToken || !activeRestaurantSlug || validatedRef.current) return;

    async function validate() {
      validatedRef.current = true;
      try {
        await publicHandshake(activeRestaurantSlug, tableToken);
        // Valid — proceed normally
      } catch (err) {
        if (err.response?.status === 403) {
          setSubscriptionError('suspended');
        } else {
          setSubscriptionError('invalid');
        }
      }
    }

    // Validate as soon as socket is connected so we fail fast
    if (isConnected) {
      validate();
    } else if (socket) {
      const onConnect = () => validate();
      socket.on('connect', onConnect);
      return () => socket.off('connect', onConnect);
    }
  }, [isConnected, socket, tableToken, activeRestaurantSlug]);

  const contextPath = `/r/${activeRestaurantSlug}/t/${tableToken}/context`;

  // Join setup room on mount
  useEffect(() => {
    if (blockedError) {
      // Auto-redirect after 3 seconds
      const timer = setTimeout(() => {
        setBlockedError(null);
        navigate('/');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [blockedError, navigate]);
  useEffect(() => {
    if (tableToken && socket) {
      ensureConnection();
    }
  }, [tableToken, socket, ensureConnection]);

  useEffect(() => {
    if (isConnected && socket && tableToken) {
      console.log('[Welcome] Joining setup room for', tableToken);
      const existingLock = sessionStorage.getItem(`table_lock_${tableToken}`);
      socket.emit('join_table_setup', { tableToken, lockToken: existingLock });

      const handleStatus = (data) => {
        console.log('[Welcome] Setup status:', data.status);
        setSetupStatus(data.status);
        if (data.status === 'busy') {
          setWaitingForA(true);
        }
      };

      const handleClaimed = (data) => {
        // Since lockToken is managed internally or by session storage,
        // we can just assume if we receive this, someone else claimed it.
        // If WE claimed it, we would get the response via callback.
        const myLock = sessionStorage.getItem(`table_lock_${tableToken}`);
        if (data.lockToken !== myLock) {
          setSetupStatus('busy');
          setWaitingForA(true);
        }
      };

      const handleReleased = () => {
        setSetupStatus('available');
        setWaitingForA(false);
      };

      const handleSetupCompleted = async (data) => {
        console.log('[Welcome] Setup completed by partner:', data);
        setupCompletedRef.current = true;
        
        if (data.mode === 'dual-phone') {
          setStatus('Joining partner...');
          try {
            const joinRes = await joinDualSession({ session_id: data.sessionId, restaurant_slug: activeRestaurantSlug });
            const { participant_id, participant_token, session_id } = joinRes.data;
            storeParticipant(participant_id, session_id, participant_token);
            storeDualSession(tableToken, session_id, participant_id, participant_token);
            navigate(`/session/${session_id}/game`);
          } catch (err) {
            console.error('Auto-join failed:', err);
            setWaitingForA(false);
            setStatus(null);
          }
        } else {
          // Phone A chose Single Mode. Phone B is released to start their own.
          console.log('[Welcome] Partner chose Single Mode. Proceeding to create new session.');
          setWaitingForA(false);
          setStatus('Checking availability...');
          setSetupStatus('available');
          
          // Duplicate start_new logic to safely claim lock for Phone B before proceeding
          if (socket) {
              const doClaim = () => {
                  const existingLock = sessionStorage.getItem(`table_lock_${tableToken}`);
                  // Proceed with claim
                  socket.emit('claim_setup', { tableToken, lockToken: existingLock }, (response) => {
                      if (response.status === 'granted') {
                          sessionStorage.setItem(`table_lock_${tableToken}`, response.lockToken);
                          setStatus('Ready to start');
                          navigate(contextPath);
                      } else {
                          setWaitingForA(true);
                          setStatus(null);
                      }
                  });
              };
              
              if (socket.connected) {
                  doClaim();
              } else {
                  console.log('[Welcome] Socket disconnected, waiting to reconnect before claiming setup...');
                  socket.connect();
                  socket.once('connect', doClaim);
              }
          } else {
              // If disconnected entirely, just navigate and let next page handle errors
              navigate(contextPath);
          }
        }
      };

      socket.on('setup_status', handleStatus);
      socket.on('setup_claimed', handleClaimed);
      socket.on('setup_released', handleReleased);
      socket.on('setup_completed', handleSetupCompleted);

      return () => {
        socket.off('setup_status', handleStatus);
        socket.off('setup_claimed', handleClaimed);
        socket.off('setup_released', handleReleased);
        socket.off('setup_completed', handleSetupCompleted);
      };
    }
  }, [isConnected, socket, tableToken, navigate]);

  const handleContinue = async () => {
    setChecking(true);
    setStatus('Connecting...');
    
    try {
      // 1. Check for existing credentials (active or backup from dual mode)
      const stored = getStoredParticipant();
      const dualStored = getDualSession(tableToken);
      
      console.log("[Welcome] Stored Creds:", stored);
      console.log("[Welcome] Dual Backup:", dualStored);

      // Use active token first, fallback to backup token if we just "started fresh" but want to resume
      const deviceToken = stored.participantToken || dualStored?.participantToken;
      
      console.log("[Welcome] Using Device Token:", deviceToken);

      // 2. Resolve Session State
      const resolveRes = await resolveSession({ 
          table_token: tableToken, 
          device_token: deviceToken,
          restaurant_slug: activeRestaurantSlug
      });
      
      const { action, session_id, participant_id, participant_token, mode, reason, role } = resolveRes.data;
      console.log('[Welcome] Resolution Action:', action);

      if (action === 'blocked_active_session') {
          setStatus(null);
          // Show fine UI popup instead of alert
          setBlockedError("You have an active Dual session at another table. Wait for your partner to leave, or return to your original table.");
          return;
      }

      if (action === 'resume') {
          setStatus('Resuming session...');
          // Restore credentials if we used backup token
          if (!stored.participantToken && deviceToken) {
              console.log('[Welcome] Restoring backup credentials to session storage');
              storeParticipant(participant_id, session_id, deviceToken);
          }
          // Navigate to game directly
          navigate(`/session/${session_id}/game`);
          return;
      }

      if (action === 'join_dual' || action === 'reclaim_dual') {
          setStatus('Joining partner...');
          console.log(`[Welcome] Auto-joining dual session (${action}):`, session_id);
          // Auto-join waiting session (Phone B joins Phone A) or Reclaim spot
          const joinRes = await joinDualSession({ 
              session_id,
              reclaim_role: action === 'reclaim_dual' ? role : undefined,
              restaurant_slug: activeRestaurantSlug
          });
          const { 
              participant_id: newPid, 
              participant_token: newToken, 
              session_id: newSid 
          } = joinRes.data;

          // Store credentials
          storeParticipant(newPid, newSid, newToken);
          // Store backup for this new session
          storeDualSession(tableToken, newSid, newPid, newToken);
          
          navigate(`/session/${newSid}/game`);
          return;
      }

      if (action === 'start_new') {
          // If we resolved to "Start New", it means we should go to context selection
          // NEW LOGIC: Check Setup Lock
          setStatus('Checking availability...');
          
          const claimPromise = new Promise((resolve) => {
              if (socket) {
                  const doClaim = () => {
                      const existingLock = sessionStorage.getItem(`table_lock_${tableToken}`);
                      socket.emit('claim_setup', { tableToken, lockToken: existingLock }, (response) => {
                          if (response.status === 'granted') {
                              sessionStorage.setItem(`table_lock_${tableToken}`, response.lockToken);
                          }
                          resolve(response);
                      });
                  };
                  
                  if (socket.connected) {
                      doClaim();
                  } else {
                      console.log('[Welcome] Socket not connected, waiting for connection before claim...');
                      socket.connect();
                      socket.once('connect', doClaim);
                  }
                  // Timeout fallback
                  setTimeout(() => resolve({ status: 'timeout' }), 4000);
              } else {
                  resolve({ status: 'offline' }); 
              }
          });
          
          const claimRes = await claimPromise;
          console.log('[Welcome] Claim result:', claimRes);
          
          if (claimRes.status === 'granted') {
              setStatus('Ready to start');
              navigate(contextPath);
          } else if (claimRes.status === 'offline') {
              // Show error, don't bypass lock
              alert("Connection issue. Please wait and try again.");
              setStatus(null);
          } else {
              // Busy or timeout
              setWaitingForA(true);
              setStatus(null);
          }
          return;
      }

    } catch (err) {
      console.error('Resolution error:', err);
      // Fallback: Start New Flow
      navigate(contextPath);
    } finally {
      setChecking(false);
    }
  };

  // Subscription Error: Service Suspended
  if (subscriptionError === 'suspended') {
    return (
      <div className="min-h-screen bg-[#F3EDE1] flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', duration: 0.8 }}
          className="max-w-md w-full bg-white/70 border border-[#35332E]/10 rounded-3xl p-8 md:p-10 shadow-xl relative z-10"
        >
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl bg-[#35332E]/10">🛠️</div>
          <h1 className="text-3xl font-bold tracking-tight text-[#35332E] mb-4 leading-tight">
            Service Temporarily Unavailable
          </h1>
          <p className="text-[#6E6A60] text-base leading-relaxed mb-8">
            This restaurant's subscription is inactive or suspended. Please contact the restaurant or try again later.
          </p>
          <Button onClick={() => navigate('/')} variant="outline" fullWidth className="border-[#35332E]/20 text-[#35332E] hover:bg-[#35332E]/5">
            Go Home
          </Button>
        </motion.div>
      </div>
    );
  }

  // Subscription Error: Invalid / Unregistered
  if (subscriptionError === 'invalid') {
    return (
      <div className="min-h-screen bg-[#F3EDE1] flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', duration: 0.8 }}
          className="max-w-md w-full bg-white/70 border border-[#35332E]/10 rounded-3xl p-8 md:p-10 shadow-xl relative z-10"
        >
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl bg-[#35332E]/10">⚠️</div>
          <h1 className="text-3xl font-bold tracking-tight text-[#35332E] mb-4 leading-tight">
            Invalid QR Code
          </h1>
          <p className="text-[#6E6A60] text-base leading-relaxed mb-8">
            This QR code is invalid, expired, or the table is not registered with any active restaurant. Please scan a valid QR code.
          </p>
          <Button onClick={() => navigate('/')} variant="ink" fullWidth className="shadow-lg">
            Scan Again / Home
          </Button>
        </motion.div>
      </div>
    );
  }

  // Waiting UI for Phone B
  if (waitingForA) {
    return (
      <div className="min-h-screen bg-[#F3EDE1] flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
        <div className="relative z-10">
          <div className="mb-8 relative mx-auto w-24 h-24">
            <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center animate-pulse border border-[#35332E]/10">
               <span className="text-4xl">⏳</span>
            </div>
            <div className="absolute top-0 left-0 w-24 h-24 bg-[#35332E] rounded-full opacity-10 animate-ping"></div>
          </div>

          <h2 className="text-2xl font-bold text-[#35332E] mb-4 tracking-tight">
            Waiting for Partner
          </h2>
          <p className="text-[#6E6A60] max-w-xs mx-auto mb-10 leading-relaxed">
            Partner will select Context and Mode to start session.
          </p>

          <div className="space-y-4">
            <div className="flex justify-center gap-2">
              <span className="w-2 h-2 bg-[#35332E]/70 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></span>
              <span className="w-2 h-2 bg-[#35332E]/70 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
              <span className="w-2 h-2 bg-[#35332E]/70 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
            </div>

            <button
               onClick={() => setWaitingForA(false)}
               className="text-sm font-semibold text-[#6E6A60] hover:text-[#35332E] transition-colors uppercase tracking-widest mt-8"
            >
               Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show loading spinner only if we are actively checking/resolving
  if (status) {
    return (
      <div className="min-h-screen bg-[#F3EDE1] flex flex-col items-center justify-center p-6">
        <div className="animate-pulse text-center">
          <div className="w-16 h-16 border-4 border-[#35332E] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-[#6E6A60] font-medium">{status}</p>
        </div>
      </div>
    );
  }

  // Otherwise, show the Welcome Screen
  return (
    <div className="min-h-screen bg-[#F3EDE1] flex flex-col items-center justify-center p-6 relative overflow-hidden selection:bg-[#35332E]/10 selection:text-[#35332E]">

      {/* Blocked Error Modal */}
      <AnimatePresence>
        {blockedError && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-[#35332E]/60 backdrop-blur-sm"
              onClick={() => {
                  setBlockedError(null);
                  navigate('/');
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative bg-[#F3EDE1] w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden p-6 border border-[#35332E]/10"
            >
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-5 h-5 text-[#35332E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
                <span className="text-[#35332E] font-semibold text-sm tracking-wide">
                  Catalyst
                </span>
              </div>

              <p className="text-[#35332E] text-[15px] leading-relaxed mb-6">
                {blockedError}
              </p>

              <div className="w-full bg-[#35332E]/10 h-1 rounded-full overflow-hidden mb-6">
                  <motion.div
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 3, ease: "linear" }}
                    className="h-full bg-[#35332E]"
                  />
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => {
                      setBlockedError(null);
                      navigate('/');
                  }}
                  className="bg-[#35332E] hover:bg-[#26241F] text-[#F3EDE1] font-semibold px-6 py-2 rounded-xl shadow-md transition-colors"
                >
                  OK
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="max-w-md w-full text-center relative z-10"
      >
        {/* Droplet Logo */}
        <div className="mb-12">
          <motion.div
            initial={{ scale: 0.85, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.7, type: "spring" }}
            className="w-36 h-36 mx-auto flex items-center justify-center"
          >
            <img src="/catalyst-logo.png" alt="Catalyst" className="w-full h-full object-contain drop-shadow-lg" />
          </motion.div>
        </div>

        {/* Heading Hierarchy */}
        <div className="space-y-3 mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-[#35332E] tracking-tight leading-[1.05]">
            Welcome to
          </h1>
          <h1 className="text-5xl md:text-6xl font-bold text-[#35332E] tracking-tight leading-[1.05]">
            Catalyst
          </h1>
          <p className="text-lg md:text-xl text-[#35332E] font-medium italic mt-4">
            Starts a conversation. Gets out of your way.
          </p>
        </div>

        {/* Body Copy */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.6 }}
          className="space-y-6"
        >
          <p className="text-[17px] text-[#35332E] leading-relaxed">
            Catalyst offers questions for two people. Explore new topics together … and stay curious.
          </p>
          <p className="text-base text-[#6E6A60] leading-relaxed">
            Stay as long as the food takes. Or stop anytime.
          </p>
        </motion.div>

        {/* Continue CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="pt-12"
        >
          <Button
            onClick={handleContinue}
            disabled={checking}
            variant="ink"
            size="xl"
            fullWidth
            className="shadow-xl shadow-[#35332E]/10 hover:shadow-2xl hover:shadow-[#35332E]/15 transition-all text-lg"
            icon={!checking && <span className="group-hover:translate-x-1 transition-transform">→</span>}
          >
            {checking ? 'Connecting...' : 'Continue'}
          </Button>

          <p className="mt-10 text-xs text-[#6E6A60] tracking-[0.2em] uppercase font-medium">
            Anonymous Session · No Data Stored
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
