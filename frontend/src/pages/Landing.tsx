import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/useSessionStore';
import { QrCode, ScanLine } from 'lucide-react';

const Landing: React.FC = () => {
  const navigate = useNavigate();
  const { createSession, session, isLoading } = useSessionStore();

  useEffect(() => {
    if (session) {
      if (!session.mode) {
        navigate(`/session/${session.id}/mode`);
      } else {
        navigate(`/session/${session.id}/play`);
      }
    }
  }, [session, navigate]);

  const handleScan = async () => {
    await createSession();
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md space-y-12 text-center">
        <div className="space-y-2">
          <h1 className="text-5xl font-bold tracking-tight text-primary">
            Table<br />Talk
          </h1>
          <p className="text-secondary text-lg">Deep conversations, simplified.</p>
        </div>

        <div className="p-8 bg-surface rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center space-y-6">
           <div className="w-16 h-16 bg-background rounded-full flex items-center justify-center">
              <ScanLine className="w-8 h-8 text-primary opacity-80" />
           </div>
          
          <div className="space-y-2">
             <h2 className="text-xl font-bold text-primary">Start a Session</h2>
             <p className="text-sm text-secondary">Scan the QR code on the table to begin.</p>
          </div>

          <button
            onClick={handleScan}
            disabled={isLoading}
            className="w-full py-4 px-6 bg-accent text-white rounded-2xl font-bold text-lg flex items-center justify-center gap-3 hover:bg-accent-hover transition-colors disabled:opacity-50 shadow-md shadow-orange-100"
          >
            {isLoading ? (
              <span>Creating...</span>
            ) : (
              <>
                <QrCode className="w-5 h-5" />
                <span>Simulate Scan</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Landing;
