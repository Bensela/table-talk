import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Button from './ui/Button';
import api, { createSession } from '../api';
import { 
  getStoredParticipant, 
  clearStoredParticipant, 
  storeParticipant, 
  setLastResetAt, 
  storeDualSession, 
  getDualSession, 
  clearDualSession 
} from '../utils/sessionStorage';
import { SCANNER_ROUTE } from '../constants/routes';

export default function SessionMenu({
  tableToken,
  currentContext,
  currentMode,
  socketRef,
  onSessionChange // Optional callback if parent needs to know
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRestart = async () => {
    if (!tableToken) {
        console.error("[Menu] handleRestart called but tableToken is missing");
        return;
    }
    
    console.log("[Menu] handleRestart called. Mode:", currentMode, "Token:", tableToken);

    // If currently in Dual Mode, handle termination intent
    if (currentMode === 'dual-phone') {
       // We save local credentials in dual storage just in case we are the "First" one leaving
       // and want to resume later if the partner didn't leave (and session wasn't terminated).
       const current = getStoredParticipant();
       
       // Send HTTP request for reliability (Wait for it)
       if (current.sessionId && current.participantId) {
           console.log("[Menu] Sending Fresh Intent via API");
           // We use fire-and-forget style if we want speed, but for "instantly" ensuring DB update:
           // We should await.
           try {
               await api.post(`/sessions/${current.sessionId}/fresh_intent`, { participant_id: current.participantId });
           } catch (e) {
               console.error("Failed to send fresh intent API", e);
           }
       }
       
       // Also emit socket for realtime UI update (if connected)
       if (socketRef?.current?.connected) {
           console.log("[Menu] Sending Fresh Intent via Socket");
           socketRef.current.emit('fresh_intent');
       }

       console.log("[Menu] Storing dual session backup:", current);
       if (current.sessionId && current.participantToken) {
           storeDualSession(tableToken, current.sessionId, current.participantId, current.participantToken);
       } else {
           console.warn("[Menu] Missing credentials, cannot store dual backup");
       }
    }

    setLastResetAt();
    
    // In Dual Mode, we keep the participantToken so the backend can recognize the user
    // and enforce the "no new table while active" rule.
    // In Single Mode, we permanently terminate the session.
    if (currentMode !== 'dual-phone') {
        const current = getStoredParticipant();
        if (current.sessionId) {
            try {
                await api.delete(`/sessions/${current.sessionId}`);
                console.log("[Menu] Single Mode session permanently terminated.");
            } catch (e) {
                console.error("Failed to terminate single mode session", e);
            }
        }
        clearStoredParticipant();
        clearDualSession(tableToken);
    }
    
    // Redirect to scanner with slight delay to ensure socket emit
    setTimeout(() => {
        if (socketRef?.current) {
            socketRef.current.disconnect();
        }
        window.location.href = SCANNER_ROUTE;
    }, 100);
  };

  const handleUpgradeToDual = async () => {
    if (!tableToken) return;
    setLoading(true);
    
    const current = getStoredParticipant();
    if (current.sessionId && current.participantId) {
        try {
            await api.post(`/sessions/${current.sessionId}/upgrade`, { participant_id: current.participantId });
            console.log("[Menu] Upgraded to Dual Mode");
            
            // Ensure dual session backup is saved
            storeDualSession(tableToken, current.sessionId, current.participantId, current.participantToken);
            
            setIsOpen(false);
            // The backend emits 'session_updated' which triggers fetchCurrentQuestion
            // But just in case, we can force a local update or reload
            window.location.reload();
        } catch (e) {
            console.error("Failed to upgrade session to Dual Mode", e);
        }
    }
    setLoading(false);
  };

  const handleQuickSwitch = async (updates = {}) => {
    if (!tableToken) return;
    
    const newContext = updates.context || currentContext;
    const newMode = updates.mode || currentMode;
    
    // 1. Resume Dual Mode Check
    if (newMode === 'dual-phone' && currentMode !== 'dual-phone') {
      const dualData = getDualSession(tableToken);
      if (dualData) {
          console.log("Resuming previous dual session:", dualData.sessionId);
          // Restore credentials
          storeParticipant(dualData.participantId, dualData.sessionId, dualData.participantToken);
          
          // Update context if needed
          if (newContext !== currentContext) {
             try {
                 const api = require('../api').default; 
                 await api.patch(`/sessions/${dualData.sessionId}`, { context: newContext });
             } catch (e) {
                 console.error("Failed to update context on resume", e);
             }
          }
          
          window.location.href = `/session/${dualData.sessionId}/game`;
          return;
      }
    }

    setLoading(true);
    setIsOpen(false);

    try {
      // 2. Dual Mode Context Switch (Mutation via Socket)
      if (currentMode === 'dual-phone' && newMode === 'dual-phone' && newContext !== currentContext) {
          if (socketRef?.current?.connected) {
             console.log("[Menu] Sending Context Switch Intent:", newContext);
             
             // Emit intent
             socketRef.current.emit('context_switch_intent', { context: newContext });
             
             // OPTIONAL: We can set a "pending" flag in parent if needed, 
             // but SessionGame handles the "pendingSwitchContext" logic for popups.
             // We assume SessionGame will receive the event if we are on that page?
             // Ah, SessionMenu is rendered INSIDE SessionGame (via header).
             // But SessionMenu doesn't have access to SessionGame's state setter.
             // We need to inform SessionGame that WE initiated the switch so it ignores the echo.
             
             if (onSessionChange) {
                 // Pass the intent up so SessionGame can set pendingSwitchContext
                 onSessionChange({ pendingContext: newContext });
             }
             
             setLoading(false);
             return;
          } else {
             // Fallback to API if socket dead
             const current = getStoredParticipant();
             if (current.sessionId) {
                  console.log("[Menu] Updating existing Dual Session context (Fallback):", newContext);
                  const api = require('../api').default; 
                  await api.patch(`/sessions/${current.sessionId}`, { context: newContext });
                  window.location.reload();
                  return;
             }
          }
      }

      // 3. Save Dual Session State before switching away (if leaving Dual Mode)
      if (currentMode === 'dual-phone') {
         const current = getStoredParticipant();
         if (current.sessionId && current.participantToken) {
             storeDualSession(tableToken, current.sessionId, current.participantId, current.participantToken);
         }
      }

      // 4. Standard Session Creation (New Session)
      // For switching modes or starting fresh context in Single Mode
      const { data } = await createSession({
        table_token: tableToken,
        context: newContext,
        mode: newMode
      });

      // Notify partner to follow (if migrating from Single to Dual or similar)
      if (socketRef?.current?.connected && newMode === 'dual-phone') {
        console.log('[Menu] Migrating partner to', data.session_id);
        socketRef.current.emit('migrate_session', { newSessionId: data.session_id });
        await new Promise(r => setTimeout(r, 100));
      }

      storeParticipant(data.participant_id, data.session_id, data.participant_token);
      if (socketRef?.current) socketRef.current.disconnect();
      
      window.location.href = `/session/${data.session_id}/game`;
    } catch (err) {
      console.error("Failed to switch session:", err);
      setLoading(false);
      alert("Failed to start new session. Please try again.");
    }
  };

  // Helper for Context display
  const getContextColor = (ctx) => {
    switch (ctx) {
      case 'Exploring': return 'text-blue-600 bg-blue-50 border-blue-200';
      case 'Established': return 'text-purple-600 bg-purple-50 border-purple-200';
      case 'Mature': return 'text-rose-600 bg-rose-50 border-rose-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  return (
    <>
      <div 
        className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
        onClick={() => setIsOpen(true)}
      >
        <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 hover:bg-gray-200 transition-colors">
          <span className="text-xl">☰</span>
        </div>
        <span className="text-sm font-bold text-gray-900 tracking-wider hidden sm:block">MENU</span>
      </div>

      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsOpen(false)}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="relative bg-white w-full max-w-sm rounded-3xl shadow-xl overflow-hidden flex flex-col"
              >
                 {/* Clean Card Header */}
                 <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-white relative z-10">
                   <div>
                     <h3 className="text-lg font-bold text-gray-900">Session Settings</h3>
                     <div className="flex items-center gap-2 mt-1">
                       <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${getContextColor(currentContext)}`}>
                         {currentContext}
                       </span>
                       <span className="text-xs text-gray-400">•</span>
                       <span className="text-xs text-gray-500 font-medium">
                         {currentMode === 'dual-phone' ? 'Dual Phone' : 'Single Phone'}
                       </span>
                     </div>
                   </div>
                   <button 
                     onClick={() => setIsOpen(false)}
                     className="w-8 h-8 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
                   >
                     ✕
                   </button>
                 </div>
                 
                 {loading ? (
                   <div className="py-12 flex flex-col items-center justify-center">
                     <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-3"></div>
                     <p className="text-gray-500 text-sm font-medium">Updating session...</p>
                   </div>
                 ) : (
                   <div className="p-6 space-y-6 relative z-10 text-left bg-white">
                     
                     {/* Section A: Maturity (Chips) */}
                     <div>
                       <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Relationship Maturity</p>
                       <div className="flex flex-wrap gap-2">
                        {['Exploring', 'Established'].map((m) => {
                          const isActive = currentContext === m;
                          return (
                             <button
                               key={m}
                               onClick={() => handleQuickSwitch({ context: m })}
                               className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                                 isActive
                                   ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                   : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                               }`}
                             >
                               {m}
                             </button>
                           );
                         })}
                       </div>
                     </div>

                     {/* Section B: Mode (Cards) */}
                     <div>
                       <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Session Approach</p>
                       <div className="grid grid-cols-2 gap-3">
                         {[
                           { id: 'single-phone', label: 'Single Phone', icon: '📱' }, 
                           { id: 'dual-phone', label: 'Dual Phone', icon: '📱📱' }
                         ].map((m) => {
                           const isActive = currentMode === m.id;
                           return (
                             <button
                               key={m.id}
                               onClick={() => {
                                 if (m.id === 'dual-phone' && currentMode === 'single-phone') {
                                   handleUpgradeToDual();
                                 } else if (m.id === 'single-phone' && currentMode === 'dual-phone') {
                                   // Not fully supported to downgrade without dropping partner, 
                                   // but fallback to quick switch if they really want to.
                                   handleQuickSwitch({ mode: m.id });
                                 } else {
                                   handleQuickSwitch({ mode: m.id });
                                 }
                               }}
                               className={`p-3 rounded-xl border text-left transition-all relative overflow-hidden ${
                                 isActive 
                                   ? 'bg-gray-900 border-gray-900 text-white shadow-md' 
                                   : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                               }`}
                             >
                               <div className="text-xl mb-1">{m.icon}</div>
                               <div className="text-xs font-bold uppercase tracking-wide opacity-90">{m.label}</div>
                               {isActive && (
                                 <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]" />
                               )}
                             </button>
                           );
                         })}
                       </div>
                     </div>

                     {/* Section C: Actions */}
                     <div className="pt-6 border-t border-gray-100 flex flex-col gap-3">
                       <Button 
                         onClick={() => setIsOpen(false)}
                         variant="primary"
                         fullWidth
                         className="py-3 text-base"
                       >
                         Resume Current Session
                       </Button>

                       <button 
                         onClick={handleRestart}
                         className="w-full py-3 text-sm font-medium text-red-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors flex items-center justify-center gap-2"
                       >
                         <span className="text-lg">🔄</span>
                         Start Fresh (Reset All)
                       </button>
                     </div>
                   </div>
                 )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}