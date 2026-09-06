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
  clearDualSession,
  getRestaurantSlug
} from '../utils/sessionStorage';
import { SCANNER_ROUTE } from '../constants/routes';
import useAnalytics from '../hooks/useAnalytics';

export default function SessionMenu({
  tableToken,
  currentContext,
  currentMode,
  socketRef,
  canSwitchToSingle,
  onSwitchToSingle, // Optional: override handler for Switch to Single Mode. Used during Start Fresh countdown (20s window).
  feedbackMessage,
  setFeedbackMessage,
  onSessionChange, // Optional callback if parent needs to know
  localFreshInitiatedRef // Optional: synchronous ref set TRUE when *this* phone clicks Start Fresh. Skips Waiting UI on initiator.
}) {
  const { fireSession, firePublic } = useAnalytics();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localFeedback, setLocalFeedback] = useState(null); // SessionMenu-only transient feedback (not shared with parent)

  // Helper: show non-blocking transient feedback. Uses parent's setFeedbackMessage if
  // provided (so it appears on the main session screen's banner, and survives menu
  // close). If not provided, uses SessionMenu's own localFeedback + auto-dismiss.
  const showFeedback = (message, { ttlMs = 5000 } = {}) => {
    if (setFeedbackMessage) {
      setFeedbackMessage(message);
      if (ttlMs > 0) {
        setTimeout(() => {
          // Only clear if it still matches the exact message we set (avoid clobbering
          // a newer/other message set in between).
          setFeedbackMessage((prev) => (prev === message ? null : prev));
        }, ttlMs);
      }
    } else {
      setLocalFeedback(message);
      if (ttlMs > 0) {
        setTimeout(() => setLocalFeedback((prev) => (prev === message ? null : prev)), ttlMs);
      }
    }
  };

  // Simplified mode-switch rule: Dual → Single switch is ONLY allowed when the
  // partner already pressed Start Fresh and left the dual session. Any other
  // scenario (both still connected) requires Start Fresh first). If the caller did
  // not pass canSwitchToSingle, allow switch only in fallback mode.
  const canSwitchToSingleMode = typeof canSwitchToSingle === 'boolean'
    ? canSwitchToSingle
    : currentMode !== 'dual-phone';

  // Wrap open/close to log
  const openMenu = () => {
    const current = getStoredParticipant();
    fireSession({
      event_type: 'menu_opened',
      event_data: {
        table_token: tableToken || null,
        mode: currentMode,
        context: currentContext
      },
      ids: { session_id: current?.sessionId, participant_id: current?.participantId }
    });
    setIsOpen(true);
  };

  const closeMenu = () => {
    const current = getStoredParticipant();
    fireSession({
      event_type: 'menu_closed',
      event_data: {
        table_token: tableToken || null,
        mode: currentMode,
        context: currentContext
      },
      ids: { session_id: current?.sessionId, participant_id: current?.participantId }
    });
    setIsOpen(false);
  };

  const handleRestart = async () => {
    // SET SYNCHRONOUS BEFORE ANY AWAIT / ANY NETWORK CALL.
    // Skips all Waiting Partner UI writes and early-return guards in SessionGame
    // so even if socket/poll writes dual_status=waiting during the 30ms redirect
    // window, Phone A (this phone, initiator) NEVER renders the Waiting page.
    if (localFreshInitiatedRef && typeof localFreshInitiatedRef === 'object') {
      localFreshInitiatedRef.current = true;
    }
    if (!tableToken) {
        console.error("[Menu] handleRestart called but tableToken is missing");
        return;
    }

    const current = getStoredParticipant();
    
    // Fire pressed event
    fireSession({
      event_type: 'menu_start_fresh_pressed',
      event_data: {
        table_token: tableToken,
        mode: currentMode,
        context: currentContext
      },
      ids: { session_id: current?.sessionId, participant_id: current?.participantId }
    });
    
    console.log("[Menu] handleRestart called. Mode:", currentMode, "Token:", tableToken);

    let terminateOutcome = 'redirect_to_scanner';
    let dualIntentSent = false;

    // If currently in Dual Mode, handle termination intent
    if (currentMode === 'dual-phone') {
       // We save local credentials in dual storage just in case we are the "First" one leaving
       // and want to resume later if the partner didn't leave (and session wasn't terminated).
       
       // Send HTTP request for reliability (Wait for it)
       if (current.sessionId && current.participantId) {
           console.log("[Menu] Sending Fresh Intent via API");
           // We use fire-and-forget style if we want speed, but for "instantly" ensuring DB update:
           // We should await.
           try {
               const res = await api.post(`/sessions/${current.sessionId}/fresh_intent`, { participant_id: current.participantId });
               console.log("[Menu] Sent fresh intent. Keeping device token until session is terminated.");
               dualIntentSent = true;
               terminateOutcome = res.data?.both_pressed === true ? 'session_terminated_mutual' : 'waiting_for_partner_confirm';
           } catch (e) {
               console.error("Failed to send fresh intent API", e);
               terminateOutcome = 'fresh_intent_api_error';
           }
       }
       
       // Also emit socket for realtime UI update (if connected). Use emit-with-ACK
       // so Firefox does NOT silently drop this packet when page unloads 100ms later.
       if (socketRef?.current?.connected && current?.sessionId && current?.participantId) {
           console.log("[Menu] Sending Fresh Intent via Socket (with ACK)");
           try {
             await new Promise((resolve) => {
               const done = () => resolve();
               const fallback = setTimeout(done, 350);
               try {
                 socketRef.current.emit('fresh_intent', {
                   session_id: current.sessionId,
                   participant_id: current.participantId
                 }, () => { clearTimeout(fallback); done(); });
               } catch (e) { clearTimeout(fallback); done(); }
             });
           } catch (e) {
             console.warn('[Menu] fresh_intent socket emit fallback (non-fatal):', e);
           }
       }
    } else {
      // Single mode: session is permanently terminated
      terminateOutcome = 'single_session_terminated';
    }

    setLastResetAt();
    
    // In Dual Mode, we keep the participantToken so the backend can recognize the user
    // and enforce the "no new table while active" rule.
    // In Single Mode, we permanently terminate the session.
    if (currentMode !== 'dual-phone') {
        if (current.sessionId) {
            try {
                await api.delete(`/sessions/${current.sessionId}`);
                console.log("[Menu] Single Mode session permanently terminated.");
            } catch (e) {
                console.error("Failed to terminate single mode session", e);
                if (terminateOutcome === 'single_session_terminated') terminateOutcome = 'single_terminate_api_error';
            }
        }
        clearStoredParticipant();
        clearDualSession(tableToken);
    }

    // Outcome event
    fireSession({
      event_type: 'menu_start_fresh_outcome',
      event_data: {
        outcome: terminateOutcome,
        redirect_url: SCANNER_ROUTE,
        dual_intent_sent: dualIntentSent,
        mode: currentMode
      },
      ids: { session_id: current?.sessionId, participant_id: current?.participantId }
    });

    fireSession({
      event_type: 'start_fresh',
      event_data: {
        outcome: terminateOutcome,
        redirect_url: SCANNER_ROUTE,
        mode: currentMode,
        table_token: tableToken
      },
      ids: { session_id: current?.sessionId, participant_id: current?.participantId }
    });
    
    // Redirect to scanner with: (a) socket.disconnect(false) flushes pending
    // buffered writes BEFORE closing transport (Firefox drops them with default
    // disconnect(true)), (b) window.location.replace so no stale back-button
    // history with old dual-session state, (c) wrapped in setTimeout to let
    // React setState (setLastResetAt) commit before unload.
    setTimeout(() => {
        if (socketRef?.current) {
            try { socketRef.current.disconnect(false); } catch (e) { console.warn(e); }
        }
        try { window.location.replace(SCANNER_ROUTE); } catch (e) { window.location.href = SCANNER_ROUTE; }
    }, 30);
  };

  const handleUpgradeToDual = async () => {
    if (!tableToken) return;
    setLoading(true);
    
    const current = getStoredParticipant();
    fireSession({
      event_type: 'menu_reset_mode_requested',
      event_data: {
        from_mode: currentMode,
        to_mode: 'dual-phone',
        via: 'upgrade_endpoint',
        table_token: tableToken
      },
      ids: { session_id: current?.sessionId, participant_id: current?.participantId }
    });
    
    if (current.sessionId && current.participantId) {
        try {
            const res = await api.post(`/sessions/${current.sessionId}/upgrade`, { participant_id: current.participantId });
            console.log("[Menu] Upgraded to Dual Mode response:", res.data);
            
            // Ensure dual session backup is saved
            storeDualSession(tableToken, current.sessionId, current.participantId, current.participantToken);
            
            closeMenu();
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

    const _newContext = updates.context || currentContext;
    const _newMode = updates.mode || currentMode;

    // Simplified flow rule #1: only allow Dual → Single switch when the partner has
    // already opted Start Fresh (they are out of the session). Otherwise show a
    // simple non-blocking inline feedback instead of proceeding into the broken path.
    if (currentMode === 'dual-phone' && _newMode === 'single-phone' && !canSwitchToSingleMode) {
      const stored = getStoredParticipant();
      fireSession({
        event_type: 'menu_mode_blocked',
        event_data: {
          reason: 'partner_not_start_fresh',
          from_mode: currentMode,
          to_mode: _newMode,
          table_token: tableToken
        },
        ids: {
          session_id: stored?.sessionId || null,
          participant_id: stored?.participantId || null
        }
      });
      showFeedback('Partner still connected. Press Start Fresh first, then switch to Single Mode.');
      return;
    }

    // During the 20s Start Fresh countdown window, the modal Switch to Single
    // button takes priority (passes onSwitchToSingle callback from SessionGame
    // countdown) so it reuses handleQuickSwitch with the correct ordering already
    // fixed earlier (notify / clear / disconnect old socket → create session).
    if (onSwitchToSingle && currentMode === 'dual-phone' && _newMode === 'single-phone') {
      try {
        setLoading(true);
        closeMenu();
        await onSwitchToSingle(_newContext);
        return;
      } catch (err) {
        console.error('Switch to single failed:', err);
        setLoading(false);
        showFeedback('Failed to switch to Single Mode. Please try again.');
        return;
      }
    }

    
    const current = getStoredParticipant();
    const newContext = updates.context || currentContext;
    const newMode = updates.mode || currentMode;
    
    // Fire reset events BEFORE any side effects
    if (updates.context && updates.context !== currentContext) {
      fireSession({
        event_type: 'menu_reset_context_requested',
        event_data: {
          from_context: currentContext,
          to_context: updates.context,
          mode: currentMode,
          table_token: tableToken,
          via: 'menu_card'
        },
        ids: { session_id: current?.sessionId, participant_id: current?.participantId }
      });
    }
    if (updates.mode && updates.mode !== currentMode) {
      fireSession({
        event_type: 'menu_reset_mode_requested',
        event_data: {
          from_mode: currentMode,
          to_mode: updates.mode,
          context: currentContext,
          table_token: tableToken,
          via: 'menu_card'
        },
        ids: { session_id: current?.sessionId, participant_id: current?.participantId }
      });
    }
    
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
    closeMenu();

    try {
      // 2. Dual Mode Context Switch (Mutation via Socket)
      if (currentMode === 'dual-phone' && newMode === 'dual-phone' && newContext !== currentContext) {
          if (socketRef?.current?.connected) {
             console.log("[Menu] Sending Context Switch Intent:", newContext);
             
             fireSession({
               event_type: 'context_changed',
               event_data: {
                 from_context: currentContext,
                 to_context: newContext,
                 via: 'dual_socket_context_switch_intent',
                 table_token: tableToken,
                 mode: currentMode
               },
               ids: { session_id: current?.sessionId, participant_id: current?.participantId }
             });
             
             // Emit intent with ACK so Firefox never drops this packet mid-unload.
             try {
               await new Promise((resolve) => {
                 const done = () => resolve();
                 const fallback = setTimeout(done, 400);
                 try {
                   socketRef.current.emit('context_switch_intent', { context: newContext }, () => { clearTimeout(fallback); done(); });
                 } catch (e) { clearTimeout(fallback); done(); }
               });
             } catch (e) { console.warn('[Menu] context_switch_intent emit fallback (non-fatal):', e); }
             
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
                  fireSession({
                    event_type: 'context_changed',
                    event_data: {
                      from_context: currentContext,
                      to_context: newContext,
                      via: 'dual_api_patch_fallback',
                      table_token: tableToken,
                      mode: currentMode
                    },
                    ids: { session_id: current.sessionId, participant_id: current.participantId }
                  });
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
         if (newMode === 'single-phone') {
             // Gracefully leave the ongoing dual session BEFORE asking for a new single
             // session. If we don't do this in this exact order:
             //   1) createSession below POSTs to /api/sessions with the OLD participant token
             //      still in storage → resolveSession sees an active (non-disconnected) role
             //      row for this device in the dual session → returns action:'resume' →
             //      destructuring `{ data }` receives no session object → catch fires the
             //      "Failed to start new session" alert (exactly the bug in the screenshot).
             //   2) Backend's active-slot count still includes this device as an "active"
             //      participant in the dual session until socket disconnect + timeout.
             // Sequence (all before createSession POST):
             //   a) emit partner_switched_mode + 100ms settle (UI on partner shows Waiting)
             //   b) clearStoredParticipant() — drop the OLD participant token so the next
             //      /api/sessions POST creates a brand-new single-participant session.
             //   c) socketRef.current.disconnect() — triggers backend socket.on('disconnect')
             //      which does UPDATE session_participants SET disconnected_at = NOW() for
             //      the OLD role row, so DB active-count correctly drops to 1 partner.
             // We KEEP the storeDualSession() backup we just wrote so Menu→Dual later can
             // resume this same ongoing dual session (per rules: switching to single does
             // NOT destroy the ongoing dual session — not until mutual Start Fresh).
             if (socketRef?.current?.connected) {
                 console.log('[Menu] Notifying partner of mode switch to single-phone');
                 try {
                   await new Promise((resolve) => {
                     const done = () => resolve();
                     const fallback = setTimeout(done, 400);
                     try {
                       socketRef.current.emit('partner_switched_mode', { newMode }, () => { clearTimeout(fallback); done(); });
                     } catch (e) { clearTimeout(fallback); done(); }
                   });
                 } catch (e) { console.warn('[Menu] partner_switched_mode emit fallback (non-fatal):', e); }
             }
             clearStoredParticipant();
             if (socketRef?.current) {
                 try { socketRef.current.disconnect(false); } catch (e) { console.warn(e); }
             }
         }
      }

      // 4. Standard Session Creation (New Session)
      // For switching modes or starting fresh context in Single Mode
      const restaurantSlug = getRestaurantSlug();
      const { data } = await createSession({
        table_token: tableToken,
        context: newContext,
        mode: newMode,
        restaurant_slug: restaurantSlug || undefined
      });

      if (updates.context && updates.context !== currentContext) {
        fireSession({
          event_type: 'context_changed',
          event_data: {
            from_context: currentContext,
            to_context: newContext,
            via: 'menu_new_session_creation',
            table_token: tableToken,
            from_mode: currentMode,
            to_mode: newMode
          },
          ids: { session_id: current?.sessionId, participant_id: current?.participantId }
        });
      }
      if (updates.mode && updates.mode !== currentMode) {
        fireSession({
          event_type: 'mode_changed',
          event_data: {
            from_mode: currentMode,
            to_mode: newMode,
            via: 'menu_new_session_creation',
            table_token: tableToken,
            context: newContext
          },
          ids: { session_id: current?.sessionId, participant_id: current?.participantId }
        });
      }

      // Notify partner to follow (if migrating from Single to Dual or similar)
      if (socketRef?.current?.connected && newMode === 'dual-phone') {
        console.log('[Menu] Migrating partner to', data.session_id);
        socketRef.current.emit('migrate_session', { newSessionId: data.session_id });
        await new Promise(r => setTimeout(r, 100));
      }

      storeParticipant(data.participant_id, data.session_id, data.participant_token);
      if (socketRef?.current) {
        try { socketRef.current.disconnect(false); } catch (e) { console.warn(e); }
      }
      
      setTimeout(() => {
        try { window.location.replace(`/session/${data.session_id}/game`); }
        catch (e) { window.location.href = `/session/${data.session_id}/game`; }
      }, 10);
    } catch (err) {
      console.error("Failed to switch session:", err);
      setLoading(false);
      showFeedback("Failed to start new session. Please try again.");
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
        onClick={openMenu}
      >
        <div className="w-11 h-11 rounded-full border border-[#DCD3C2] flex items-center justify-center text-[#6E6A60] hover:text-[#35332E] hover:border-[#35332E] transition-colors min-w-[44px] min-h-[44px]">
          <span className="text-lg font-bold leading-none">☰</span>
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
                onClick={closeMenu}
                className="absolute inset-0 bg-[#35332E]/55 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="relative bg-[#F3EDE1] w-full max-w-sm rounded-3xl overflow-hidden flex flex-col border border-[#DCD3C2]"
              >
                 {/* Header */}
                 <div className="px-6 pt-6 pb-4 flex items-start justify-between bg-[#F3EDE1] relative z-10 gap-4">
                   <h3 className="text-2xl font-semibold text-[#35332E] pt-2 leading-none">Session Settings</h3>
                   <button
                     onClick={closeMenu}
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

                     {/* Transient non-blocking feedback banner (replaces native alert, which blocks
                         Firefox's main thread → countdown timer freezes and redirect never fires
                         until user dismisses alert). */}
                     {localFeedback && (
                       <div className="mb-2 px-4 py-3 rounded-2xl bg-[#FBF7EF] border border-[#DCD3C2] shadow-[inset_0_2px_6px_rgba(53,51,46,0.06)]">
                         <p className="text-sm font-medium text-[#35332E] leading-snug">{localFeedback}</p>
                       </div>
                     )}
                     {feedbackMessage && !localFeedback && (
                       <div className="mb-2 px-4 py-3 rounded-2xl bg-[#FBF7EF] border border-[#DCD3C2] shadow-[inset_0_2px_6px_rgba(53,51,46,0.06)]">
                         <p className="text-sm font-medium text-[#35332E] leading-snug">{feedbackMessage}</p>
                       </div>
                     )}

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
                                   ? 'bg-[#35332E] text-[#F3EDE1] border-0'
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
                           const disabledSingle = m.id === 'single-phone' && !canSwitchToSingleMode;
                           const disabled = m.id === 'single-phone' && disabledSingle;
                           return (
                             <button
                               key={m.id}
                               onClick={() => {
                                 if (disabled) return;
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
                               disabled={disabled}
                               className={`px-4 py-3 rounded-2xl text-sm font-semibold transition-all ${
                                 disabled
                                   ? 'bg-[#F3EDE1] text-[#A8A297] border border-[#DCD3C2] opacity-70 cursor-not-allowed'
                                   : isActive
                                     ? 'bg-[#35332E] text-[#F3EDE1] border-0'
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
                         onClick={closeMenu}
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
