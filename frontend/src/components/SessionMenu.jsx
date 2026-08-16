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
               const res = await api.post(`/sessions/${current.sessionId}/fresh_intent`, { participant_id: current.participantId });
               console.log("[Menu] Sent fresh intent. Keeping device token until session is terminated.");
           } catch (e) {
               console.error("Failed to send fresh intent API", e);
           }
       }
       
       // Also emit socket for realtime UI update (if connected)
       if (socketRef?.current?.connected) {
           console.log("[Menu] Sending Fresh Intent via Socket");
           socketRef.current.emit('fresh_intent', { session_id: current.sessionId, participant_id: current.participantId });
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
            const res = await api.post(`/sessions/${current.sessionId}/upgrade`, { participant_id: current.participantId });
            console.log("[Menu] Upgraded to Dual Mode response:", res.data);
            
            // Ensure dual session backup is saved
            storeDualSession(tableToken, current.sessionId, current.participantId, current.participantToken);
            
            setIsOpen(false);
            // The backend emits 'session_updated' which triggers fetchCurrentQuestion
            // But just in case, we can force a local update or reload
            window.location.reload();
        } catch (e) {
            console.error("Failed to upgrade session to Dual Mode", e);
            if (e.response) {
               console.error("Error data:", e.response.data);
            }
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
          
          // Before navigating, we must also tell the backend to flip the mode back to dual
          // because it might be set to single right now.
          try {
             // We can't safely rely on dynamic require in vite/react easily, so use the imported api
             await api.post(`/sessions/${dualData.sessionId}/upgrade`, { participant_id: dualData.participantId });
          } catch (e) {
             console.error("Failed to upgrade back to dual on resume", e);
          }

          // Update context if needed
          if (newContext !== currentContext) {
             try {
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
         if (socketRef?.current?.connected && newMode === 'single-phone') {
             console.log('[Menu] Notifying partner of mode switch to single-phone');
             socketRef.current.emit('partner_switched_mode', { newMode });
             await new Promise(r => setTimeout(r, 100));
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

  // Helper for Context display. Internal DB IDs stay Exploring/Established/Mature;
  // user-facing labels never force the couple to define their relationship.
  const contextDisplay = (ctx) => {
    switch (ctx) {
      case 'Exploring': return 'Keep it light';
      case 'Established': return 'Go deeper';
      case 'Mature': return 'Stay awhile';
      default: return ctx || '—';
    }
  };

  const getContextStyle = (ctx) => {
    switch (ctx) {
      case 'Exploring': return 'text-[#35332E] bg-[#FBF7EF] border-[#DCD3C2]';
      case 'Established': return 'text-[#35332E] bg-[#FBF7EF] border-[#DCD3C2]';
      case 'Mature': return 'text-[#35332E] bg-[#FBF7EF] border-[#DCD3C2]';
      default: return 'text-[#6E6A60] bg-[#FBF7EF] border-[#DCD3C2]';
    }
  };

  const contextOptions = [
    { id: 'Exploring', label: 'Keep it light' },
    { id: 'Established', label: 'Go deeper' }
  ];

  return (
    <>
      <div
        className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
        onClick={() => setIsOpen(true)}
      >
        <div className="w-10 h-10 rounded-full bg-[#FBF7EF] border border-[#DCD3C2] flex items-center justify-center text-[#35332E] hover:bg-[#35332E] hover:text-[#F3EDE1] hover:border-[#35332E] transition-colors">
          <span className="text-lg font-bold">☰</span>
        </div>
        <span className="text-sm font-semibold text-[#35332E] tracking-wider hidden sm:block">MENU</span>
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
                className="absolute inset-0 bg-[#35332E]/55 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="relative bg-[#F3EDE1] w-full max-w-sm rounded-3xl shadow-xl overflow-hidden flex flex-col border border-[#DCD3C2]"
              >
                 {/* Header */}
                 <div className="px-6 pt-6 pb-4 flex items-start justify-between bg-[#F3EDE1] relative z-10 gap-4">
                   <h3 className="text-2xl font-semibold text-[#35332E] pt-2 leading-none">Session Settings</h3>
                   <button
                     onClick={() => setIsOpen(false)}
                     aria-label="Close menu"
                     className="flex-shrink-0 flex items-center justify-center w-[44px] h-[44px] min-w-[44px] min-h-[44px] rounded-2xl bg-transparent border border-[#DCD3C2] hover:border-[#35332E]/30 hover:bg-[#FBF7EF] text-[#6E6A60] hover:text-[#35332E] transition-colors"
                   >
                     <span className="text-xl font-bold leading-none">×</span>
                   </button>
                 </div>

                 {loading ? (
                   <div className="py-12 flex flex-col items-center justify-center">
                     <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#35332E] mb-3"></div>
                     <p className="text-[#6E6A60] text-sm font-medium">Updating session...</p>
                   </div>
                 ) : (
                   <div className="px-6 pb-6 space-y-7 relative z-10 text-left bg-[#F3EDE1]">

                     {/* Section A: QUESTION TYPE */}
                     <div>
                       <p className="text-xs font-semibold text-[#6E6A60] uppercase tracking-[0.18em] mb-3">Question Type</p>
                       <div className="grid grid-cols-2 gap-3">
                        {contextOptions.map((m) => {
                          const isActive = currentContext === m.id;
                          return (
                             <button
                               key={m.id}
                               onClick={() => handleQuickSwitch({ context: m.id })}
                               className={`px-4 py-3 rounded-2xl text-sm font-semibold transition-all ${
                                 isActive
                                   ? 'bg-[#35332E] text-[#F3EDE1] border-0 shadow-sm'
                                   : 'bg-transparent text-[#35332E] border border-[#DCD3C2] hover:border-[#35332E]/40 hover:bg-[#FBF7EF]/60'
                               }`}
                             >
                               {m.label}
                             </button>
                           );
                         })}
                       </div>
                     </div>

                     {/* Section B: SESSION APPROACH */}
                     <div>
                       <p className="text-xs font-semibold text-[#6E6A60] uppercase tracking-[0.18em] mb-3">Session Approach</p>
                       <div className="grid grid-cols-2 gap-3">
                         {[
                           { id: 'single-phone', label: 'Single-Phone Mode' },
                           { id: 'dual-phone', label: 'Dual-Phone Mode' }
                         ].map((m) => {
                           const isActive = currentMode === m.id;
                           return (
                             <button
                               key={m.id}
                               onClick={() => {
                                 if (m.id === 'dual-phone' && currentMode === 'single-phone') {
                                   const dualData = getDualSession(tableToken);
                                   if (dualData && dualData.sessionId) {
                                      handleQuickSwitch({ mode: m.id });
                                   } else {
                                      handleUpgradeToDual();
                                   }
                                 } else if (m.id === 'single-phone' && currentMode === 'dual-phone') {
                                   handleQuickSwitch({ mode: m.id });
                                 } else {
                                   handleQuickSwitch({ mode: m.id });
                                 }
                               }}
                               className={`px-4 py-3 rounded-2xl text-sm font-semibold transition-all ${
                                 isActive
                                   ? 'bg-[#35332E] text-[#F3EDE1] border-0 shadow-sm'
                                   : 'bg-transparent text-[#35332E] border border-[#DCD3C2] hover:border-[#35332E]/40 hover:bg-[#FBF7EF]/60'
                               }`}
                             >
                               {m.label}
                             </button>
                           );
                         })}
                       </div>
                     </div>

                     {/* Actions */}
                     <div className="pt-5 flex flex-col gap-5">
                       <Button
                         onClick={() => setIsOpen(false)}
                         variant="ink"
                         fullWidth
                         className="py-3.5 text-base font-semibold rounded-2xl"
                       >
                         Resume Current Session
                       </Button>

                       <button
                         onClick={handleRestart}
                         className="w-full py-2 text-base font-semibold text-[#35332E] underline bg-transparent border-0 rounded-none hover:opacity-80 transition-opacity"
                       >
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
