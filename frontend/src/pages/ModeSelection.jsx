import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { createSession, getSession, updateSessionMode, joinDualSession } from '../api';
import SelectionCard from '../components/ui/SelectionCard';
import Button from '../components/ui/Button';
import { storeParticipant } from '../utils/sessionStorage';

export default function ModeSelection() {
  const { tableToken, sessionId } = useParams(); // Support both new flow (tableToken) and legacy (sessionId)
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  
  // View State: 'mode-select', 'show-code', 'enter-code'
  const [view, setView] = useState('mode-select');
  const [pairingCode, setPairingCode] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState(null);

  // Get context from previous step (if in new flow)
  const context = location.state?.context;

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
        navigate(`/t/${tableToken}/context`);
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
        mode: 'single-phone'
      });
      storeParticipant(data.participant_id, data.session_id);
      navigate(`/session/${data.session_id}/game`);
    } catch (err) {
      console.error(err);
      setError('Failed to start session. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const [pairingExpiresAt, setPairingExpiresAt] = useState(null);

  // ...

  const handleStartDual = async () => {
    setLoading(true);
    try {
      const { data } = await createSession({
        table_token: tableToken,
        context: context,
        mode: 'dual-phone'
      });
      storeParticipant(data.participant_id, data.session_id);
      setPairingCode(data.pairing_code);
      setPairingExpiresAt(data.pairing_expires_at); // Store expiry time
      setView('show-code');
    } catch (err) {
      console.error(err);
      setError('Failed to create session.');
    } finally {
      setLoading(false);
    }
  };

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
        code: joinCode
      });
      storeParticipant(data.participant_id, data.session_id);
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

  if (view === 'show-code') {
    return (
      <PairingCodeDisplay 
        code={pairingCode} 
        expiresAt={pairingExpiresAt}
        onContinue={handleContinueToGame} 
      />
    );
  }
  
  if (view === 'enter-code') {
    return (
      <div className="min-h-screen bg-white flex flex-col p-6 items-center justify-center font-sans">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-2">Enter Join Code</h2>
            <p className="text-gray-500">Enter the 6-digit code from your partner's screen.</p>
          </div>
          
          <div className="space-y-4">
            <input 
              type="text" 
              inputMode="numeric" 
              pattern="[0-9]*" 
              maxLength={6} 
              value={joinCode} 
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '');
                setJoinCode(val);
                setError(null);
              }}
              placeholder="000000" 
              className="w-full text-center text-5xl font-bold tracking-[0.5em] p-6 border-2 border-gray-200 rounded-2xl focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition-all placeholder:text-gray-200 font-mono text-gray-900"
              autoFocus 
            />
            
            {error && (
              <p className="text-red-500 text-center font-medium animate-pulse">
                {error}
              </p>
            )}
          </div>

          <div className="space-y-3 pt-4">
            <Button 
              disabled={joinCode.length !== 6 || loading} 
              onClick={handleJoinDual} 
              variant="primary"
              size="xl"
              fullWidth
              className="shadow-xl shadow-blue-500/20"
            >
              {loading ? 'Joining...' : 'Join Session'}
            </Button>

            <button 
              onClick={() => setView('mode-select')} 
              className="w-full py-4 text-gray-500 font-bold hover:text-gray-900 transition-colors"
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col p-6 relative overflow-hidden font-sans selection:bg-blue-100 selection:text-blue-900">
      
      {/* Background Ambience */}
      <div className="absolute top-[-20%] right-[-20%] w-[500px] h-[500px] bg-blue-50/60 rounded-full blur-3xl pointer-events-none opacity-60" />
      <div className="absolute bottom-[-20%] left-[-20%] w-[500px] h-[500px] bg-purple-50/60 rounded-full blur-3xl pointer-events-none opacity-60" />

      <header className="mb-8 mt-4 text-center relative z-10 max-w-md mx-auto">
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center justify-center gap-2 px-3 py-1 bg-gray-50 rounded-full border border-gray-100 mb-6"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Step 2 of 2</span>
        </motion.div>
        
        <motion.h1 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-4xl font-extrabold text-gray-900 tracking-tight mb-4"
        >
          Choose Mode
        </motion.h1>
        
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-gray-500 text-lg leading-relaxed"
        >
          Decide how you want to interact with the device(s).
        </motion.p>
      </header>

      <main className="flex-1 flex flex-col justify-start max-w-md mx-auto w-full relative z-10 pb-8">
        <motion.div 
          variants={container}
          initial="hidden"
          animate="show"
          className="flex flex-col gap-4"
        >
          {/* Option 1: Single-Phone */}
          <motion.div variants={item}>
            <SelectionCard
              title="Single-Phone Mode"
              description="One device shared between you."
              icon="📱"
              onClick={handleSinglePhone}
              disabled={loading}
              className="hover:border-blue-200 hover:shadow-xl hover:shadow-blue-500/5 py-6"
            />
          </motion.div>

          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-gray-200"></div>
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-3 text-xs font-bold text-gray-400 uppercase tracking-widest">OR DUAL MODE</span>
            </div>
          </div>

          {/* Option 2: Start Dual-Phone */}
          <motion.div variants={item}>
            <SelectionCard
              title="Start Dual-Phone Session"
              description="Create a new session for two devices."
              icon="✨"
              onClick={handleStartDual}
              disabled={loading}
              className="hover:border-purple-200 hover:shadow-xl hover:shadow-purple-500/5 py-6"
            />
          </motion.div>

          {/* Option 3: Join Dual-Phone */}
          <motion.div variants={item}>
            <SelectionCard
              title="Join Dual-Phone Session"
              description="Enter a code from your partner."
              icon="🔗"
              onClick={() => setView('enter-code')}
              disabled={loading}
              className="hover:border-purple-200 hover:shadow-xl hover:shadow-purple-500/5 py-6 bg-gray-50/50"
            />
          </motion.div>
        </motion.div>
      </main>
      
      {loading && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50">
           <div className="flex flex-col items-center gap-4">
             <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
             <p className="text-gray-500 font-bold animate-pulse">Starting Session...</p>
           </div>
        </div>
      )}
    </div>
  );
}
