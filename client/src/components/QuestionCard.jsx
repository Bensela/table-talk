import { useState, useEffect } from 'react';

export default function QuestionCard({ 
  question, 
  onReveal, 
  isRevealed, 
  onNext, 
  waitingForPartner, 
  mode 
}) {
  const [localRevealed, setLocalRevealed] = useState(isRevealed);

  useEffect(() => {
    setLocalRevealed(isRevealed);
  }, [isRevealed, question.question_id]);

  const handleReveal = () => {
    if (!localRevealed) {
      setLocalRevealed(true);
      onReveal();
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-center w-full max-w-md mx-auto">
      {/* Card */}
      <div 
        onClick={handleReveal}
        className={`
          bg-white rounded-3xl p-8 shadow-sm border-2 transition-all duration-300 cursor-pointer min-h-[320px] flex flex-col justify-center text-center relative overflow-hidden
          ${localRevealed ? 'border-gray-200' : 'border-gray-900 hover:scale-[1.02]'}
        `}
      >
        <span className="absolute top-6 left-1/2 -translate-x-1/2 text-xs font-bold tracking-widest uppercase text-gray-400">
          {question.category || 'Topic'}
        </span>

        <h2 className="text-2xl font-bold leading-tight mb-6">
          {question.question_text}
        </h2>

        {/* Answer Section */}
        <div className={`
          transition-all duration-500 ease-in-out overflow-hidden
          ${localRevealed ? 'max-h-40 opacity-100 mt-4' : 'max-h-0 opacity-0'}
        `}>
          <div className="pt-6 border-t border-gray-100">
            <p className="text-gray-600 italic">
              {question.answer_text}
            </p>
          </div>
        </div>

        {/* Tap to Reveal Hint */}
        {!localRevealed && (
          <div className="absolute bottom-6 left-0 w-full text-center">
             <span className="text-xs text-gray-400 font-medium animate-pulse">
               Tap to reveal thought starter
             </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-8">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          disabled={waitingForPartner}
          className={`
            w-full py-4 rounded-full font-bold text-lg transition-all transform active:scale-95
            ${waitingForPartner 
              ? 'bg-gray-200 text-gray-500 cursor-not-allowed' 
              : 'bg-black text-white hover:bg-gray-800 shadow-lg hover:shadow-xl'
            }
          `}
        >
          {waitingForPartner ? 'Waiting for partner...' : 'Next Question'}
        </button>
        {waitingForPartner && (
           <p className="text-center text-xs text-gray-400 mt-3 animate-pulse">
             Syncing with other phone...
           </p>
        )}
      </div>
    </div>
  );
}
