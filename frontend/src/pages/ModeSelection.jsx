import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { io } from 'socket.io-client';
import { createSession, getSession, updateSessionMode, joinDualSession } from '../api';
import SelectionCard from '../components/ui/SelectionCard';
import Button from '../components/ui/Button';
import { storeParticipant, getStoredParticipant, storeDualSession } from '../utils/sessionStorage';
import { useSocket } from '../context/SocketContext';

export default function ModeSelection() {
  const { tableToken, restaurantSlug, sessionId } = useParams(); // Support both new flow (tableToken) and legacy (sessionId)
  const navigate = useNavigate();
  const location = useLocation();
  const { socket } = useSocket();
  const [loading, setLoading] = useState(false);
  
  // View State: 'mode-select' only now
  const [view, setView] = useState('mode-select');
  const [error, setError] = useState(null);

  // Get context from previous step (if in new flow)
  const context = location.state?.context;
  const isDev = window.location.hostname === 'localhost';

  useEffect(() => {
    // If we have a sessionId (legacy flow or re-joining), check its status
    if (sessionId) {
      const checkSession = async () => {
        try {
          const { data } = await getSession(sessionId);
          if (data.mode) {
            // Redirect to game immediately if mode is already set
            navigate(`/session/${sessionId}/game`);
          }
        } catch (err) {
          console.error(err);
        }
      };
      checkSession();
    } else if (!tableToken || !context) {
      // If we're in the new flow but missing data, redirect back
      if (tableToken) {
        const contextPath = restaurantSlug
          ? `/r/${restaurantSlug}/t/${tableToken}/context`
          : `/t/${tableToken}/context`;
        navigate(contextPath);
      } else {
        navigate('/');
      }
    }
  }, [sessionId, tableToken, context, navigate]);

  const handleSinglePhone = async () => {
    setLoading(true);
    try {
      const { data } = await createSession({
        table_token: tableToken,
        context: context,
        mode: 'single-phone',
        restaurant_slug: restaurantSlug || sessionStorage.getItem('restaurant_slug')
      });
      storeParticipant(data.participant_id, data.session_id, data.participant_token);
      storeDualSession(tableToken, data.session_id, data.participant_id, data.participant_token);
      
      // Release setup lock and notify others so they can act automatically
      if (socket && tableToken) {
          console.log('[ModeSelection] Setup completed, notifying others');
          socket.emit('setup_completed', { 
              tableToken, 
              mode: 'single-phone', 
              sessionId: data.session_id 
          });
      }

      navigate(`/session/${data.session_id}/game`);
    } catch (err) {
      console.error(err);
      setError('Failed to start session. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const [pairingExpiresAt, setPairingExpiresAt] = useState(null);
  const [createdSessionId, setCreatedSessionId] = useState(null); // Track session ID for websocket

  const handleStartDual = async () => {
    setLoading(true);
    try {
      const { data } = await createSession({
        table_token: tableToken,
        context: context,
        mode: 'dual-phone',
        restaurant_slug: restaurantSlug || sessionStorage.getItem('restaurant_slug')
      });
      storeParticipant(data.participant_id, data.session_id, data.participant_token);
      storeDualSession(tableToken, data.session_id, data.participant_id, data.participant_token);
      
      // Release setup lock and notify others to auto-join
      if (socket && tableToken) {
          console.log('[ModeSelection] Setup completed, notifying others to auto-join');
          socket.emit('setup_completed', { 
              tableToken, 
              mode: 'dual-phone', 
              sessionId: data.session_id 
          });
      }

      // Directly navigate to game, waiting for partner to join via "One-Scan"
      navigate(`/session/${data.session_id}/game`);
    } catch (err) {
      console.error(err);
      setError('Failed to create session.');
    } finally {
      setLoading(false);
    }
  };

  // WebSocket Listener for Auto-Dismiss
  useEffect(() => {
    if (view !== 'show-code' || !createdSessionId) return;

    const apiUrl = import.meta.env.VITE_API_URL || (isDev ? 'http://localhost:5000' : '/api');
    let socketOrigin = isDev ? 'http://localhost:5000' : window.location.origin;
    let socketPath = '/socket.io/';

    if (typeof apiUrl === 'string' && apiUrl.length > 0) {
      if (apiUrl.startsWith('http')) {
        const u = new URL(apiUrl);
        socketOrigin = `${u.protocol}//${u.host}`;
        const basePath = (u.pathname || '').replace(/\/$/, '');
        if (basePath && basePath !== '/') socketPath = `${basePath}/socket.io/`;
      } else if (apiUrl.startsWith('/')) {
        socketOrigin = window.location.origin;
        const basePath = apiUrl.replace(/\/$/, '');
        if (basePath && basePath !== '/') socketPath = `${basePath}/socket.io/`;
      }
    }

    const socket = io(socketOrigin, {
      path: socketPath,
      transports: ['websocket', 'polling']
    });

    const stored = getStoredParticipant();
    if (stored.participantId) {
       socket.emit('join_session', { session_id: createdSessionId, participant_id: stored.participantId });
    }

    const onPartnerJoined = ({ joined_role }) => {
      if (joined_role === 'B') {
        // Partner joined! Dismiss modal and go to game
        navigate(`/session/${createdSessionId}/game`);
      }
    };

    socket.on('dual_partner_joined', onPartnerJoined);

    return () => {
      socket.off('dual_partner_joined', onPartnerJoined);
      socket.disconnect();
    };
  }, [view, createdSessionId, navigate, isDev]);

// ...

function PairingCodeDisplay({ code, expiresAt, onContinue }) {
    const [timeLeft, setTimeLeft] = useState(null);

    useEffect(() => {
      const timer = setInterval(() => {
        const seconds = Math.floor((new Date(expiresAt) - new Date()) / 1000);
        setTimeLeft(seconds);
        
        if (seconds <= 0) {
          clearInterval(timer);
        }
      }, 1000);

      return () => clearInterval(timer);
    }, [expiresAt]);

    return (
      <div className="min-h-screen bg-white flex flex-col p-6 items-center justify-center font-sans">
        <div className="max-w-md w-full text-center space-y-8">
          <h2 className="text-3xl font-extrabold text-gray-900">Share This Code</h2>
          
          <div className="bg-blue-50 p-8 rounded-3xl border-2 border-blue-100 shadow-xl">
            <div className="text-6xl font-black tracking-widest text-blue-600 font-mono">
              {code}
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-gray-600 text-lg">
              Have your partner scan the same QR code and select <br/>
              <span className="font-bold text-gray-900">"Join Dual-Phone Session"</span>
            </p>
            
            {timeLeft !== null && timeLeft > 0 ? (
                <p className="text-sm text-gray-400 font-medium uppercase tracking-wide">
                Expires in {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
                </p>
            ) : (
                 <p className="text-sm text-red-500 font-bold uppercase tracking-wide">
                 Code expired. Please start a new session.
                 </p>
            )}
          </div>

          <Button 
            onClick={onContinue}
            variant="primary"
            size="xl"
            fullWidth
            className="mt-8"
          >
            Continue to Questions →
          </Button>
        </div>
      </div>
    );
}

// ... in main render ...
  const handleJoinDual = async () => {
    if (joinCode.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await joinDualSession({
        table_token: tableToken,
        code: joinCode,
        restaurant_slug: restaurantSlug || sessionStorage.getItem('restaurant_slug')
      });
      storeParticipant(data.participant_id, data.session_id, data.participant_token);
      navigate(`/session/${data.session_id}/game`);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleContinueToGame = () => {
    // For the creator of Dual Phone session, once they share code
    // They navigate to game where they will wait for partner
    // We already stored participant_id in handleStartDual
    // We need the sessionId from somewhere... wait, we need to store it in state or session storage
    const storedSessionId = sessionStorage.getItem('session_id');
    if (storedSessionId) {
      navigate(`/session/${storedSessionId}/game`);
    } else {
      setError("Session lost. Please restart.");
      setView('mode-select');
    }
  };

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  };

  // --- RENDER VIEWS ---

  const modes = [
    {
      id: 'single-phone',
      title: 'Single-Phone Mode',
      description: 'Share one screen. Read each question out loud.',
      onClick: handleSinglePhone
    },
    {
      id: 'dual-phone',
      title: 'Dual-Phone Mode',
      description: 'Each of you follows on your own screen.',
      onClick: handleStartDual
    }
  ];

  return (
    <div className="min-h-screen bg-[#F3EDE1] flex flex-col p-6 relative overflow-hidden selection:bg-[#35332E]/10 selection:text-[#35332E]">

      <header className="mb-12 mt-10 text-left relative z-10 max-w-md mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-6"
        >
          <span className="text-xs font-semibold text-[#6E6A60] uppercase tracking-[0.18em]">Step 2 of 2</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="text-4xl md:text-5xl font-bold text-[#35332E] tracking-tight leading-[1.1]"
        >
          How are you playing?
        </motion.h1>
      </header>

      <main className="flex-1 flex flex-col justify-start max-w-md mx-auto w-full relative z-10 pb-8">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="flex flex-col gap-4"
        >
          {modes.map((m) => (
            <motion.button
              key={m.id}
              variants={item}
              onClick={m.onClick}
              disabled={loading}
              whileHover={!loading ? { scale: 1.015, y: -1 } : {}}
              whileTap={!loading ? { scale: 0.99 } : {}}
              className="group relative w-full text-left p-7 rounded-2xl border transition-all duration-150 bg-[#FBF7EF] border-[#DCD3C2] hover:bg-[#35332E] hover:border-[#35332E] active:bg-[#26241F] active:border-[#26241F] shadow-sm hover:shadow-xl hover:shadow-[#35332E]/8 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-4 focus:ring-[#35332E]/10"
            >
              <h3 className={`text-2xl font-semibold transition-colors text-[#35332E] group-hover:text-[#F3EDE1] group-active:text-[#F3EDE1]`}>
                {m.title}
              </h3>
              {m.description && (
                <p className={`mt-3 text-base leading-relaxed transition-colors text-[#6E6A60] group-hover:text-[#F3EDE1]/85 group-active:text-[#F3EDE1]/85`}>
                  {m.description}
                </p>
              )}
            </motion.button>
          ))}
        </motion.div>
      </main>
      
      {loading && (
        <div className="fixed inset-0 bg-[#F3EDE1]/80 backdrop-blur-sm flex items-center justify-center z-50">
           <div className="flex flex-col items-center gap-4">
             <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#35332E] border-t-transparent"></div>
             <p className="text-gray-500 font-bold animate-pulse">Starting Session...</p>
           </div>
        </div>
      )}
    </div>
  );
}
