import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/useSessionStore';
import { Smartphone, MonitorSmartphone, ChevronRight } from 'lucide-react';

const ModeSelection: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { session, fetchSession, setMode, isLoading } = useSessionStore();

  useEffect(() => {
    if (sessionId && !session) {
      fetchSession(sessionId);
    }
  }, [sessionId, session, fetchSession]);

  useEffect(() => {
    if (session?.mode) {
      navigate(`/session/${session.id}/play`);
    }
  }, [session, navigate]);

  const handleModeSelect = async (mode: 'single_phone' | 'dual_phone') => {
    await setMode(mode);
  };

  if (!session && isLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-secondary">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-background text-primary flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Select Mode</h2>
          <p className="text-secondary">Choose how you want to play.</p>
        </div>

        <div className="space-y-4">
          {/* Single Phone Option */}
          <button
            onClick={() => handleModeSelect('single_phone')}
            disabled={isLoading}
            className="w-full group relative p-5 bg-surface rounded-3xl shadow-sm hover:shadow-md transition-all text-left border border-transparent hover:border-gray-200"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gray-100 rounded-full group-hover:bg-orange-50 transition-colors">
                <Smartphone className="w-6 h-6 text-gray-600 group-hover:text-accent" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg text-primary">Single Phone</h3>
                <p className="text-sm text-secondary">Pass one device around.</p>
              </div>
              <div className="text-gray-300 group-hover:text-accent">
                 <ChevronRight className="w-5 h-5" />
              </div>
            </div>
          </button>

          {/* Dual Phone Option */}
          <button
            onClick={() => handleModeSelect('dual_phone')}
            disabled={isLoading} 
            className="w-full group relative p-5 bg-surface rounded-3xl shadow-sm hover:shadow-md transition-all text-left border border-transparent hover:border-gray-200"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gray-100 rounded-full group-hover:bg-blue-50 transition-colors">
                <MonitorSmartphone className="w-6 h-6 text-gray-600 group-hover:text-blue-500" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg text-primary">Dual Phone</h3>
                <p className="text-sm text-secondary">Sync two devices.</p>
              </div>
              <div className="text-gray-300 group-hover:text-blue-500">
                  <ChevronRight className="w-5 h-5" />
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModeSelection;
