import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../api';
import QuestionCard from '../components/QuestionCard';
import ProgressBar from '../components/ProgressBar';

export default function SessionGame() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [question, setQuestion] = useState(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [waitingForPartner, setWaitingForPartner] = useState(false);
  const [mode, setMode] = useState('single');
  
  const socketRef = useRef(null);

  // Initialize Session & Socket
  useEffect(() => {
    const init = async () => {
      try {
        // 1. Get Session Info (Mode)
        const sessionRes = await api.get(`/sessions/${sessionId}`);
        setMode(sessionRes.data.mode);

        // 2. Get Current Question
        const questionRes = await api.get(`/sessions/${sessionId}/questions/current`);
        setQuestion(questionRes.data);
        
        setLoading(false);
      } catch (err) {
        console.error(err);
        setError('Failed to load session');
        setLoading(false);
      }
    };

    init();

    // Socket Connection
    const socket = io(import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000');
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to socket server');
      socket.emit('join_session', sessionId);
    });

    socket.on('answer_revealed', () => {
      setIsRevealed(true);
    });

    socket.on('advance_question', () => {
      // Refresh question data
      fetchCurrentQuestion();
      setIsRevealed(false);
      setWaitingForPartner(false);
    });

    socket.on('waiting_for_partner', () => {
      setWaitingForPartner(true);
    });
    
    socket.on('wait_timeout', () => {
      setWaitingForPartner(false);
      alert('Sync timeout. Try clicking Next again.');
    });

    return () => {
      socket.disconnect();
    };
  }, [sessionId]);

  const fetchCurrentQuestion = async () => {
    try {
      setLoading(true);
      const res = await api.get(`/sessions/${sessionId}/questions/current`);
      setQuestion(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleReveal = async () => {
    setIsRevealed(true);
    // Notify server
    if (socketRef.current) {
      socketRef.current.emit('reveal_answer', { sessionId });
    }
    // Log API
    try {
      await api.post(`/sessions/${sessionId}/answer/reveal`, { 
        question_id: question.question_id 
      });
    } catch (err) { console.error(err); }
  };

  const handleNext = async () => {
    if (waitingForPartner) return;

    if (mode === 'single') {
      // Optimistic update for single mode
      try {
        await api.post(`/sessions/${sessionId}/questions/next`);
        fetchCurrentQuestion();
        setIsRevealed(false);
      } catch (err) {
        console.error(err);
      }
    } else {
      // Dual mode: Request via socket
      socketRef.current.emit('request_next', { sessionId });
      
      // Also hit API to log intent? 
      // Actually, for Dual mode, the SERVER socket handler should call the DB update
      // But our current socket handler just emits 'advance_question'
      // We need to ensure the DB state is updated exactly once.
      // Let's modify the flow:
      // 1. User clicks Next -> Socket 'request_next'
      // 2. Server Socket checks if both ready
      // 3. If ready -> Server updates DB -> Emits 'advance_question'
      // 4. Clients re-fetch.
      
      // WAIT: The server socket code I wrote earlier DOES NOT update the DB!
      // I need to fix that in server/index.js
    }
  };

  if (loading && !question) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center text-red-500">
        {error}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col p-6">
      {/* Header */}
      <header className="flex justify-between items-center mb-6">
        <div className="text-sm font-bold text-gray-400">TABLE-TALK</div>
        <div className={`px-3 py-1 rounded-full text-xs font-medium ${
          mode === 'dual' ? 'bg-purple-100 text-purple-700' : 'bg-gray-200 text-gray-700'
        }`}>
          {mode === 'dual' ? '⚡ Dual Sync' : '📱 Single'}
        </div>
      </header>

      <ProgressBar current={question.index} total={question.total} />

      <QuestionCard 
        question={question} 
        isRevealed={isRevealed}
        onReveal={handleReveal}
        onNext={handleNext}
        waitingForPartner={waitingForPartner}
        mode={mode}
      />
    </div>
  );
}
