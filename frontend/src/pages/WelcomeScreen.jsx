import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import Button from '../components/ui/Button';
import { getSessionByTable, resumeSessionByQr } from '../api';
import { getStoredParticipant, storeParticipant } from '../utils/sessionStorage';

export default function WelcomeScreen() {
  const { tableToken } = useParams();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [activeSession, setActiveSession] = useState(null);

  const handleContinue = async () => {
    if (!tableToken) {
      navigate('/');
      return;
    }

    setChecking(true);
    try {
      // 1. Check if there is an active session for this table
      const { data } = await getSessionByTable(tableToken);
      
      // If active session exists, show "Active Session Found" screen
      if (data && data.session_id) {
        // Check if user is trying to resume (legacy check or fast resume failed)
        const stored = getStoredParticipant();
        if (stored.sessionId === data.session_id && stored.participantId) {
             // Valid resume
             navigate(`/session/${data.session_id}/game`);
        } else {
             // New user or stranger scanning active table
             setActiveSession(data);
        }
      } else {
        // No session -> Standard flow
        navigate(`/t/${tableToken}/context`);
      }
    } catch (err) {
      // 404 means no session -> Standard flow
      navigate(`/t/${tableToken}/context`);
    } finally {
      setChecking(false);
    }
  };

  const handleStartNew = () => {
    navigate(`/t/${tableToken}/context`);
  };

  const handleJoinDual = () => {
    if (activeSession) {
        // Go to Mode Selection with context to join
        navigate(`/t/${tableToken}/mode`, { state: { context: activeSession.context } });
    }
  };

  // Format table token for display
  const displayTable = tableToken 
    ? tableToken.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    : 'Table Talk';

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
