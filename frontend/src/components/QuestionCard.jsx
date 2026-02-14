import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Button from './ui/Button';

export default function QuestionCard({ 
  question, 
  onReveal, 
  isRevealed, 
  onNext, 
  onPrev,
  waitingForPartner, 
  mode,
  socket,
  sessionId,
  userId
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
  const [partnerSelections, setPartnerSelections] = useState({});

  useEffect(() => {
    setLocalRevealed(isRevealed);
  }, [isRevealed, question.question_id]);

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
    socket.on('both_ready', onBothReady);
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
                const partnerSelectedId = Object.entries(partnerSelections).find(([uid]) => uid !== userId)?.[1];
                const isPartnerSelected = localRevealed && partnerSelectedId === opt.id;

                return (
                  <button
                    key={opt.id}
                    onClick={() => !submitted && setSelectedOption(opt.id)}
                    disabled={submitted || localRevealed}
                    className={`
                      w-full p-4 rounded-xl border-2 text-left transition-all flex justify-between items-center group
                      ${isSelected 
                        ? 'border-blue-500 bg-blue-50 text-blue-900' 
                        : 'border-gray-100 hover:border-gray-200 text-gray-700 bg-white'}
                      ${isPartnerSelected ? 'ring-2 ring-green-400 ring-offset-2' : ''}
                    `}
                  >
                    <span className="font-medium">{opt.text}</span>
                    <div className="flex gap-2">
                      {isSelected && <span className="text-blue-500 font-bold">You</span>}
                      {isPartnerSelected && <span className="text-green-500 font-bold">Partner</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Hint Indicator */}
        {!isMultipleChoice && !localRevealed && (
          <div className="absolute bottom-6 left-0 w-full text-center pointer-events-none">
            <span className="text-xs text-gray-300 font-bold uppercase tracking-wide animate-pulse">
              Tap card to reveal hint
            </span>
          </div>
        )}
      </motion.div>

        {/* ACTION BAR (Bottom) */}
        <div className="mt-8 space-y-4">
          {/* DUAL MODE: Interaction Buttons */}
          {mode === 'dual-phone' && !localRevealed && !conversationState && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            {!isMultipleChoice ? (
              // Open Ended Ready Button
              <div className="space-y-3">
                {!bothReady ? (
                  <>
                    <Button
                      onClick={handleReadyToggle}
                      variant={ready ? "black" : "primary"}
                      size="lg"
                      fullWidth
                      className={ready ? "bg-green-600 border-green-600 hover:bg-green-700" : ""}
                    >
                      {ready ? "Waiting for Partner..." : "I'm Ready"}
                    </Button>
                    {partnerReady && !ready && (
                      <p className="text-center text-sm text-blue-600 font-medium animate-pulse">
                        Partner is ready!
                      </p>
                    )}
                  </>
                ) : (
                  <div className="text-center text-green-600 font-bold text-xl animate-bounce py-3">
                    Both Ready!
                  </div>
                )}
              </div>
            ) : (
              // Multiple Choice Submit
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
            )}
          </motion.div>
        )}

        {/* NEXT BUTTON (Shared) */}
        {/* Show if revealed OR always allow next to match Single Mode behavior */}
        <AnimatePresence>
          <motion.div 
            initial={{ opacity: 0, y: 10 }} 
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex gap-4"
          >
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onPrev();
              }}
              disabled={waitingForPartner}
              variant="secondary"
              size="lg"
              className="shadow-xl hover:shadow-2xl flex-1"
              icon={<span>←</span>}
            >
              Prev
            </Button>
            
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onNext();
              }}
              disabled={waitingForPartner}
              variant={waitingForPartner ? "secondary" : "black"}
              size="lg"
              className="shadow-xl hover:shadow-2xl flex-[2]"
              icon={!waitingForPartner && <span>→</span>}
            >
              {waitingForPartner ? "Syncing..." : (question.index === question.total ? "End Session" : "Next Question")}
            </Button>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
