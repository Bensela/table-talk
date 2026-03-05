import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import Button from '../components/ui/Button';
import { resolveSession, joinDualSession, createSession } from '../api';
import { storeParticipant, getStoredParticipant, getDualSession, storeDualSession } from '../utils/sessionStorage';

export default function WelcomeScreen() {
  const { tableToken } = useParams();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState(null);

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
      
      const { action, session_id, participant_id, participant_token, mode } = resolveRes.data;
      console.log('[Welcome] Resolution Action:', action);

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

      if (action === 'join_dual') {
          setStatus('Joining partner...');
          console.log('[Welcome] Auto-joining dual session:', session_id);
          // Auto-join waiting session (Phone B joins Phone A)
          const joinRes = await joinDualSession({ session_id });
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
          // UNLESS we want to force start immediately?
          // The previous logic routed to `/t/:token/context`.
          // Let's stick to that flow for new sessions.
          setStatus('Ready to start');
          navigate(`/t/${tableToken}/context`);
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
