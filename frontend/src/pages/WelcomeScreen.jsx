import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import Button from '../components/ui/Button';
import { resolveSessionForScan } from '../services/sessionResolver';
import { getStoredParticipant } from '../utils/sessionStorage';

export default function WelcomeScreen() {
  const { tableToken } = useParams();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState('Connecting...');

  // 1. On Mount, Deterministically Resolve
  useEffect(() => {
    if (!tableToken) {
      navigate('/');
      return;
    }

    const runResolver = async () => {
      setChecking(true);
      setStatus('Finding your table...');
      
      try {
        // Attempt to resolve based on local session token
        const stored = getStoredParticipant();
        if (stored.sessionId && stored.participantId) {
           // We have a local token. Let's try to resume it blindly first
           // because checking backend for resume might be redundant if the user
           // just reloaded the page. 
           // BUT the prompt says "Scanning always routes immediately".
           // If we scan a NEW QR code for a DIFFERENT table, we shouldn't resume the OLD session.
           // So we must validate tableToken match.
           // The resolveSessionForScan service handles this validation via backend resume call.
        }

        const result = await resolveSessionForScan(tableToken);
        
        if (result.action === 'resume') {
          setStatus('Resuming session...');
          navigate(`/session/${result.data.session_id}/game`);
        } else if (result.action === 'join') {
          setStatus('Joining partner...');
          navigate(`/session/${result.data.session_id}/game`);
        } else {
          // New Session
          // Navigate to Context Selection
          setStatus('Ready to start');
          navigate(`/t/${tableToken}/context`);
        }
      } catch (err) {
        console.error('Resolution error:', err);
        // Fallback: Start New
        navigate(`/t/${tableToken}/context`);
      } finally {
        setChecking(false);
      }
    };

    runResolver();
  }, [tableToken, navigate]);

  // Loading UI only (since we auto-resolve)
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 font-sans">
      <div className="animate-pulse text-center">
        <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-gray-500 font-medium">{status}</p>
      </div>
    </div>
  );
}
