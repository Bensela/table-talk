import React, { useState } from 'react';
import { createPortal } from 'react-dom';
// SessionMenu: Handles global session navigation and resets
import { motion, AnimatePresence } from 'framer-motion';
import Button from './ui/Button';
import { createSession } from '../api';
import { getStoredParticipant, clearStoredParticipant, storeParticipant, setLastResetAt, storeDualSession, getDualSession, clearDualSession } from '../utils/sessionStorage';

export default function SessionMenu({
  tableToken,
  currentContext,
  currentMode,
  socketRef,
  onSessionChange // Optional callback if parent needs to know
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRestart = () => {
    if (!tableToken) return;
    setLastResetAt();
    
    // Clear session-specific data but KEEP persistent tokens if needed
    clearStoredParticipant();
    
    // Also clear dual session history to truly start fresh
    // If product wants "Start Fresh" to mean "Forget everything about this table for now",
    // then clearing the dual session pointer is correct.
    clearDualSession(tableToken);

    // Note: Do NOT clear the global socket. The user might just be resetting state.
    // The socket provider handles connection lifecycle.
    
    // Redirect to scanner/landing
    // The requirement says "Redirect to QR Code scanner page".
    // In our app, the QR scanner is on the Home page ('/').
    // The WelcomeScreen (/t/:token) is the *result* of a scan.
    // "QR Code scanner front page" likely means the Home page where you click "Scan QR".
    window.location.href = '/';
  };

  const handleQuickSwitch = async (updates = {}) => {
    if (!tableToken) return;
    
    const newContext = updates.context || currentContext;
    const newMode = updates.mode || currentMode;
    
    // Check if resuming Dual Mode
    if (newMode === 'dual-phone' && currentMode !== 'dual-phone') {
      const resumableSessionId = getDualSession(tableToken);
      if (resumableSessionId) {
        // Resume existing dual session instead of creating new
        setLoading(true);
        setIsOpen(false);
        
        // We need to fetch participant info for this session if not in storage
        // But storage only holds ONE active session.
        // So we need to re-join or resolve.
        // Actually, resolveSession API can handle this if we pass the session ID?
        // Or we just redirect and let SessionGame handle the re-join via participant ID if stored?
        // Wait, if we switched to Single, we overwrote participant_id in storage.
        // So we lost the credentials for the Dual session unless we stored them separately.
        
        // Revised Plan: We need to rely on the backend `joinDualPhoneSession` or `resolveSession` 
        // to recover the participant or create a new one for the EXISTING session.
        
        // Let's try to join the resumable session.
        try {
           // We redirect to the session. The SessionGame will try to use current participant_id.
           // But current participant_id is for the SINGLE session.
           // So SessionGame will fail auth.
           
           // We need to "switch" credentials.
           // Since we didn't store dual credentials separately in the plan (only session ID),
           // we treat this as a "New Participant Joining Existing Session".
           // This is valid. The user is re-joining.
           
           // Call join-dual to get new credentials for the old session
           // OR if we are A/B, we might need to reclaim role?
           // If we lost the token, we can't reclaim role A easily without a "device_token" persistent cookie.
           
           // Simplified approach for now:
           // Redirect to the dual session ID. 
           // SessionGame will see it has no valid participant_id for this session.
           // It should trigger a join? 
           // Currently SessionGame expects stored participant.
           
           // Let's use the resolver logic:
           // We can't use createSession.
           // We should use joinDualPhoneSession with the session_id.
           const { joinDualSession } = require('../api'); // Need to import this or add to imports
           // Ah, createSession is imported from api.
           
           // Actually, let's just let the standard flow handle it?
           // If we redirect to /session/:id/game, SessionGame runs.
           // It checks getStoredParticipant().sessionId === :id.
           // It will be FALSE (because we are in Single mode).
           // So it will say "Missing participant ID".
           // We need a way to auto-join.
           
           // Ideally, we should have stored the dual participant_token too.
           // But given the constraints, let's just create a new participant in that session?
           // But Role A and B might be taken?
           // If I am A, and I left, and I come back, I want to be A.
           // Without my token, I can't prove I am A.
           
           // CRITICAL: We need to store participant credentials alongside the session ID for resume.
           // Let's update sessionStorage.js to store a blob.
           
           // For this specific step, let's assume we implement the "create new if fail" fallback 
           // but prioritize the dual session.
           
           // Since I can't easily change the storage schema safely in one go without breaking types,
           // I will use the `createSession` flow but pass the `session_id` if I want to join it?
           // No, `createSession` makes a NEW one.
           
           // Let's just create a new session for now to satisfy the "Switch" requirement 
           // BUT implementing the "Resume" logic requires the "device_token" which we do have (maybe).
           
           // Wait, the prompt says: "Switching to Single... must not mutate existing Dual".
           // "When user switches back... if active, resume it."
           
           // Okay, let's assume the user is "Phone A".
           // If Phone A drops credentials, they can't resume as Phone A.
           // So we MUST persist credentials.
           
           // Let's rely on the `resolveSession` endpoint?
           // It takes `device_token`. 
           // If we send the `participant_token` from the DUAL session as `device_token`, we get back in.
           // So we need to store the `participant_token` of the Dual session before we switch away.
           
           // Action: Update `storeDualSession` to take credentials.
        } catch (e) {
           console.error("Resume failed", e);
        }
      }
    }

    setLoading(true);
    setIsOpen(false);

    try {
      // If currently in Dual Mode, save it for later resume
      if (currentMode === 'dual-phone') {
         // We need the current session ID and credentials.
         // We can get them from storage before clearing.
         // getStoredParticipant is imported from sessionStorage.js
         const current = getStoredParticipant();
         if (current.sessionId && current.participantToken) {
             storeDualSession(tableToken, current.sessionId, current.participantId, current.participantToken);
         }
      }

      setLastResetAt();
      clearStoredParticipant();
      // Socket disconnect moved to after migration emit

      // Check if we are RESUMING a dual session
      if (newMode === 'dual-phone') {
          const dualData = getDualSession(tableToken);
          if (dualData) {
              console.log("Resuming previous dual session:", dualData.sessionId);
              // Restore credentials
              storeParticipant(dualData.participantId, dualData.sessionId, dualData.participantToken);
              window.location.href = `/session/${dualData.sessionId}/game`;
              return;
          }
      }

      const { data } = await createSession({
        table_token: tableToken,
        context: newContext,
        mode: newMode
      });

      // Notify partner to follow to new session (if connected)
      // ONLY if the new session is also Dual Mode. 
      // If switching to Single, we leave the partner behind in the old session (as per rules).
      if (socketRef?.current?.connected && newMode === 'dual-phone') {
        console.log('[Menu] Migrating partner to', data.session_id);
        socketRef.current.emit('migrate_session', { newSessionId: data.session_id });
        
        // Give a tiny delay for the emit to go out before killing connection/redirecting?
        // Socket.io emits are usually async but fire-and-forget.
        await new Promise(r => setTimeout(r, 100));
      }

      storeParticipant(data.participant_id, data.session_id, data.participant_token);
      if (socketRef?.current) socketRef.current.disconnect();
      
      // Optional: Add toast/notification logic here if global toast provider exists
      // For now, simple redirect is sufficient as the page reload acts as feedback
      
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
                               onClick={() => handleQuickSwitch({ mode: m.id })}
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
