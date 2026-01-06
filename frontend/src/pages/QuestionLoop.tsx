import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/useSessionStore';
import { Eye, ChevronRight, MessageCircle, Users, Share2, WifiOff, X } from 'lucide-react';
import QRCode from 'react-qr-code';

const QuestionLoop: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { 
    session, 
    fetchSession, 
    revealQuestion, 
    nextQuestion, 
    isLoading,
    participantCount,
    isConnected
  } = useSessionStore();

  const [showInvite, setShowInvite] = useState(false);

  useEffect(() => {
    if (sessionId && !session) {
      fetchSession(sessionId);
    }
  }, [sessionId, session, fetchSession]);

  useEffect(() => {
    if (session && !session.mode) {
      navigate(`/session/${session.id}/mode`);
    }
  }, [session, navigate]);

  if (!session) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-secondary">Loading...</div>;
  }

  const currentQuestion = session.questions[session.currentQuestionIndex];
  const isLastQuestion = session.currentQuestionIndex >= session.questions.length - 1;
  const sessionUrl = window.location.href; // Current URL is the join URL

  return (
    <div className="min-h-screen bg-background text-primary flex flex-col p-6 relative">
      {/* Offline Banner */}
      {!isConnected && (
        <div className="absolute top-0 left-0 right-0 bg-red-500 text-white text-xs text-center py-1 z-50 flex items-center justify-center gap-2">
           <WifiOff className="w-3 h-3" />
           <span>Reconnecting...</span>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center mb-6 px-2 pt-4">
        <div className="flex items-center gap-2">
           <div className="w-8 h-8 bg-surface rounded-full flex items-center justify-center shadow-sm">
             <MessageCircle className="w-4 h-4 text-accent" />
           </div>
           <span className="font-bold text-lg text-primary">Table Talk</span>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Participant Count / Share Button */}
          {session.mode === 'dual_phone' && (
             <button 
               onClick={() => setShowInvite(true)}
               className="flex items-center gap-1.5 bg-surface px-3 py-1.5 rounded-full shadow-sm border border-gray-100 active:scale-95 transition-transform"
             >
                <Users className={`w-4 h-4 ${participantCount > 1 ? 'text-green-500' : 'text-gray-400'}`} />
                <span className="text-xs font-bold text-secondary">{participantCount}</span>
                {participantCount < 2 && (
                   <div className="w-2 h-2 bg-accent rounded-full animate-pulse ml-1"></div>
                )}
             </button>
          )}

          <div className="px-3 py-1 bg-white rounded-full shadow-sm text-xs font-bold text-secondary">
            {session.currentQuestionIndex + 1} / {session.questions.length}
          </div>
        </div>
      </div>

      {/* Main Card Area */}
      <div className="flex-1 flex flex-col justify-center items-center max-w-md mx-auto w-full space-y-6">
        <div 
          onClick={() => !session.isRevealed && revealQuestion()}
          className={`
            w-full aspect-[3/4] rounded-4xl p-8 flex flex-col relative shadow-xl transition-all duration-500 cursor-pointer
            ${session.isRevealed ? 'bg-surface' : 'bg-surface hover:shadow-2xl'}
          `}
        >
          {session.isRevealed ? (
            <div className="flex flex-col h-full animate-in fade-in duration-500">
               {/* Status Pill */}
               <div className="self-start mb-auto">
                 <span className="bg-accent text-white px-3 py-1 rounded-full text-xs font-bold tracking-wide">
                   Active
                 </span>
               </div>
              
              {/* Question Text */}
              <div className="flex-1 flex items-center justify-center">
                 <h2 className="text-3xl md:text-4xl font-bold leading-tight text-center text-primary">
                  {currentQuestion?.text}
                </h2>
              </div>

               {/* Footer / Decor */}
               <div className="mt-auto flex justify-between items-end">
                  <div className="text-xs text-secondary font-medium">Topic: General</div>
                  <div className="w-8 h-8 rounded-full border border-gray-100 flex items-center justify-center">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  </div>
               </div>
            </div>
          ) : (
            <div className="flex flex-col h-full items-center justify-center space-y-6">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center animate-pulse">
                <Eye className="w-8 h-8 text-secondary" />
              </div>
              <div className="text-center space-y-2">
                 <h3 className="text-xl font-bold text-primary">Hidden Question</h3>
                 <p className="text-secondary text-sm">Tap card to reveal</p>
              </div>
            </div>
          )}
        </div>

        {/* Action Button */}
        <div className="w-full h-16">
          {session.isRevealed && (
            <button
              onClick={() => nextQuestion()}
              disabled={isLoading || isLastQuestion}
              className="w-full h-full bg-primary text-white rounded-2xl font-bold text-lg hover:bg-gray-800 transition-colors active:scale-95 flex items-center justify-center gap-2 shadow-lg animate-in slide-in-from-bottom-4 duration-300"
            >
              {isLastQuestion ? 'Finish Session' : (
                <>
                  <span>Next Question</span>
                  <ChevronRight className="w-5 h-5" />
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-surface rounded-3xl p-6 w-full max-w-sm space-y-6 relative">
              <button 
                onClick={() => setShowInvite(false)}
                className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full hover:bg-gray-200"
              >
                <X className="w-5 h-5 text-secondary" />
              </button>
              
              <div className="text-center space-y-2">
                 <h3 className="text-xl font-bold text-primary">Join Session</h3>
                 <p className="text-secondary text-sm">Scan to sync a second device</p>
              </div>

              <div className="flex justify-center p-4 bg-white rounded-2xl border border-gray-100">
                 <QRCode value={sessionUrl} size={200} />
              </div>

              <div className="text-center">
                 <p className="text-xs text-secondary font-mono bg-gray-50 p-2 rounded-lg break-all">
                   {sessionUrl}
                 </p>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default QuestionLoop;
