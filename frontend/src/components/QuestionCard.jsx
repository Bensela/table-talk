import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Button from './ui/Button';

export default function QuestionCard({ 
  question, 
  onReveal, 
  isRevealed, 
  onNext, 
  waitingForPartner, 
  mode,
  socket,
  sessionId,
  userId,
  partnerSelectionsData = {},
  partnerIsReady = false,
  feedbackMessage = null,
  conversationStarted = false,
  onAdvanceTurn
}) {
  if (!question) {
    return (
        <div className="flex-1 flex flex-col justify-center w-full max-w-md mx-auto text-center p-8">
            <h2 className="text-xl text-gray-400 font-medium">Loading question...</h2>
        </div>
    );
  }

  const [localRevealed, setLocalRevealed] = useState(isRevealed);
  
  // Dual Mode State (New Flow)
  const [localNextIntent, setLocalNextIntent] = useState(false);
  const [fadeApplied, setFadeApplied] = useState(false);
  
  // Legacy states (kept for compatibility if needed, but mostly unused now)
  const [conversationState, setConversationState] = useState(false); // Can map to fadeApplied

  // Multiple Choice State
  const [selectedOption, setSelectedOption] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [partnerSelections, setPartnerSelections] = useState(partnerSelectionsData);
  const [showReadyButton, setShowReadyButton] = useState(false);

  // Sync prop changes (if parent gets data first/later)
  useEffect(() => {
    if (partnerSelectionsData && Object.keys(partnerSelectionsData).length > 0) {
      setPartnerSelections(partnerSelectionsData);
    }
  }, [partnerSelectionsData]);

  // Memoize partner selection logic to prevent re-render loops and unnecessary recalculations
  const partnerPickedText = useMemo(() => {
    if (!localRevealed || !partnerSelections) return '...';

    // Logic to find partner's selection
    const myIdStr = String(userId);
    const mySelectionStr = String(selectedOption);

    // 1. Try strict ID match (Best)
    // IMPORTANT: The backend sanitizes undefined to null, so the value might be null if not found.
    const partnerEntry = Object.entries(partnerSelections).find(([uid]) => String(uid) !== myIdStr);
    
    let pAuthId = null;
    
    if (partnerEntry) {
        // partnerEntry[1] is the value (option ID)
        pAuthId = partnerEntry[1];
    } else {
        // 2. Fallback: Value Inference (If IDs are messed up)
        const allSelectedIds = Object.values(partnerSelections);
        
        // If we have distinct values, find the one that isn't mine
        // Ensure we filter out nulls first
        const validIds = allSelectedIds.filter(v => v !== null);
        
        // Find a value that is NOT my selection
        const otherValue = validIds.find(val => String(val) !== mySelectionStr);
        
        if (otherValue) {
            pAuthId = otherValue;
        } else if (validIds.length >= 2) {
            // If all valid values are the same (and we have at least 2), then partner picked the same
            pAuthId = selectedOption;
        }
    }

    // 4. Find text
    // Fallback to "..." if text not found, but if we have a valid ID but no text, show "Unknown"
    // This helps distinguish between "No ID found" vs "ID found but no text match"
    const text = question.options?.options?.find(o => String(o.id) === String(pAuthId))?.text;
    
    // Final fallback: if pAuthId exists but no text match, show ID for debugging? 
    // Or better: check if pAuthId is null
    if (!pAuthId) return '...';
    
    return text || '...';
  }, [localRevealed, partnerSelections, userId, selectedOption, question?.options]);

  useEffect(() => {
    setLocalRevealed(isRevealed);
  }, [isRevealed, question?.question_id]);

  // Delay "I'm Ready" button for Multiple Choice to allow viewing results
  useEffect(() => {
    if (question?.question_type === 'multiple-choice' && localRevealed) {
      setShowReadyButton(false);
      const timer = setTimeout(() => {
        setShowReadyButton(true);
      }, 3000); // 3 second delay
      return () => clearTimeout(timer);
    } else {
      // Immediate for open-ended or unrevealed
      setShowReadyButton(true);
    }
  }, [localRevealed, question?.question_type]);

  const [waitingForAdvance, setWaitingForAdvance] = useState(false);

  // Reset state on new question
  useEffect(() => {
    setLocalNextIntent(false);
    // setFadeApplied(false); // Controlled by conversationStarted prop now? 
    // Wait, if conversationStarted is passed from parent, we should use that.
    
    setSelectedOption(null);
    setSubmitted(false);
    setPartnerSelections({});
    setLocalRevealed(false);
    setShowReadyButton(false);
    setWaitingForAdvance(false);
  }, [question?.question_id]);

  // Sync fade state with parent
  useEffect(() => {
      setFadeApplied(conversationStarted);
  }, [conversationStarted]);


  // Socket Listeners
  useEffect(() => {
    if (!socket || mode !== 'dual-phone') return;

    // We can still listen for partner status updates if needed, but the main driver is local intent + server advance
    // The "remote_intent" event is optional per prompt, so we skip it for now unless server emits it.

    const onRevealAnswers = ({ selections }) => {
      setPartnerSelections(selections);
      setLocalRevealed(true);
    };

    socket.on('reveal_answers', onRevealAnswers);

    return () => {
      socket.off('reveal_answers', onRevealAnswers);
    };
  }, [socket, mode, userId]);

  const handleReveal = () => {
    if (!localRevealed) {
      setLocalRevealed(true);
      onReveal();
    }
  };

  const isDualMode = mode === 'dual-phone' || mode === 'dual';

  const handleSubmitAnswer = () => {
    if (selectedOption) {
      setSubmitted(true);
      // Emit selectionId as-is (assuming it is defined/truthy)
      console.log("Submitting answer:", selectedOption);
      socket.emit('answer_submitted', { 
        sessionId, 
        user_id: userId, 
        question_id: question.question_id, 
        selectionId: selectedOption 
      });
    }
  };

  const handleNextIntent = () => {
    // 1. Set local state immediately
    setLocalNextIntent(true);
    // setFadeApplied(true); // REMOVED: Wait for server confirmation (conversationStarted)
    // setConversationState(true); 

    // 2. Emit Intent
    onNext(); 
  };

  const isMultipleChoice = question.question_type === 'multiple-choice';

  const cleanQuestionText = (text) => {
    if (!text) return '';
    // Remove (40) or [12] at the end, handling optional spaces
    return text.replace(/\s*[\(\[]\d+[\)\]]\s*$/, '');
  };

  return (
    <div className="flex-1 flex flex-col justify-center w-full max-w-md mx-auto">
      {/* Main Card */}
      <motion.div
        key={question.question_id}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.4 }}
        onClick={(!isMultipleChoice) ? handleReveal : undefined}
        className={`
          bg-white rounded-[2rem] p-8 shadow-2xl shadow-blue-500/10 border border-gray-100 
          relative overflow-hidden flex flex-col justify-center min-h-[400px]
          ${!isMultipleChoice && !localRevealed ? 'cursor-pointer hover:scale-[1.01] transition-transform active:scale-[0.99]' : ''}
        `}
      >
        {/* Topic Badge */}
        <div className="absolute top-8 left-0 w-full flex justify-center">
          <span className="px-3 py-1 rounded-full bg-gray-50 text-xs font-bold uppercase tracking-widest text-gray-400">
            {question.category || question.context || 'Topic'}
          </span>
        </div>

        {/* Question Text */}
        <div className={`my-8 text-center relative z-10 ${fadeApplied ? 'pointer-events-none' : ''}`}>
            <h2 className={`text-3xl font-extrabold leading-tight transition-all duration-1000 ${
              fadeApplied ? 'text-gray-900/20 blur-[2px]' : 'text-gray-900'
            }`}>
              {cleanQuestionText(question.question_text)}
            </h2>
            {fadeApplied && (
               <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-gray-500 font-medium mb-2">Conversation in progress...</p>
               </div>
            )}
          </div>

        {/* CONTENT AREA (Hint or Options) */}
        <div className="relative z-10">
          
          {/* OPEN ENDED */}
          {!isMultipleChoice && (
            <AnimatePresence>
              {localRevealed && question.answer_text && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="pt-6 border-t border-gray-100 text-center">
                    <p className="text-blue-600 font-medium italic text-lg">
                      {question.answer_text}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}

          {/* MULTIPLE CHOICE */}
          {isMultipleChoice && question.options && (
            <div className="space-y-3 mt-4">
              {question.options.options.map((opt) => {
                const isSelected = selectedOption === opt.id;
                // Check if partner selected this
                const partnerSelectedId = Object.entries(partnerSelections).find(([uid]) => String(uid) !== String(userId))?.[1];
                const isPartnerSelected = localRevealed && partnerSelectedId === opt.id;
                
                // Determine style based on state
                let optionStyle = 'border-gray-200 hover:border-gray-300 text-gray-900 bg-white';
                if (isSelected && isPartnerSelected) {
                    // Both picked same
                    optionStyle = 'border-purple-500 bg-purple-50 text-purple-900 ring-2 ring-purple-400 ring-offset-2 shadow-md';
                } else if (isSelected) {
                    // You picked
                    optionStyle = 'border-blue-500 bg-blue-50 text-blue-900 shadow-sm';
                } else if (isPartnerSelected) {
                    // Partner picked
                    optionStyle = 'border-green-500 bg-green-50 text-green-900 ring-2 ring-green-400 ring-offset-2 shadow-md';
                }

                return (
                  <button
                    key={opt.id}
                    onClick={() => !submitted && setSelectedOption(opt.id)}
                    disabled={submitted || localRevealed}
                    className={`
                      w-full px-5 py-4 rounded-2xl border-2 text-left transition-all flex justify-between items-center group
                      ${optionStyle}
                    `}
                  >
                    <span className="font-semibold text-lg">{opt.text}</span>
                    <div className="flex gap-2 text-xs uppercase font-bold tracking-wider">
                      {isSelected && <span className={isPartnerSelected ? "text-purple-600" : "text-blue-600"}>You</span>}
                      {isPartnerSelected && <span className={isSelected ? "text-purple-600" : "text-green-600"}>Partner</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Hint Indicator / Reveal Button */}
        {!isMultipleChoice && !localRevealed && (
          <div className="absolute bottom-6 left-0 w-full text-center pointer-events-none">
             {/* If explicit button desired, we can uncomment this or replace the text below */}
             {/* <button className="pointer-events-auto text-sm text-blue-500 font-bold underline">Reveal Hint</button> */}
             
            <span className="text-xs text-gray-300 font-bold uppercase tracking-wide animate-pulse">
              Tap card to reveal hint
            </span>
          </div>
        )}
      </motion.div>

        {/* ACTION BAR (Bottom) */}
        <div className="mt-8 space-y-4">
          
          {/* DUAL MODE: Ready Button Only (Replaces Next) */}
          {mode === 'dual-phone' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <div className="space-y-3">
                 {/* For Multiple Choice: Show "Lock In Answer" unless revealed */}
                 {isMultipleChoice && !localRevealed ? (
                   <div className="space-y-3">
                    {submitted ? (
                      <div className="p-4 bg-gray-50 rounded-xl text-center text-gray-500 font-medium border border-gray-100">
                        Answer Submitted. Waiting for partner...
                      </div>
                    ) : (
                      <Button
                        onClick={handleSubmitAnswer}
                        disabled={!selectedOption}
                        variant="primary"
                        size="lg"
                        fullWidth
                      >
                        Lock In Answer
                      </Button>
                    )}
                  </div>
                 ) : (
                   /* For Open Ended OR Revealed Multiple Choice: Show "I'm Ready" */
                   <>
                    {/* Delay showing Ready button for Multiple Choice */}
                    {isMultipleChoice && localRevealed && !showReadyButton ? (
                        <div className="p-4 text-center">
                            <p className="text-gray-500 font-medium animate-pulse">Viewing Results...</p>
                        </div>
                    ) : (
                      <>
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (conversationStarted) {
                                // Phase 2: Manual Advance
                                setWaitingForAdvance(true);
                                onAdvanceTurn();
                            } else if (localNextIntent) {
                                // Idempotent: Waiting for partner
                            } else {
                                // Phase 1: Mark Ready
                                handleNextIntent();
                            }
                          }}
                          variant="black"
                          size="lg"
                          fullWidth
                          className={`shadow-xl hover:shadow-2xl transition-all ${
                              (localNextIntent && !conversationStarted) || waitingForAdvance ? "bg-gray-800 border-gray-800 opacity-80 cursor-wait" : ""
                          }`}
                          disabled={(localNextIntent && !conversationStarted) || waitingForAdvance}
                          icon={
                            (conversationStarted && !waitingForAdvance)
                               ? <span>→</span>
                               : ((localNextIntent) || waitingForAdvance)
                                   ? <span className="animate-spin">⌛</span> 
                                   : <span>✓</span>
                          }
                        >
                          {conversationStarted
                               ? (waitingForAdvance ? "Waiting for Partner..." : "Next Question")
                               : (localNextIntent
                                   ? "Waiting for Partner..." 
                                   : "I'm Ready")
                          }
                        </Button>
                        
                        {/* Partner Ready Indicator */}
                        {partnerIsReady && !localNextIntent && (
                           <div className="text-center animate-pulse pt-2">
                              <p className="text-sm font-bold text-blue-600">
                                👋 Partner is ready!
                              </p>
                              <p className="text-xs text-blue-400">
                                Click "I'm Ready" to continue.
                              </p>
                           </div>
                        )}

                        {/* Feedback Message (e.g. Request Declined) */}
                        {feedbackMessage && (
                           <div className="text-center pt-4">
                              <motion.div 
                                initial={{ opacity: 0, y: 5 }} 
                                animate={{ opacity: 1, y: 0 }}
                                className="inline-block px-4 py-2 bg-blue-50 text-blue-600 text-sm font-bold rounded-full border border-blue-100 shadow-sm"
                              >
                                {feedbackMessage}
                              </motion.div>
                           </div>
                        )}
                      </>
                    )}
                   </>
                 )}
              </div>
            </motion.div>
          )}

          {/* SINGLE MODE: Standard Next Button */}
          {mode !== 'dual-phone' && (
            <AnimatePresence>
              <motion.div 
                initial={{ opacity: 0, y: 10 }} 
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNext();
                  }}
                  disabled={waitingForPartner}
                  variant="black"
                  size="lg"
                  fullWidth
                  className="shadow-xl hover:shadow-2xl"
                  icon={<span>→</span>}
                >
                  Next Question
                </Button>
              </motion.div>
            </AnimatePresence>
          )}
      </div>
    </div>
  );
}
