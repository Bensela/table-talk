import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../api';
import QuestionCard from '../components/QuestionCard';
import ProgressBar from '../components/ProgressBar';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';

export default function SessionGame() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [question, setQuestion] = useState(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [waitingForPartner, setWaitingForPartner] = useState(false);
  const [mode, setMode] = useState('single');
  const [isConnected, setIsConnected] = useState(false);
  const [modalState, setModalState] = useState({ 
    isOpen: false, 
    title: '', 
    message: '', 
    action: null,
    icon: null
  });
  
  const socketRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 3;

  // Initialize Session
  useEffect(() => {
    const initSession = async () => {
      try {
        const sessionRes = await api.get(`/sessions/${sessionId}`);
        if (sessionRes.data.expires_at && new Date(sessionRes.data.expires_at) < new Date()) {
          setError('Session expired. Please start a new one.');
          setLoading(false);
          return;
        }
        setMode(sessionRes.data.mode);

        const questionRes = await api.get(`/sessions/${sessionId}/questions/current`);
        setQuestion(questionRes.data);
        setLoading(false);
      } catch (err) {
        console.error(err);
        setError('Failed to load session');
        setLoading(false);
      }
    };

    initSession();
  }, [sessionId]);

  // Socket Connection Logic
  useEffect(() => {
    const isDev = import.meta.env.DEV;
    const socketUrl = isDev 
      ? 'http://localhost:5000' 
      : 'https://sea-lion-app-6mjje.ondigitalocean.app';

    const socket = io(socketUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });
    
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to socket server');
      setIsConnected(true);
      reconnectAttempts.current = 0;
      socket.emit('join_session', sessionId);
    });

    socket.on('disconnect', (reason) => {
      console.log('Disconnected:', reason);
      setIsConnected(false);
      if (reason === 'io server disconnect') {
        socket.connect();
      }
    });

    socket.on('connect_error', (err) => {
      console.error('Connection error:', err);
      reconnectAttempts.current++;
    });

    socket.on('answer_revealed', () => {
      setIsRevealed(true);
    });

    socket.on('advance_question', () => {
      console.log('Received advance_question event');
      fetchCurrentQuestion();
      setIsRevealed(false);
      setWaitingForPartner(false);
    });

    socket.on('waiting_for_partner', () => {
      if (mode === 'dual-phone' || mode === 'dual') {
        setWaitingForPartner(true);
      }
    });
    
    socket.on('wait_timeout', () => {
      setWaitingForPartner(false);
      setModalState({
        isOpen: true,
        title: 'Sync Timeout',
        message: 'It seems your partner is taking a while. You can try clicking Next again.',
        action: () => setModalState(prev => ({ ...prev, isOpen: false })),
        icon: '⏳'
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [sessionId, mode]);

  const fetchCurrentQuestion = async () => {
    try {
      const res = await api.get(`/sessions/${sessionId}/questions/current`);
      setQuestion(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleReveal = async () => {
    setIsRevealed(true);
    if (socketRef.current && isConnected) {
      socketRef.current.emit('reveal_answer', { sessionId });
    }
    try {
      await api.post(`/sessions/${sessionId}/answer/reveal`, { 
        question_id: question.question_id 
      });
    } catch (err) { console.error(err); }
  };

  const handleNext = async () => {
    if (waitingForPartner) return;

    if (mode === 'single-phone' || mode === 'single') {
      try {
        await api.post(`/sessions/${sessionId}/questions/next`);
        fetchCurrentQuestion();
        setIsRevealed(false);
      } catch (err) {
        console.error('Error advancing deck:', err);
      }
    } else {
      if (socketRef.current && isConnected) {
        socketRef.current.emit('request_next', { sessionId });
      } else {
        setModalState({
          isOpen: true,
          title: 'Connection Lost',
          message: 'We lost connection to the server. Please check your internet or wait for automatic reconnection.',
          action: () => setModalState(prev => ({ ...prev, isOpen: false })),
          icon: '🔌'
        });
      }
    }
  };

  if (loading && !question) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
          <p className="text-gray-500 font-bold animate-pulse">Loading conversation...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-white">
        <div className="bg-gray-50 p-8 rounded-3xl border border-gray-100 text-center max-w-sm w-full">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold mb-2">Session Error</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <Button 
            onClick={() => navigate('/')}
            variant="black"
            fullWidth
          >
            Go Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col p-6 font-sans selection:bg-blue-100 selection:text-blue-900 relative overflow-hidden">
      
      {/* Background Ambience */}
      <div className="absolute top-[-20%] left-[-20%] w-[500px] h-[500px] bg-blue-50/60 rounded-full blur-3xl pointer-events-none opacity-40" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[500px] h-[500px] bg-purple-50/60 rounded-full blur-3xl pointer-events-none opacity-40" />

      {/* Modal Popup */}
      <Modal
        isOpen={modalState.isOpen}
        onClose={() => setModalState(prev => ({ ...prev, isOpen: false }))}
        title={modalState.title}
        actionLabel="OK"
        onAction={modalState.action}
        icon={modalState.icon}
      >
        {modalState.message}
      </Modal>

      {/* Header */}
      <header className="flex justify-between items-center mb-8 relative z-10">
        <div 
          className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => navigate('/')}
        >
          <span className="text-xl">💬</span>
          <span className="text-sm font-bold text-gray-900 tracking-wider">TABLE-TALK</span>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Connection Status Indicator */}
          {mode === 'dual-phone' && (
            <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500 animate-pulse'}`} 
                 title={isConnected ? 'Connected' : 'Disconnected'}
            />
          )}
          
          <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border ${
            mode === 'dual-phone' 
              ? 'bg-purple-50 text-purple-700 border-purple-100' 
              : 'bg-blue-50 text-blue-700 border-blue-100'
          }`}>
            {mode === 'dual-phone' ? 'Dual Sync' : 'Single Mode'}
          </div>
        </div>
      </header>

      <div className="relative z-10 mb-8">
        <ProgressBar current={question.index} total={question.total} />
      </div>

      <div className="relative z-10 flex-1 flex flex-col">
        <QuestionCard 
          question={question} 
          isRevealed={isRevealed}
          onReveal={handleReveal}
          onNext={handleNext}
          waitingForPartner={waitingForPartner}
          mode={mode}
          socket={socketRef.current}
          sessionId={sessionId}
          userId={socketRef.current?.id}
        />
      </div>
    </div>
  );
}
