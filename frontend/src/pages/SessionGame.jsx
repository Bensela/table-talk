import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../api';
import QuestionCard from '../components/QuestionCard';
import ProgressBar from '../components/ProgressBar';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { getStoredParticipant } from '../utils/sessionStorage';

// Hook for session activity tracking
function useSessionActivity(sessionId, participantId) {
  useEffect(() => {
    if (!participantId) return;
    
    // Heartbeat every 60 seconds
    const heartbeat = setInterval(async () => {
      try {
        await api.post(`/sessions/${sessionId}/heartbeat`, { participant_id: participantId });
      } catch (err) {
        console.error('Heartbeat failed', err);
      }
    }, 60000);

    return () => clearInterval(heartbeat);
  }, [sessionId, participantId]);
}

export default function SessionGame() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [question, setQuestion] = useState(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [waitingForPartner, setWaitingForPartner] = useState(false);
  const [mode, setMode] = useState('single-phone');
  const [isConnected, setIsConnected] = useState(false);
  const [participantId, setParticipantId] = useState(null);
  const [modalState, setModalState] = useState({ 
    isOpen: false, 
    title: '', 
    message: '', 
    action: null,
    icon: null
  });
  
  const socketRef = useRef(null);
  const reconnectAttempts = useRef(0);

  // Initialize Session
  useEffect(() => {
    const initSession = async () => {
      try {
        // 1. Get Session Data
        const sessionRes = await api.get(`/sessions/${sessionId}`);
        if (sessionRes.data.expires_at && new Date(sessionRes.data.expires_at) < new Date()) {
          setError('Session expired. Please start a new one.');
          setLoading(false);
          return;
        }
        setMode(sessionRes.data.mode);

        // 2. Get Participant ID
        const stored = getStoredParticipant();
        if (stored.sessionId === sessionId && stored.participantId) {
          setParticipantId(stored.participantId);
        } else if (sessionRes.data.mode === 'dual-phone') {
           // If dual mode but no participant ID, we might be in trouble or need to re-join
           console.warn('Missing participant ID for dual session');
        }

        // 3. Get Question
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

  // Activate Heartbeat
  useSessionActivity(sessionId, participantId);

  // Socket Connection Logic
  useEffect(() => {
    if (!participantId) return; // Wait for participant ID

    const isDev = import.meta.env.DEV;
    
    // 1. Force the URL to the base domain in production
    const socketUrl = isDev 
      ? 'http://localhost:5000' 
      : 'https://octopus-app-ibal3.ondigitalocean.app';

    const socket = io(socketUrl, {
      // 2. CRITICAL: Add the /api prefix to the path to match DO Routing
      path: isDev ? '/socket.io/' : '/api/socket.io/',
      transports: ['websocket'],
      upgrade: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 20000,
      secure: !isDev,
      rejectUnauthorized: false
    });
    
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('✅ Connected to socket server via /api/socket.io/');
      setIsConnected(true);
      reconnectAttempts.current = 0;
      
      // Authenticated Join
      socket.emit('join_session', { 
        session_id: sessionId, 
        participant_id: participantId 
      });
    });

    socket.on('connect_error', (err) => {
      // This will now show the actual reason in your console
      console.error('❌ Socket Connection Error:', err.message);
      setIsConnected(false);
    });

    socket.on('disconnect', (reason) => {
      console.log('🔌 Disconnected:', reason);
      setIsConnected(false);
    });

    socket.on('error', (data) => {
      console.error('Socket Error:', data);
      // Handle auth errors
      if (data.message === 'Invalid participant or session') {
         setError('Connection refused. Invalid session.');
      }
    });

    socket.on('partner_status', (data) => {
      console.log('Partner status:', data);
      // Can update UI to show partner connected
    });

    socket.on('answer_revealed', () => {
      setIsRevealed(true);
    });

    socket.on('reveal_answers', (data) => {
       // data.selections could be used to show what partner picked
       setIsRevealed(true);
       setWaitingForPartner(false);
    });

    socket.on('advance_question', () => {
      console.log('Received advance_question event');
      fetchCurrentQuestion();
      setIsRevealed(false);
      setWaitingForPartner(false);
    });

    socket.on('waiting_for_partner', () => {
      setWaitingForPartner(true);
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
      if (socket) socket.disconnect();
    };
  }, [sessionId, participantId]); 

  const fetchCurrentQuestion = async () => {
    try {
      const res = await api.get(`/sessions/${sessionId}/questions/current`);
      setQuestion(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleReveal = async () => {
    // If dual mode, emit socket event first for sync
    if (mode === 'dual-phone') {
        if (socketRef.current && isConnected) {
            socketRef.current.emit('reveal_answer', { sessionId });
        }
    }
    
    setIsRevealed(true);
    
    try {
      await api.post(`/sessions/${sessionId}/answer/reveal`, { 
        question_id: question.question_id 
      });
    } catch (err) { console.error(err); }
  };

  const handleNext = async () => {
    // Check if session is ending
    if (question.index === question.total) {
        try {
            await api.delete(`/sessions/${sessionId}`);
            navigate('/');
        } catch (err) {
            console.error('Error ending session:', err);
            navigate('/');
        }
        return;
    }

    // Single Phone Logic
    if (mode === 'single-phone' || mode === 'single') {
      try {
        await api.post(`/sessions/${sessionId}/questions/next`);
        fetchCurrentQuestion();
        setIsRevealed(false);
      } catch (err) {
        console.error('Error advancing deck:', err);
      }
      return;
    } 
    
    // Dual Phone Logic
    if (waitingForPartner) return; // Prevent double clicks

    if (socketRef.current?.connected) {
        // Emit request_next (backend handles auth via socket.participantId)
        socketRef.current.emit('request_next');
    } else {
        // Attempt to reconnect if disconnected
        console.warn('Socket disconnected, attempting reconnect...');
        socketRef.current?.connect();
        
        setModalState({
          isOpen: true,
          title: 'Reconnecting...',
          message: 'Connection to partner lost. Attempting to reconnect...',
          action: () => {
            setModalState(prev => ({ ...prev, isOpen: false }));
            if (socketRef.current?.connected) {
               socketRef.current.emit('request_next');
            }
          },
          icon: '🔄'
        });
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
          userId={participantId}
        />
      </div>
    </div>
  );
}
