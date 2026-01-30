import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { createSession, getSession, updateSessionMode } from '../api';
import SelectionCard from '../components/ui/SelectionCard';

export default function ModeSelection() {
  const { tableToken, sessionId } = useParams(); // Support both new flow (tableToken) and legacy (sessionId)
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [currentMode, setCurrentMode] = useState(null);

  // Get context from previous step (if in new flow)
  const context = location.state?.context;

  useEffect(() => {
    // If we have a sessionId (legacy flow or re-joining), check its status
    if (sessionId) {
      const checkSession = async () => {
        try {
          const { data } = await getSession(sessionId);
          if (data.mode) {
            setCurrentMode(data.mode);
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

  const handleSelectMode = async (mode) => {
    setLoading(true);
    try {
      if (sessionId) {
        // Legacy/Existing session flow
        await updateSessionMode(sessionId, mode);
        navigate(`/session/${sessionId}/game`);
      } else {
        // New flow: Create session
        const { data } = await createSession({
          table_token: tableToken,
          context: context,
          mode: mode
        });
        navigate(`/session/${data.session_id}/game`);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to start session. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col p-6 relative overflow-hidden font-sans selection:bg-blue-100 selection:text-blue-900">
      
      {/* Background Ambience */}
      <div className="absolute top-[-20%] right-[-20%] w-[500px] h-[500px] bg-blue-50/60 rounded-full blur-3xl pointer-events-none opacity-60" />
      <div className="absolute bottom-[-20%] left-[-20%] w-[500px] h-[500px] bg-purple-50/60 rounded-full blur-3xl pointer-events-none opacity-60" />

      <header className="mb-12 mt-8 text-center relative z-10 max-w-md mx-auto">
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
          className="flex flex-col gap-6"
        >
          <motion.div variants={item}>
            <SelectionCard
              title="Single-Phone Mode"
              description="One device guides the conversation while minimizing phone interaction."
              icon="📱"
              onClick={() => handleSelectMode('single-phone')}
              disabled={loading}
              className="hover:border-blue-200 hover:shadow-xl hover:shadow-blue-500/5 py-8"
            />
          </motion.div>

          <motion.div variants={item}>
            <SelectionCard
              title="Dual-Phone Mode"
              description="Two participants remain synchronized while allowing brief private reflection when appropriate."
              icon="📱⚡📱"
              onClick={() => handleSelectMode('dual-phone')}
              disabled={loading}
              className="hover:border-purple-200 hover:shadow-xl hover:shadow-purple-500/5 py-8"
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
