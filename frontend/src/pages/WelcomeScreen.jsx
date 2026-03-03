import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import Button from '../components/ui/Button';
import { getSessionByTable, joinDualSession } from '../api';
import { getStoredParticipant, storeParticipant } from '../utils/sessionStorage';

export default function WelcomeScreen() {
  const { tableToken } = useParams();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true); // Start checking immediately
  const [activeSession, setActiveSession] = useState(null);
  const [statusMessage, setStatusMessage] = useState('Connecting...');

  // Auto-Join Logic (Instant Entrance)
  useEffect(() => {
    const autoJoin = async () => {
      if (!tableToken) return;

      try {
        setStatusMessage('Checking for active session...');
        // 1. Check for active session
        const { data } = await getSessionByTable(tableToken);
        
        if (data && data.session_id) {
            // Check if user is ALREADY part of this session
            const stored = getStoredParticipant();
            if (stored.sessionId === data.session_id && stored.participantId) {
                 console.log('Resuming existing session...');
                 navigate(`/session/${data.session_id}/game`);
                 return;
            }

            // New User Logic
            if (data.mode === 'dual-phone' && data.dual_status === 'waiting') {
                // Auto-Join Waiting Session (Role B)
                setStatusMessage('Joining partner...');
                try {
                    const joinRes = await joinDualSession({ table_token: tableToken });
                    // Store new participant token
                    storeParticipant({
                        participantId: joinRes.data.participant_token,
                        sessionId: data.session_id,
                        role: 'participant_b'
                    });
                    navigate(`/session/${data.session_id}/game`);
                    return;
                } catch (joinErr) {
                    console.error('Auto-join failed:', joinErr);
                    // Fallback to manual UI if auto-join fails
                    setActiveSession(data);
                }
            } else {
                // Session exists but not waiting (e.g. single-phone or full)
                // Just join as observer or re-connect?
                // For now, let's treat it as "Active Session Found" UI or redirect to game?
                // User said "allow ANY device to instantly join".
                // Let's redirect to game. If they don't have a token, they might be an observer.
                // But SessionGame requires a participantId usually.
                // Let's show the "Active Session" UI for now if we can't auto-join as Role B.
                // Or maybe just generate a guest ID and go?
                // "Anonymous guest session".
                
                // If single phone, maybe we just join?
                // But single phone doesn't have "join" logic in backend usually (it's created with 1 user).
                // Let's stick to showing the UI for non-waiting sessions to be safe.
                setActiveSession(data);
            }
        } else {
            // No session -> Redirect to Context Selection (Start New)
            // "If not logged in, create anonymous guest session... Redirect... to SessionGame"
            // But we need a CONTEXT first.
            // So redirecting to ContextSelection is the correct "Start New" flow.
            navigate(`/t/${tableToken}/context`);
        }
      } catch (err) {
        console.error('Error checking session:', err);
        // Fallback: Go to Context Selection
        navigate(`/t/${tableToken}/context`);
      } finally {
        setChecking(false);
      }
    };

    autoJoin();
  }, [tableToken, navigate]);

  const handleStartNew = () => {
    navigate(`/t/${tableToken}/context`);
  };

  const handleJoinDual = async () => {
    if (activeSession && activeSession.dual_status === 'waiting') {
        setStatusMessage('Joining partner...');
        setChecking(true);
        try {
            const joinRes = await joinDualSession({ table_token: tableToken });
            storeParticipant({
                participantId: joinRes.data.participant_token,
                sessionId: activeSession.session_id,
                role: 'participant_b'
            });
            navigate(`/session/${activeSession.session_id}/game`);
        } catch (err) {
            console.error('Manual join failed:', err);
            setChecking(false);
            // Could show error toast here
        }
    }
  };

  // Format table token for display
  const displayTable = tableToken 
    ? tableToken.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    : 'Table Talk';

  if (checking) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center animate-pulse">
            <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-500 font-medium">{statusMessage}</p>
          </div>
        </div>
      );
  }

  // Fallback UI (Only shown if auto-join failed or session is full/single)
  if (activeSession) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 font-sans">
        <div className="max-w-md w-full text-center space-y-8">
          <div className="w-20 h-20 bg-blue-100 rounded-full mx-auto flex items-center justify-center text-4xl">
            👀
          </div>
          <h2 className="text-3xl font-extrabold text-gray-900">Active Session Found</h2>
          <p className="text-gray-500 text-lg">
            There is already a conversation happening at <strong>{displayTable}</strong>.
          </p>

          <div className="space-y-4 pt-4">
            {activeSession.mode === 'dual-phone' && activeSession.dual_status === 'waiting' && (
                <Button 
                  onClick={handleJoinDual}
                  variant="primary"
                  size="xl"
                  fullWidth
                >
                  Join Partner
                </Button>
            )}
            
            <Button 
              onClick={handleStartNew}
              variant={activeSession.mode === 'dual-phone' && activeSession.dual_status === 'waiting' ? "secondary" : "primary"}
              size="xl"
              fullWidth
            >
              Start New Session
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans selection:bg-blue-100 selection:text-blue-900">
      
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
            {checking ? 'Joining...' : 'Continue'}
          </Button>
          
          <p className="mt-8 text-xs font-bold text-gray-300 uppercase tracking-widest">
            Anonymous Session • No Data Stored
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
