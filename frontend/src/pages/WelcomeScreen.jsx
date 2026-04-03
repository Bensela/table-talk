import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Button from '../components/ui/Button';
import { resolveSession, joinDualSession, createSession } from '../api';
import { storeParticipant, getStoredParticipant, getDualSession, storeDualSession } from '../utils/sessionStorage';
import { useSocket } from '../context/SocketContext';

export default function WelcomeScreen() {
  const { tableToken } = useParams();
  const navigate = useNavigate();
  const { socket, isConnected, ensureConnection } = useSocket();
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState(null);
  const [setupStatus, setSetupStatus] = useState('available'); // 'available', 'busy', 'granted'
  const [waitingForA, setWaitingForA] = useState(false);
  const [blockedError, setBlockedError] = useState(null); // Added state for blocked error UI
  const setupCompletedRef = useRef(false);

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
            const joinRes = await joinDualSession({ session_id: data.sessionId });
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
                          navigate(`/t/${tableToken}/context`);
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
              navigate(`/t/${tableToken}/context`);
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
          device_token: deviceToken 
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
              reclaim_role: action === 'reclaim_dual' ? role : undefined
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
              navigate(`/t/${tableToken}/context`);
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
      navigate(`/t/${tableToken}/context`);
    } finally {
      setChecking(false);
    }
  };

  // Waiting UI for Phone B
  if (waitingForA) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 font-sans text-center relative overflow-hidden">
         {/* Background Ambience */}
         <div className="absolute top-[-20%] left-[-20%] w-[500px] h-[500px] bg-blue-50/60 rounded-full blur-3xl pointer-events-none opacity-60" />
         
         <div className="relative z-10">
             <div className="mb-8 relative mx-auto w-24 h-24">
                 <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center animate-pulse border border-blue-100">
                    <span className="text-4xl">⏳</span>
                 </div>
                 {/* Ping animation */}
                 <div className="absolute top-0 left-0 w-24 h-24 bg-blue-400 rounded-full opacity-20 animate-ping"></div>
             </div>
             
             <h2 className="text-2xl font-extrabold text-gray-900 mb-4 tracking-tight">
                Waiting for Partner
             </h2>
             <p className="text-gray-500 max-w-xs mx-auto mb-10 leading-relaxed">
                Partner will select Context and Mode to start session.
             </p>
             
             <div className="space-y-4">
                 <div className="flex justify-center gap-2">
                     <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></span>
                     <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                     <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
                 </div>
                 
                 <button 
                    onClick={() => setWaitingForA(false)}
                    className="text-sm font-bold text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest mt-8"
                 >
                    Cancel
                 </button>
             </div>
         </div>
      </div>
    );
  }

  // Format table token for display
  const displayTable = tableToken 
    ? tableToken.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    : 'Table Talk';

  // Show loading spinner only if we are actively checking/resolving
  if (status) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 font-sans">
        <div className="animate-pulse text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500 font-medium">{status}</p>
        </div>
      </div>
    );
  }

  // Otherwise, show the Welcome Screen
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans selection:bg-blue-100 selection:text-blue-900">
      
      {/* Blocked Error Modal (Matches Image Spec) */}
      <AnimatePresence>
        {blockedError && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            {/* Dimmed Background */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
              onClick={() => {
                  setBlockedError(null);
                  navigate('/');
              }}
            />
            {/* Modal Content */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative bg-[#2f2f3a] w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden p-6"
            >
              {/* Header */}
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
                <span className="text-gray-300 font-medium text-sm tracking-wide">
                  Table Talk
                </span>
              </div>
              
              {/* Body Text */}
              <p className="text-gray-300 text-[15px] leading-relaxed mb-6">
                {blockedError}
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
                  onClick={() => {
                      setBlockedError(null);
                      navigate('/');
                  }}
                  className="bg-[#06b6d4] hover:bg-[#0891b2] text-gray-900 font-bold px-6 py-2 rounded-lg shadow-md transition-colors"
                >
                  OK
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Background Ambience */}
      <div className="absolute top-[-20%] left-[-20%] w-[500px] h-[500px] bg-blue-50/60 rounded-full blur-3xl pointer-events-none opacity-60" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[500px] h-[500px] bg-purple-50/60 rounded-full blur-3xl pointer-events-none opacity-60" />

      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="max-w-md w-full text-center relative z-10"
      >
        {/* Table Badge */}
        {tableToken && (
          <motion.div 
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 bg-gray-900 text-white rounded-full text-xs font-bold uppercase tracking-widest mb-12 shadow-xl shadow-gray-200"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Connected to {displayTable}
          </motion.div>
        )}

        {/* Logo / Header Section */}
        <div className="space-y-6 mb-12">
          <motion.div
            initial={{ scale: 0.8, opacity: 0, rotate: -10 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ delay: 0.2, duration: 0.6, type: "spring" }}
            className="w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-3xl mx-auto flex items-center justify-center shadow-2xl shadow-blue-200 text-5xl mb-8"
          >
            💬
          </motion.div>
          
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 tracking-tight leading-tight">
            Welcome to <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600">
              Table Talk
            </span>
          </h1>
        </div>

        {/* Main Message */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.8 }}
          className="space-y-8"
        >
          <p className="text-xl text-gray-500 leading-relaxed font-medium">
            Table Talk offers thoughtful questions designed to spark meaningful conversation between two people.
          </p>
          <p className="text-lg text-gray-900 font-medium italic">
            Explore new topics together... and stay curious.
          </p>
        </motion.div>

        {/* Action Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="pt-12"
        >
          <Button 
            onClick={handleContinue}
            disabled={checking}
            variant="primary"
            size="xl"
            fullWidth
            className="shadow-xl shadow-blue-500/20 hover:shadow-2xl hover:shadow-blue-500/30 transition-all text-lg"
            icon={!checking && <span className="group-hover:translate-x-1 transition-transform">→</span>}
          >
            {checking ? 'Connecting...' : 'Continue'}
          </Button>
          
          <p className="mt-8 text-xs font-bold text-gray-300 uppercase tracking-widest">
            Anonymous Session • No Data Stored
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
