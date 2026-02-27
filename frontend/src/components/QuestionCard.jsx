import { useState, useEffect } from 'react';
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
  partnerSelectionsData = {}
}) {
  const [localRevealed, setLocalRevealed] = useState(isRevealed);
  
  // Dual Mode State
  const [ready, setReady] = useState(false);
  const [partnerReady, setPartnerReady] = useState(false);
  const [bothReady, setBothReady] = useState(false);
  const [conversationState, setConversationState] = useState(false);
  
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

  useEffect(() => {
    setLocalRevealed(isRevealed);
  }, [isRevealed, question.question_id]);

  // Delay "I'm Ready" button for Multiple Choice to allow viewing results
  useEffect(() => {
    if (question.question_type === 'multiple-choice' && localRevealed) {
      setShowReadyButton(false);
      const timer = setTimeout(() => {
        setShowReadyButton(true);
      }, 3000); // 3 second delay
      return () => clearTimeout(timer);
    } else {
      // Immediate for open-ended or unrevealed
      setShowReadyButton(true);
    }
  }, [localRevealed, question.question_type]);

  // Reset state on new question
  useEffect(() => {
    setReady(false);
    setPartnerReady(false);
    setBothReady(false);
    setConversationState(false);
    setSelectedOption(null);
    setSubmitted(false);
    setPartnerSelections({});
    setLocalRevealed(false);
    setShowReadyButton(false);
  }, [question.question_id]);

  // Socket Listeners
  useEffect(() => {
    if (!socket || mode !== 'dual-phone') return;

    const onReadyStatus = ({ user_id, ready: r }) => {
      if (user_id !== userId) setPartnerReady(r);
    };

    const onBothReady = () => {
      setBothReady(true);
      setTimeout(() => setConversationState(true), 2000); 
    };

    const onRevealAnswers = ({ selections }) => {
      setPartnerSelections(selections);
      setLocalRevealed(true);
    };

    socket.on('ready_status_update', onReadyStatus);
    socket.on('both_ready', () => {
      setBothReady(true);
      setConversationState(true);
    });
    socket.on('reveal_answers', onRevealAnswers);

    return () => {
      socket.off('ready_status_update', onReadyStatus);
      socket.off('both_ready', onBothReady);
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

  const handleReadyToggle = () => {
    const newReady = !ready;
    setReady(newReady);
    socket.emit('ready_toggled', { sessionId, user_id: userId, ready: newReady });
  };

  const handleSubmitAnswer = () => {
    if (selectedOption) {
      setSubmitted(true);
      socket.emit('answer_submitted', { 
        sessionId, 
        user_id: userId, 
        question_id: question.question_id, 
        option_id: selectedOption 
      });
    }
  };

  const isMultipleChoice = question.question_type === 'multiple-choice';

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
        <div className="my-8 text-center relative z-10">
          <h2 className={`text-3xl font-extrabold leading-tight transition-all duration-500 ${
            conversationState ? 'text-gray-400 opacity-50' : 'text-gray-900'
          }`}>
            {question.question_text}
          </h2>
          {conversationState && (
             <p className="mt-4 text-sm text-gray-500 font-medium animate-fade-in">
               Conversation in progress...
             </p>
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
                let optionStyle = 'border-gray-100 hover:border-gray-200 text-gray-700 bg-white';
                if (isSelected && isPartnerSelected) {
                    // Both picked same
                    optionStyle = 'border-purple-500 bg-purple-50 text-purple-900 ring-2 ring-purple-400 ring-offset-2';
                } else if (isSelected) {
                    // You picked
                    optionStyle = 'border-blue-500 bg-blue-50 text-blue-900';
                } else if (isPartnerSelected) {
                    // Partner picked
                    optionStyle = 'border-green-500 bg-green-50 text-green-900 ring-2 ring-green-400 ring-offset-2';
                }

                return (
                  <button
                    key={opt.id}
                    onClick={() => !submitted && setSelectedOption(opt.id)}
                    disabled={submitted || localRevealed}
                    className={`
                      w-full p-4 rounded-xl border-2 text-left transition-all flex justify-between items-center group
                      ${optionStyle}
                    `}
                  >
                    <span className="font-medium">{opt.text}</span>
                    <div className="flex gap-2 text-xs uppercase font-bold tracking-wider">
                      {isSelected && <span className={isPartnerSelected ? "text-purple-600" : "text-blue-500"}>You</span>}
                      {isPartnerSelected && <span className={isSelected ? "text-purple-600" : "text-green-500"}>Partner</span>}
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
          
          {/* Explicit Reveal Button for Dual Mode (Optional, if tap is not enough) */}
          {mode === 'dual-phone' && !isMultipleChoice && !localRevealed && (
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <button 
                  onClick={handleReveal}
                  className="w-full py-3 text-sm font-bold text-gray-400 hover:text-gray-600 uppercase tracking-widest transition-colors"
                >
                  Need a Hint?
                </button>
             </motion.div>
          )}

          {/* MULTIPLE CHOICE RESULT SUMMARY */}
          {mode === 'dual-phone' && isMultipleChoice && localRevealed && (
             <motion.div 
               initial={{ opacity: 0, y: 10 }} 
               animate={{ opacity: 1, y: 0 }}
               className="bg-gray-50 rounded-xl p-4 border border-gray-200 shadow-sm"
             >
                <div className="flex justify-between items-start gap-4">
                   <div className="flex-1 text-center">
                      <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-1">You Picked</p>
                      <p className="text-gray-900 font-bold text-sm leading-snug">
                        {question.options?.options?.find(o => o.id === selectedOption)?.text || '-'}
                      </p>
                   </div>
                   
                   <div className="w-px bg-gray-200 self-stretch"></div>

                   <div className="flex-1 text-center">
                      <p className="text-[10px] font-bold text-green-500 uppercase tracking-widest mb-1">Partner Picked</p>
                      <p className="text-gray-900 font-bold text-sm leading-snug">
                        {(() => {
                           // Logic to find partner's selection
                           const myIdStr = String(userId);
                           const mySelectionStr = String(selectedOption);

                           // DEBUG: Log to console
                           console.log('PartnerCalc:', { partnerSelections, myIdStr, mySelectionStr });

                           // 1. Try strict ID match (Best)
                           const partnerEntry = Object.entries(partnerSelections).find(([uid]) => String(uid) !== myIdStr);
                           
                           let pAuthId = null;
                           
                           if (partnerEntry) {
                               pAuthId = partnerEntry[1];
                           } else {
                               // 2. Fallback: Value Inference (If IDs are messed up)
                               const allSelectedIds = Object.values(partnerSelections);
                               
                               // If we have distinct values, find the one that isn't mine
                               const otherValue = allSelectedIds.find(val => String(val) !== mySelectionStr);
                               
                               if (otherValue) {
                                   pAuthId = otherValue;
                               } else if (allSelectedIds.length >= 2) {
                                   // If all values are the same (and we have at least 2), then partner picked the same
                                   pAuthId = selectedOption;
                               }
                           }

                           // 4. Find text
                           return question.options?.options?.find(o => String(o.id) === String(pAuthId))?.text || '...';
                        })()}
                      </p>
                      {/* Debug Info (Hidden in prod, visible for now if needed) */}
                      {/* <div className="text-[8px] text-gray-300 mt-1">{JSON.stringify(partnerSelections)}</div> */}
                   </div>
                </div>
             </motion.div>
          )}

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
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (question.index === question.total) {
                                // End Session Logic
                                onNext();
                            } else {
                                // Toggle Ready -> Triggers Next if both ready
                                handleReadyToggle();
                            }
                          }}
                          variant={ready ? "black" : "black"}
                          size="lg"
                          fullWidth
                          className={`shadow-xl hover:shadow-2xl transition-all ${ready ? "bg-green-600 border-green-600 hover:bg-green-700" : ""}`}
                          icon={question.index !== question.total && (ready ? <span>✓</span> : <span>→</span>)}
                        >
                          {question.index === question.total 
                            ? "End Session" 
                            : (ready ? "Waiting for Partner..." : "I'm Ready")}
                        </Button>
                    )}
                    
                    {partnerReady && !ready && question.index !== question.total && showReadyButton && (
                      <p className="text-center text-sm text-blue-600 font-medium animate-pulse">
                        Partner is ready! Press "I'm Ready" to continue.
                      </p>
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
                  {question.index === question.total ? "End Session" : "Next Question"}
                </Button>
              </motion.div>
            </AnimatePresence>
          )}
      </div>
    </div>
  );
}
