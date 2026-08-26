import { useState, useEffect, useMemo, useRef } from 'react';
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
  onAdvanceTurn,
  nextIntentCount = 0,
  advanceIntentCount = 0
}) {
  if (!question) {
    return (
      <div className="flex-1 flex flex-col justify-center w-full max-w-md mx-auto text-center p-8">
        <h2 className="text-xl text-[#6E6A60] font-medium">Loading question...</h2>
      </div>
    );
  }

  const isDualMode = mode === 'dual-phone' || mode === 'dual';
  const isMultipleChoice = question.question_type === 'multiple-choice';
  const questionHasHint = Boolean(
    !isMultipleChoice &&
    question.answer_text &&
    String(question.answer_text).trim().length > 0
  );

  // ---------- Open-Ended Hint Reveal State + Dual Sync ----------
  const [localRevealed, setLocalRevealed] = useState(isRevealed);
  const syncHintRevealToPartner = useRef(true);

  useEffect(() => {
    setLocalRevealed(isRevealed);
  }, [isRevealed, question?.question_id]);

  useEffect(() => {
    if (!socket || !isDualMode) return;
    const onHintTap = () => {
      syncHintRevealToPartner.current = false;
      setLocalRevealed(true);
      onReveal?.();
      setTimeout(() => { syncHintRevealToPartner.current = true; }, 50);
    };
    socket.on('hint_tap_revealed', onHintTap);
    return () => socket.off('hint_tap_revealed', onHintTap);
  }, [socket, isDualMode, onReveal]);

  useEffect(() => {
    if (!isDualMode) return;
    const onCross = () => {
      syncHintRevealToPartner.current = false;
      setLocalRevealed(true);
      onReveal?.();
      setTimeout(() => { syncHintRevealToPartner.current = true; }, 50);
    };
    window.addEventListener('tt:hint_revealed_sync', onCross);
    return () => window.removeEventListener('tt:hint_revealed_sync', onCross);
  }, [isDualMode, onReveal]);

  const handleHintTap = () => {
    if (localRevealed || isMultipleChoice || !questionHasHint) return;
    setLocalRevealed(true);
    onReveal?.();
    if (isDualMode && syncHintRevealToPartner.current && socket?.connected) {
      socket.emit('hint_tap_reveal', { sessionId, question_id: question.question_id });
    }
  };

  // ---------- Multiple Choice: Selection + Submitted ----------
  const [selectedOption, setSelectedOption] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [partnerSelections, setPartnerSelections] = useState(partnerSelectionsData);
  const normalizedOptions = useMemo(
    () => normalizeQuestionOptions(question?.options),
    [question?.options]
  );

  useEffect(() => {
    if (partnerSelectionsData && Object.keys(partnerSelectionsData).length > 0) {
      setPartnerSelections(partnerSelectionsData);
    }
  }, [partnerSelectionsData]);

  useEffect(() => {
    if (!socket || !isDualMode) return;
    const onRevealAnswers = ({ selections }) => {
      if (selections && Object.keys(selections).length > 0) {
        setPartnerSelections(selections);
      }
      setLocalRevealed(true);
    };
    socket.on('reveal_answers', onRevealAnswers);
    return () => socket.off('reveal_answers', onRevealAnswers);
  }, [socket, isDualMode, userId]);

  const [showReadyButton, setShowReadyButton] = useState(false);
  useEffect(() => {
    setSelectedOption(null);
    setSubmitted(false);
    setPartnerSelections({});
    setLocalRevealed(false);
    setShowReadyButton(false);
  }, [question?.question_id]);

  useEffect(() => {
    if (question?.question_type === 'multiple-choice' && localRevealed && isDualMode) {
      setShowReadyButton(false);
      const timer = setTimeout(() => setShowReadyButton(true), 3000);
      return () => clearTimeout(timer);
    } else {
      setShowReadyButton(true);
    }
  }, [localRevealed, question?.question_type, isDualMode]);

  const handleSubmitAnswer = () => {
    if (!selectedOption) return;
    setSubmitted(true);
    if (socket) {
      socket.emit('answer_submitted', {
        sessionId,
        user_id: userId,
        question_id: question.question_id,
        selectionId: selectedOption
      });
    }
  };

  const handleIAmReady = () => {
    if (onNext) onNext();
  };
  const handleNextQuestion = () => {
    if (isDualMode) {
      if (onAdvanceTurn) onAdvanceTurn();
    } else {
      if (onNext) onNext();
    }
  };

  const cleanQuestionText = (text) => {
    if (!text) return '';
    return text.replace(/\s*[\(\[]\d+[\)\]]\s*$/, '');
  };

  // ---------------- STATE BOOLEANS ----------------
  const state = conversationStarted ? 2 : 1;
  const iClickedReadyFirst = isDualMode && state === 1 && (nextIntentCount >= 1) && !partnerIsReady;
  const partnerClickedReadyFirst = isDualMode && state === 1 && partnerIsReady;
  const partnerAdvancedFirst = isDualMode && state === 2 &&
    (feedbackMessage === "Partner is waiting for you to click Next!" ||
     ((advanceIntentCount >= 1) && partnerIsReady));
  const iAdvancedFirst = isDualMode && state === 2 && (advanceIntentCount >= 1) && !partnerAdvancedFirst;
  const mcqAnswerLocked = isMultipleChoice && submitted && !localRevealed;

  // For MCQ Dual State 1 reveal: get partner selection ID
  const partnerSelectedId = useMemo(() => {
    if (!isDualMode) return null;
    const entry = Object.entries(partnerSelections || {}).find(
      ([uid]) => String(uid) !== String(userId)
    );
    return entry ? String(entry[1] || '') : null;
  }, [partnerSelections, userId, isDualMode]);

  // -------------------------------------------------------------------
  // ----------------------- RENDER -----------------------------------
  // -------------------------------------------------------------------

  return (
    <div className="flex-1 flex flex-col justify-center w-full max-w-md mx-auto">
      {/* ---------- Main Question Card ---------- */}
      <motion.div
        key={question.question_id}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.4 }}
        onClick={!isMultipleChoice ? handleHintTap : undefined}
        className={`
          bg-[#FBF7EF] rounded-[2rem] p-8 border border-[#DCD3C2]
          relative overflow-hidden flex flex-col justify-center min-h-[400px]
          ${!isMultipleChoice && !localRevealed && questionHasHint ? 'cursor-pointer hover:scale-[1.01] transition-transform active:scale-[0.99]' : ''}
        `}
      >
        {/* Question Text — de-emphasized in State 2 via color (no blur) */}
        <div className="my-8 text-center">
          <h2
            className={`text-3xl font-extrabold leading-tight transition-all duration-700 ${
              state === 2 ? 'text-[#6E6A60]' : 'text-[#35332E]'
            }`}
          >
            {cleanQuestionText(question.question_text)}
          </h2>
        </div>

        {/* ------------------- CONTENT AREA ------------------- */}
        <div className="relative z-20">
          {/* OPEN ENDED HINT — S1 uses #35332E, S2 fades with question to #6E6A60 */}
          {!isMultipleChoice && questionHasHint && (
            <AnimatePresence>
              {localRevealed && question.answer_text && (
                <motion.div
                  key={`hint-${question.question_id}`}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="pt-6 border-t border-[#DCD3C2] text-center">
                    <p
                      className={`font-medium italic text-lg transition-colors duration-700 ${
                        state === 2 ? 'text-[#6E6A60]' : 'text-[#35332E]'
                      }`}
                    >
                      {question.answer_text}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}

          {/* MULTIPLE CHOICE OPTIONS */}
          {isMultipleChoice && normalizedOptions.length > 0 && (
            isDualMode ? (
              <DualMCQOptions
                options={normalizedOptions}
                selectedOption={selectedOption}
                partnerSelectedId={partnerSelectedId}
                locked={submitted || localRevealed}
                onSelect={(id) => !submitted && !localRevealed && setSelectedOption(id)}
              />
            ) : (
              <SingleMCQOptions options={normalizedOptions} />
            )
          )}
        </div>

        {/* Hint Tap Indicator for open-ended — only if the question actually has a hint */}
        {!isMultipleChoice && questionHasHint && !localRevealed && (
          <div className="absolute bottom-6 left-0 w-full text-center pointer-events-none">
            <span className="text-xs text-[#6E6A60] font-bold uppercase tracking-wide animate-pulse">
              Tap card to reveal hint
            </span>
          </div>
        )}
      </motion.div>

      {/* ---------- ACTION BAR (Bottom) ---------- */}
      <div className="mt-8 space-y-3">
        {!isDualMode ? (
          <SingleModeActions
            question={question}
            onReveal={handleHintTap}
            isRevealed={localRevealed}
            submitted={submitted}
            showReadyButton={showReadyButton}
            selectedOption={selectedOption}
            handleSubmitAnswer={handleSubmitAnswer}
            handleIAmReady={handleIAmReady}
            handleNextQuestion={handleNextQuestion}
            isMultipleChoice={isMultipleChoice}
            waitingForPartner={waitingForPartner}
          />
        ) : (
          <DualModeActions
            question={question}
            state={state}
            isMultipleChoice={isMultipleChoice}
            submitted={submitted}
            localRevealed={localRevealed}
            showReadyButton={showReadyButton}
            selectedOption={selectedOption}
            iClickedReadyFirst={iClickedReadyFirst && !partnerClickedReadyFirst && nextIntentCount >= 1}
            partnerClickedReadyFirst={partnerClickedReadyFirst}
            iAdvancedFirst={iAdvancedFirst}
            partnerAdvancedFirst={partnerAdvancedFirst || feedbackMessage === 'Partner is waiting for you to click Next!'}
            mcqAnswerLocked={mcqAnswerLocked}
            feedbackMessage={feedbackMessage}
            handleSubmitAnswer={handleSubmitAnswer}
            handleIAmReady={handleIAmReady}
            handleNextQuestion={handleNextQuestion}
          />
        )}
      </div>
    </div>
  );
}

// ----------------- MCQ OPTIONS: DUAL --------------------
function DualMCQOptions({ options, selectedOption, partnerSelectedId, locked, onSelect }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="options-list"
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        transition={{ type: 'spring', bounce: 0.4, duration: 0.6 }}
        className="space-y-3 mt-4 relative z-20"
      >
        {options.map((opt) => {
          const me = String(selectedOption || '') === String(opt.id);
          const partner = partnerSelectedId && String(partnerSelectedId) === String(opt.id);
          const chosen = me || partner;
          const bothSame = me && partner;

          let classes =
            'bg-[#FBF7EF] border border-[#DCD3C2] text-[#35332E]';
          let label = null;
          if (chosen) {
            classes = 'bg-[#35332E] text-[#F3EDE1] border-0';
            if (bothSame) label = 'YOU · PARTNER';
            else if (me) label = 'YOU';
            else if (partner) label = 'PARTNER';
          }

          return (
            <button
              key={opt.id}
              onClick={() => onSelect(opt.id)}
              disabled={locked}
              className={`w-full px-5 py-4 rounded-2xl text-left transition-all flex justify-between items-center group ${classes} ${!locked ? 'hover:scale-[1.01] active:scale-[0.995]' : ''}`}
            >
              <span className="font-semibold text-lg">{opt.text}</span>
              {label && (
                <span className={`text-[11px] font-bold uppercase tracking-widest ${
                  chosen ? 'text-[#F3EDE1]' : 'text-[#6E6A60]'
                }`}>
                  {label}
                </span>
              )}
            </button>
          );
        })}
      </motion.div>
    </AnimatePresence>
  );
}

// ----------------- MCQ OPTIONS: SINGLE (READ-ONLY) --------------------
function SingleMCQOptions({ options }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="options-list"
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        transition={{ type: 'spring', bounce: 0.4, duration: 0.6 }}
        className="space-y-3 mt-4 relative z-20"
      >
        {options.map((opt) => (
          <div
            key={opt.id}
            className="w-full px-5 py-4 rounded-2xl bg-[#FBF7EF] border border-[#DCD3C2] text-[#35332E]"
          >
            <span className="font-semibold text-lg">{opt.text}</span>
          </div>
        ))}
      </motion.div>
    </AnimatePresence>
  );
}

// ----------------- SINGLE MODE ACTIONS --------------------
function SingleModeActions(props) {
  const {
    isMultipleChoice,
    handleNextQuestion
  } = props;

  return (
    <Button
      onClick={handleNextQuestion}
      variant="ink"
      size="lg"
      fullWidth
    >
      Next Question
    </Button>
  );
}

// ----------------- DUAL MODE ACTIONS --------------------
function DualModeActions(props) {
  const {
    state,
    isMultipleChoice,
    submitted,
    localRevealed,
    showReadyButton,
    selectedOption,
    iClickedReadyFirst,
    partnerClickedReadyFirst,
    iAdvancedFirst,
    partnerAdvancedFirst,
    mcqAnswerLocked,
    handleSubmitAnswer,
    handleIAmReady,
    handleNextQuestion
  } = props;

  // --------------------------
  // MCQ STATE 0 PRE: answer not locked
  // Button does NOT exist until an option is selected (not rendered, not disabled).
  // After Lock In: replaced by plain text "Waiting for your partner" in #6E6A60.
  // --------------------------
  if (isMultipleChoice && !localRevealed) {
    if (!submitted) {
      if (!selectedOption) {
        // No button rendered at all per spec
        return null;
      }
      return (
        <div className="space-y-3">
          <Button
            onClick={handleSubmitAnswer}
            variant="ink"
            size="lg"
            fullWidth
          >
            Lock In Answer
          </Button>
        </div>
      );
    }
    // Submitted but not yet revealed → plain text only: Waiting for your partner, #6E6A60
    return (
      <div className="space-y-3 text-center">
        <div className="text-[#6E6A60] font-medium py-2">
          Waiting for your partner
        </div>
        {showReadyButton === false ? null : null}
      </div>
    );
  }

  // ---- STATE 1: Question Revealed + Waiting, button = "I'm Ready" ----
  if (state === 1) {
    const buttonLabel =
      iClickedReadyFirst
        ? 'Waiting for Partner…'
        : "I'm Ready";
    const buttonDisabled = iClickedReadyFirst && !partnerClickedReadyFirst;
    const usePlainVariant = buttonDisabled;

    return (
      <div className="space-y-3">
        {!buttonDisabled && (
          <Button
            onClick={handleIAmReady}
            variant="ink"
            size="lg"
            fullWidth
          >
            {buttonLabel}
          </Button>
        )}
        {buttonDisabled && (
          <div className="text-center py-2 text-[#6E6A60] font-medium">
            {buttonLabel}
          </div>
        )}
        {/* (A) partner clicked ready first → plain text under, no pill */}
        {partnerClickedReadyFirst && !iClickedReadyFirst && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center pt-2"
          >
            <span className="text-[#6E6A60] text-sm font-medium">
              Partner is Ready
            </span>
          </motion.div>
        )}
      </div>
    );
  }

  // ---- STATE 2: Conversation in Progress ----
  let state2BtnLabel;
  let state2BtnDisabled = false;
  let state2ShowPartnerText = false;

  if (!isMultipleChoice) {
    if (partnerAdvancedFirst) {
      state2BtnLabel = 'Next Question';
      state2ShowPartnerText = true;
      state2BtnDisabled = false;
    } else if (iAdvancedFirst) {
      state2BtnLabel = 'Waiting for Partner…';
      state2BtnDisabled = true;
      state2ShowPartnerText = false;
    } else {
      state2BtnLabel = 'Next Question';
      state2BtnDisabled = false;
      state2ShowPartnerText = false;
    }
  } else {
    if (partnerAdvancedFirst) {
      state2BtnLabel = 'Next Question';
      state2ShowPartnerText = true;
      state2BtnDisabled = false;
    } else if (iAdvancedFirst) {
      state2BtnLabel = 'Waiting for Partner…';
      state2BtnDisabled = true;
      state2ShowPartnerText = false;
    } else if (mcqAnswerLocked && !partnerAdvancedFirst && !iAdvancedFirst) {
      state2BtnLabel = 'Waiting for your partner';
      state2BtnDisabled = true;
      state2ShowPartnerText = false;
    } else {
      state2BtnLabel = 'Next Question';
      state2ShowPartnerText = false;
      state2BtnDisabled = false;
    }
  }

  return (
    <div className="space-y-3">
      {!state2BtnDisabled && (
        <Button
          onClick={handleNextQuestion}
          variant="ink"
          size="lg"
          fullWidth
        >
          {state2BtnLabel}
        </Button>
      )}
      {state2BtnDisabled && (
        <div className="text-center py-2 text-[#6E6A60] font-medium">
          {state2BtnLabel}
        </div>
      )}
      {state2ShowPartnerText && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center pt-2"
        >
          <span className="text-[#6E6A60] text-sm font-medium">
            Partner is Waiting
          </span>
        </motion.div>
      )}
    </div>
  );
}

function normalizeQuestionOptions(rawOptions) {
  if (!rawOptions) return [];
  const sourceOptions = Array.isArray(rawOptions)
    ? rawOptions
    : Array.isArray(rawOptions?.options)
      ? rawOptions.options
      : typeof rawOptions === 'string'
        ? rawOptions.split('|').map((item) => item.trim()).filter(Boolean)
        : [];
  return sourceOptions
    .map((option, index) => normalizeQuestionOption(option, index))
    .filter(Boolean);
}

function normalizeQuestionOption(option, index) {
  if (option == null) return null;
  if (typeof option === 'object' && !Array.isArray(option)) {
    const rawText = option.text ?? option.label ?? option.value ?? '';
    const text = cleanOptionLabel(rawText);
    if (!text) return null;
    return { id: String(option.id ?? option.value ?? `option-${index + 1}`), text };
  }
  const text = cleanOptionLabel(option);
  if (!text) return null;
  return { id: `option-${index + 1}`, text };
}

function cleanOptionLabel(value) {
  return String(value ?? '')
    .replace(/^[A-Z]\s*[:.)-]\s*/i, '')
    .trim();
}
